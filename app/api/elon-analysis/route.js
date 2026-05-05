import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";

const XTRACKER_BASE = "https://xtracker.polymarket.com/api";
const ELON_HANDLE = "elonmusk";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://xtracker.polymarket.com/",
  Origin: "https://xtracker.polymarket.com",
};

const ANCHOR_MS = new Date("2026-04-28T16:00:00.000Z").getTime();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getWeekKey(iso) {
  const t = new Date(iso).getTime();
  const diffMs = ANCHOR_MS - t;
  if (diffMs <= 0) return new Date(ANCHOR_MS).toISOString().slice(0, 10);
  const n = Math.floor(diffMs / WEEK_MS);
  return new Date(ANCHOR_MS - (n + 1) * WEEK_MS).toISOString().slice(0, 10);
}

async function fetchAllPosts() {
  const seen = new Set();
  const all = [];
  let endDate = null;

  for (let page = 0; page < 100; page++) {
    const url = new URL(`${XTRACKER_BASE}/users/${ELON_HANDLE}/posts`);
    if (endDate) url.searchParams.set("endDate", endDate);

    const r = await fetch(url.toString(), { headers: HEADERS });
    if (!r.ok) break;

    const json = await r.json();
    const batch = json.success && Array.isArray(json.data) ? json.data : [];
    if (batch.length === 0) break;

    for (const post of batch) {
      if (!seen.has(post.id)) { seen.add(post.id); all.push(post); }
    }
    if (batch.length < 500) break;

    const oldest = batch.reduce((min, p) => p.createdAt < min ? p.createdAt : min, batch[0].createdAt);
    const next = new Date(new Date(oldest).getTime() - 1).toISOString();
    if (next === endDate) break;
    endDate = next;
  }

  all.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  return all;
}

const getElonAnalysis = unstable_cache(
  async () => {
    const posts = await fetchAllPosts();

    // Group by week — collect up to 5 tweet samples per week
    const weekMap = {};
    for (const p of posts) {
      const key = getWeekKey(p.createdAt);
      if (!weekMap[key]) weekMap[key] = { count: 0, samples: [] };
      weekMap[key].count++;
      if (weekMap[key].samples.length < 5 && p.content) {
        const text = p.content.trim().slice(0, 200);
        if (text) weekMap[key].samples.push(text);
      }
    }

    const sortedKeys = Object.keys(weekMap).sort();
    const total = sortedKeys.reduce((s, k) => s + weekMap[k].count, 0);
    const avg = Math.round(total / sortedKeys.length);
    const highThreshold = Math.round(avg * 1.5);
    const lowThreshold = Math.round(avg * 0.5);

    // Only ask Claude about outlier weeks (high or low)
    const notableWeeks = sortedKeys
      .filter(k => weekMap[k].count >= highThreshold || weekMap[k].count <= lowThreshold)
      .map(k => ({
        week: k,
        count: weekMap[k].count,
        activity: weekMap[k].count >= highThreshold ? "HIGH" : "LOW",
        samples: weekMap[k].samples,
      }));

    if (notableWeeks.length === 0) {
      return { analyses: {}, avg, highThreshold, lowThreshold, cachedAt: new Date().toISOString() };
    }

    // Compact context: all weeks as a simple list
    const allWeeksCounts = sortedKeys
      .map(k => `${k}=${weekMap[k].count}`)
      .join(", ");

    const notableWeeksText = notableWeeks
      .map(w =>
        `Week ${w.week} [${w.activity}, ${w.count} tweets]:\n` +
        w.samples.map((s, i) => `  ${i + 1}. "${s}"`).join("\n")
      )
      .join("\n\n");

    const client = new Anthropic();

    const stream = client.messages.stream({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: `You are analyzing Elon Musk's X (Twitter) posting frequency data from 2023–2026.

Average: ${avg} tweets/week. HIGH = ${highThreshold}+ tweets. LOW = ${lowThreshold} or fewer.

For each notable week, write a concise 1-2 sentence explanation of WHY the volume was notably high or low, drawing on:
• The sample tweets (main evidence)
• Real-world context you know: SpaceX launches, Tesla earnings, DOGE/government work, X platform changes, xAI/Grok announcements, Neuralink, political events, controversies, legal disputes, etc.

Return ONLY a valid JSON object keyed by week start date: { "YYYY-MM-DD": "reason..." }
Only include weeks you can meaningfully explain. Be specific and factual.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `All weeks (date=count): ${allWeeksCounts}

Notable weeks to analyze (${notableWeeks.length} total):
${notableWeeksText}

Return the JSON object.`,
        },
      ],
    });

    const message = await stream.finalMessage();

    let analyses = {};
    try {
      const textBlock = message.content.find(b => b.type === "text");
      const raw = textBlock?.text ?? "";
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) analyses = JSON.parse(m[0]);
    } catch {}

    return { analyses, avg, highThreshold, lowThreshold, cachedAt: new Date().toISOString() };
  },
  ["elon-analysis-v3"],
  { revalidate: 86400 } // 24-hour cache
);

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }
  try {
    const data = await getElonAnalysis();
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

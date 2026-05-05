import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";

const ANCHOR_MS = new Date("2026-04-28T16:00:00.000Z").getTime();
const WEEK_MS   = 7 * 24 * 60 * 60 * 1000;

const DATA_DIR      = join(process.cwd(), "data");
const ANALYSIS_FILE = join(DATA_DIR, "elon-analysis.json");

// ── Week helpers ──────────────────────────────────────────────────────────────

function getWeekKey(iso) {
  const t      = new Date(iso).getTime();
  const diffMs = ANCHOR_MS - t;
  if (diffMs <= 0) return new Date(ANCHOR_MS).toISOString().slice(0, 10);
  const n = Math.floor(diffMs / WEEK_MS);
  return new Date(ANCHOR_MS - (n + 1) * WEEK_MS).toISOString().slice(0, 10);
}

// ── Persistence ───────────────────────────────────────────────────────────────

function loadStoredAnalysis() {
  try {
    if (!existsSync(ANALYSIS_FILE)) return {};
    return JSON.parse(readFileSync(ANALYSIS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveAnalysis(analyses) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ANALYSIS_FILE, JSON.stringify(analyses), "utf8");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Given all stored posts, compute weekly stats, identify notable weeks,
 * call Claude only for weeks not yet analyzed, persist the merged result.
 *
 * Returns { analyses, newCount, avg, highThreshold, lowThreshold }
 */
export async function syncAnalysis(posts) {
  const stored = loadStoredAnalysis();

  // Group posts by week — collect up to 5 content samples per week
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
  if (sortedKeys.length === 0) {
    return { analyses: stored, newCount: 0, avg: 0, highThreshold: 0, lowThreshold: 0 };
  }

  const total        = sortedKeys.reduce((s, k) => s + weekMap[k].count, 0);
  const avg          = Math.round(total / sortedKeys.length);
  const highThreshold = Math.round(avg * 1.5);
  const lowThreshold  = Math.round(avg * 0.5);

  // All weeks not yet saved — analyze everything in one Claude call
  const unanalyzed = sortedKeys
    .filter(k => !stored[k])
    .map(k => {
      const { count, samples } = weekMap[k];
      const activity = count >= highThreshold ? "HIGH" : count <= lowThreshold ? "LOW" : "NORMAL";
      return { week: k, count, activity, samples };
    });

  if (unanalyzed.length === 0) {
    return { analyses: stored, newCount: 0, avg, highThreshold, lowThreshold };
  }

  // Build Claude prompt
  const allWeeksCounts = sortedKeys
    .map(k => `${k}=${weekMap[k].count}`)
    .join(", ");

  const notableWeeksText = unanalyzed
    .map(w =>
      `Week ${w.week} [${w.activity}, ${w.count} tweets]:\n` +
      w.samples.map((s, i) => `  ${i + 1}. "${s}"`).join("\n")
    )
    .join("\n\n");

  const client = new Anthropic();

  const stream = client.messages.stream({
    model:      "claude-opus-4-7",
    max_tokens: 8000,
    thinking:   { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `You are analyzing Elon Musk's X (Twitter) posting frequency data from 2023–2026.

Average: ${avg} tweets/week. HIGH = ${highThreshold}+ tweets. LOW = ${lowThreshold} or fewer.

For EVERY week provided, write a concise 1-2 sentence explanation of what was happening that week, drawing on:
• The sample tweets (main evidence)
• Real-world context: SpaceX launches, Tesla earnings, DOGE/government work, X platform changes, xAI/Grok announcements, Neuralink, political events, controversies, legal disputes, etc.

If the week is HIGH or LOW, explain why the volume was unusual. For NORMAL weeks, briefly describe the main topics Elon was focused on.

Return ONLY a valid JSON object keyed by week start date: { "YYYY-MM-DD": "reason..." }
Include every week in your response. Be specific and factual.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role:    "user",
        content: `All weeks (date=count): ${allWeeksCounts}

Weeks to analyze (${unanalyzed.length} total — analyze ALL of them):
${notableWeeksText}

Return the JSON object with an entry for every week listed above.`,
      },
    ],
  });

  const message = await stream.finalMessage();

  let newAnalyses = {};
  try {
    const textBlock = message.content.find(b => b.type === "text");
    const raw       = textBlock?.text ?? "";
    const m         = raw.match(/\{[\s\S]*\}/);
    if (m) newAnalyses = JSON.parse(m[0]);
  } catch {}

  const merged   = { ...stored, ...newAnalyses };
  saveAnalysis(merged);

  return {
    analyses:      merged,
    newCount:      Object.keys(newAnalyses).length,
    avg,
    highThreshold,
    lowThreshold,
  };
}

/**
 * Analyze a single specific week on demand.
 * Returns { reason } — also persists the result to disk.
 */
export async function analyzeWeek(posts, weekKey) {
  const stored = loadStoredAnalysis();

  if (stored[weekKey]) return { reason: stored[weekKey], cached: true };

  // Build week-level counts + samples across all posts for context
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
  if (sortedKeys.length === 0 || !weekMap[weekKey]) return { reason: null, cached: false };

  const total        = sortedKeys.reduce((s, k) => s + weekMap[k].count, 0);
  const avg          = Math.round(total / sortedKeys.length);
  const { count, samples } = weekMap[weekKey];
  const activity     = count >= Math.round(avg * 1.5) ? "HIGH" : count <= Math.round(avg * 0.5) ? "LOW" : "NORMAL";

  const allWeeksCounts = sortedKeys.map(k => `${k}=${weekMap[k].count}`).join(", ");

  const client = new Anthropic();
  const stream = client.messages.stream({
    model:      "claude-opus-4-7",
    max_tokens: 1000,
    thinking:   { type: "adaptive" },
    system: [{
      type: "text",
      text: `You are analyzing Elon Musk's X (Twitter) posting frequency data from 2023–2026.

Average: ${avg} tweets/week. This week had ${count} tweets (${activity}).

Write a concise 1-2 sentence explanation of WHY the volume was ${activity.toLowerCase()} this week, drawing on:
• The sample tweets (main evidence)
• Real-world context: SpaceX launches, Tesla earnings, DOGE/government work, X platform changes, xAI/Grok, Neuralink, political events, controversies, etc.

Return ONLY valid JSON: { "reason": "your explanation" }
Be specific and factual.`,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role:    "user",
      content: `All weeks context (date=count): ${allWeeksCounts}

Week ${weekKey} [${activity}, ${count} tweets]:
${samples.map((s, i) => `  ${i + 1}. "${s}"`).join("\n")}

Return the JSON object.`,
    }],
  });

  const message = await stream.finalMessage();

  let reason = null;
  try {
    const textBlock = message.content.find(b => b.type === "text");
    const raw       = textBlock?.text ?? "";
    const m         = raw.match(/\{[\s\S]*\}/);
    if (m) reason   = JSON.parse(m[0]).reason ?? null;
  } catch {}

  if (reason) saveAnalysis({ ...stored, [weekKey]: reason });

  return { reason, cached: false };
}

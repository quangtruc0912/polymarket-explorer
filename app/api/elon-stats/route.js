import { unstable_cache } from "next/cache";

const XTRACKER_BASE = "https://xtracker.polymarket.com/api";
const ELON_HANDLE   = "elonmusk";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept":     "application/json",
  "Referer":    "https://xtracker.polymarket.com/",
  "Origin":     "https://xtracker.polymarket.com",
};

const ANCHOR_MS = new Date("2026-04-28T16:00:00.000Z").getTime();
const WEEK_MS   = 7 * 24 * 60 * 60 * 1000;

function getWeekKey(iso) {
  const t = new Date(iso).getTime();
  const diffMs = ANCHOR_MS - t;
  if (diffMs <= 0) return new Date(ANCHOR_MS).toISOString().slice(0, 10);
  const n = Math.floor(diffMs / WEEK_MS);
  return new Date(ANCHOR_MS - (n + 1) * WEEK_MS).toISOString().slice(0, 10);
}

function weekEndDate(startKey) {
  const ms = new Date(startKey + "T16:00:00.000Z").getTime();
  return new Date(ms + WEEK_MS).toISOString().slice(0, 10);
}

async function xtrackerFetch(path) {
  const r = await fetch(`${XTRACKER_BASE}${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`xtracker ${path} → HTTP ${r.status}`);
  const json = await r.json();
  return json.success ? json.data : null;
}

async function fetchAllPosts() {
  const seen = new Set();
  const all  = [];
  let endDate = null;

  for (let page = 0; page < 100; page++) {
    const url = new URL(`${XTRACKER_BASE}/users/${ELON_HANDLE}/posts`);
    if (endDate) url.searchParams.set("endDate", endDate);

    const r = await fetch(url.toString(), { headers: HEADERS });
    if (!r.ok) break;

    const json  = await r.json();
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

// ── Cached computation — runs at most once every 6 hours globally ─────────────
// Vercel stores this result in its shared Data Cache across all instances.
const getElonStats = unstable_cache(
  async () => {
    const [profile, posts] = await Promise.all([
      xtrackerFetch(`/users/${ELON_HANDLE}`),
      fetchAllPosts(),
    ]);

    const weekMap    = {};
    const dowCounts  = Array(7).fill(0);
    const hourCounts = Array(24).fill(0);
    let rtCount = 0, replyCount = 0;

    for (const p of posts) {
      const key = getWeekKey(p.createdAt);
      weekMap[key] = (weekMap[key] || 0) + 1;

      const dt = new Date(p.createdAt);
      dowCounts[dt.getUTCDay()]++;
      hourCounts[dt.getUTCHours()]++;

      if (p.content?.startsWith("RT @"))       rtCount++;
      else if (p.content?.startsWith("@"))     replyCount++;
    }

    const sortedKeys = Object.keys(weekMap).sort();
    const weekly = sortedKeys.map((key, i) => {
      const count = weekMap[key];
      const prev  = i > 0 ? weekMap[sortedKeys[i - 1]] : null;
      return {
        weekNum:   i + 1,
        startDate: key,
        endDate:   weekEndDate(key),
        count,
        change: prev !== null ? count - prev : null,
      };
    });

    const peakIdx = weekly.reduce((mi, w, i) => w.count > weekly[mi].count ? i : mi, 0);

    const DOW_LABELS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
    const DOW_IDX    = [2, 3, 4, 5, 6, 0, 1];

    return {
      cachedAt: new Date().toISOString(),
      profile: {
        name:       profile?.name      ?? "Elon Musk",
        handle:     profile?.handle    ?? "elonmusk",
        avatarUrl:  profile?.avatarUrl ?? null,
        totalPosts: profile?._count?.posts ?? posts.length,
      },
      summary: {
        totalPosts: posts.length,
        totalWeeks: weekly.length,
        avgPerWeek: Math.round(posts.length / weekly.length),
        peakWeek:   weekly[peakIdx],
        firstDate:  posts[0]?.createdAt?.slice(0, 10),
        lastDate:   posts[posts.length - 1]?.createdAt?.slice(0, 10),
      },
      contentTypes: {
        retweets: rtCount,
        original: posts.length - rtCount - replyCount,
        replies:  replyCount,
      },
      weekly,
      dayOfWeek: DOW_LABELS.map((label, i) => ({ day: label, count: dowCounts[DOW_IDX[i]] })),
      hourly:    hourCounts.map((count, h) => ({ hour: h, count })),
    };
  },
  ["elon-stats"],          // cache key
  { revalidate: 21600 }   // 6 hours
);

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getElonStats();
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

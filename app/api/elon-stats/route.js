import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Weeks are anchored to Tue 16:00 UTC (noon EDT) matching Polymarket's tracking periods.
// Anchor = 2026-04-28T16:00:00Z. Each week = [anchor - (n+1)*7d, anchor - n*7d).
const ANCHOR_MS = new Date("2026-04-28T16:00:00.000Z").getTime();
const WEEK_MS   = 7 * 24 * 60 * 60 * 1000;

// Returns the ISO date string of the week-start that contains the given timestamp.
// Week-start is always a Tuesday at 16:00 UTC.
function getWeekKey(iso) {
  const t = new Date(iso).getTime();
  const diffMs = ANCHOR_MS - t;
  if (diffMs <= 0) {
    // At or after anchor → belongs to the anchor week (starts 2026-04-28)
    return new Date(ANCHOR_MS).toISOString().slice(0, 10);
  }
  const n = Math.floor(diffMs / WEEK_MS);
  // Week n starts at ANCHOR_MS - (n+1)*WEEK_MS
  return new Date(ANCHOR_MS - (n + 1) * WEEK_MS).toISOString().slice(0, 10);
}

// The display end-date for a week is the date of the NEXT week's boundary
// (matching Polymarket's "April 21 – April 28" format).
function weekEndDate(startKey) {
  const startMs = new Date(startKey + "T16:00:00.000Z").getTime();
  return new Date(startMs + WEEK_MS).toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const cwd = process.cwd();
    const files = readdirSync(cwd)
      .filter((f) => f.startsWith("elon-xtracker-") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (!files.length) {
      return Response.json(
        { error: "No elon-xtracker-*.json file found in project root. Download it first." },
        { status: 404 }
      );
    }

    const raw = JSON.parse(readFileSync(join(cwd, files[0]), "utf8"));
    const { posts, profile } = raw;

    // ── Bucket every post into its week ────────────────────────────────────────
    const weekMap = {};
    const dowCounts  = Array(7).fill(0); // 0=Sun … 6=Sat
    const hourCounts = Array(24).fill(0);
    let rtCount    = 0;
    let replyCount = 0;

    for (const p of posts) {
      const key = getWeekKey(p.createdAt);
      weekMap[key] = (weekMap[key] || 0) + 1;

      const dt = new Date(p.createdAt);
      dowCounts[dt.getUTCDay()]++;
      hourCounts[dt.getUTCHours()]++;

      if (p.content?.startsWith("RT @")) rtCount++;
      else if (p.content?.startsWith("@")) replyCount++;
    }

    // ── Build sorted weekly array (oldest → newest) ────────────────────────────
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

    const counts  = weekly.map((w) => w.count);
    const peakIdx = counts.indexOf(Math.max(...counts));

    // Day-of-week in Tue→Mon order (matching the week anchor day)
    const DOW_LABELS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
    const DOW_IDX    = [2, 3, 4, 5, 6, 0, 1];
    const dayOfWeek  = DOW_LABELS.map((label, i) => ({ day: label, count: dowCounts[DOW_IDX[i]] }));

    const hourly = hourCounts.map((count, h) => ({ hour: h, count }));

    return Response.json({
      dataFile:  files[0],
      fetchedAt: raw.fetchedAt,
      profile: {
        name:       profile?.name       ?? "Elon Musk",
        handle:     profile?.handle     ?? "elonmusk",
        avatarUrl:  profile?.avatarUrl  ?? null,
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
      dayOfWeek,
      hourly,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

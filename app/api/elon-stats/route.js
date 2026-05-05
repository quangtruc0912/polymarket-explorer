import { syncPosts } from "../../../lib/elonPosts";

const ANCHOR_MS = new Date("2026-04-28T16:00:00.000Z").getTime();
const WEEK_MS   = 7 * 24 * 60 * 60 * 1000;

function getWeekKey(iso) {
  const t      = new Date(iso).getTime();
  const diffMs = ANCHOR_MS - t;
  if (diffMs <= 0) return new Date(ANCHOR_MS).toISOString().slice(0, 10);
  const n = Math.floor(diffMs / WEEK_MS);
  return new Date(ANCHOR_MS - (n + 1) * WEEK_MS).toISOString().slice(0, 10);
}

function weekEndDate(startKey) {
  const ms = new Date(startKey + "T16:00:00.000Z").getTime();
  return new Date(ms + WEEK_MS).toISOString().slice(0, 10);
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { posts, newCount, totalCount, lastPostAt } = await syncPosts();

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

      if (p.content?.startsWith("RT @"))   rtCount++;
      else if (p.content?.startsWith("@")) replyCount++;
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

    const peakIdx = weekly.reduce((mi, w, i) => (w.count > weekly[mi].count ? i : mi), 0);

    const DOW_LABELS = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"];
    const DOW_IDX    = [2, 3, 4, 5, 6, 0, 1];

    return Response.json({
      fetchedAt: new Date().toISOString(),
      newCount,
      dataFile:  `elon-posts.json (${totalCount.toLocaleString()} posts${newCount > 0 ? `, +${newCount} new` : ""})`,
      profile: {
        name:       "Elon Musk",
        handle:     "elonmusk",
        avatarUrl:  null,
        totalPosts: totalCount,
      },
      summary: {
        totalPosts: posts.length,
        totalWeeks: weekly.length,
        avgPerWeek: Math.round(posts.length / weekly.length),
        peakWeek:   weekly[peakIdx],
        firstDate:  posts[0]?.createdAt?.slice(0, 10),
        lastDate:   lastPostAt?.slice(0, 10),
      },
      contentTypes: {
        retweets: rtCount,
        original: posts.length - rtCount - replyCount,
        replies:  replyCount,
      },
      weekly,
      dayOfWeek: DOW_LABELS.map((label, i) => ({ day: label, count: dowCounts[DOW_IDX[i]] })),
      hourly:    hourCounts.map((count, h) => ({ hour: h, count })),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

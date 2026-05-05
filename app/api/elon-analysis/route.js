import { syncPosts } from "../../../lib/elonPosts";
import { syncAnalysis, analyzeWeek } from "../../../lib/elonAnalysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }
  try {
    const weekKey = new URL(request.url).searchParams.get("week");
    const { posts } = await syncPosts();

    if (weekKey) {
      const { reason, cached } = await analyzeWeek(posts, weekKey);
      return Response.json({ week: weekKey, reason, cached });
    }

    const { analyses, newCount, avg, highThreshold, lowThreshold } = await syncAnalysis(posts);
    return Response.json({
      fetchedAt:     new Date().toISOString(),
      newCount,
      analyses,
      avg,
      highThreshold,
      lowThreshold,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

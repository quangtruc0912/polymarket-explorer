import { syncPosts } from "../../../lib/elonPosts";

const XTRACKER_BASE = "https://xtracker.polymarket.com/api";
const ELON_HANDLE   = "elonmusk";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  Accept:       "application/json",
  Referer:      "https://xtracker.polymarket.com/",
  Origin:       "https://xtracker.polymarket.com",
};

async function fetchXtracker(path) {
  const r = await fetch(`${XTRACKER_BASE}${path}`, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`xtracker ${path} → ${r.status}`);
  const json = await r.json();
  return json.success ? json.data : null;
}

export async function GET() {
  try {
    const [profile, trackings, { posts, newCount, totalCount }] = await Promise.all([
      fetchXtracker(`/users/${ELON_HANDLE}`),
      fetchXtracker(`/users/${ELON_HANDLE}/trackings`),
      syncPosts(),
    ]);

    const userId = profile?.id ?? null;
    const metrics = userId ? await fetchXtracker(`/metrics/${userId}`) : [];

    return Response.json({
      fetchedAt:  new Date().toISOString(),
      newCount,
      totalCount,
      profile,
      trackings:  trackings ?? [],
      metrics:    metrics   ?? [],
      posts,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

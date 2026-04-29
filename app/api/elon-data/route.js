const XTRACKER_BASE = "https://xtracker.polymarket.com/api";
const ELON_HANDLE = "elonmusk";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://xtracker.polymarket.com/",
  "Origin": "https://xtracker.polymarket.com",
};

async function fetchXtracker(path) {
  const r = await fetch(`${XTRACKER_BASE}${path}`, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`xtracker ${path} → ${r.status}`);
  const json = await r.json();
  return json.success ? json.data : null;
}

// Paginate backwards through all posts using endDate sliding window.
// Each call returns up to 500 posts; we keep going until a batch is < 500.
async function fetchAllPosts() {
  const seen = new Set();
  const all = [];
  let endDate = null;

  for (let page = 0; page < 100; page++) {
    const url = new URL(`${XTRACKER_BASE}/users/${ELON_HANDLE}/posts`);
    if (endDate) url.searchParams.set("endDate", endDate);

    const r = await fetch(url.toString(), { headers: HEADERS, cache: "no-store" });
    if (!r.ok) break;
    const json = await r.json();
    const batch = json.success && Array.isArray(json.data) ? json.data : [];
    if (batch.length === 0) break;

    let added = 0;
    for (const post of batch) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        all.push(post);
        added++;
      }
    }

    if (batch.length < 500) break;

    // Slide window: use oldest post createdAt minus 1ms as next endDate
    const oldestTs = batch.reduce(
      (min, p) => (p.createdAt < min ? p.createdAt : min),
      batch[0].createdAt
    );
    const next = new Date(new Date(oldestTs).getTime() - 1).toISOString();
    if (next === endDate) break; // no progress guard
    endDate = next;
  }

  // Sort chronologically ascending
  all.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  return all;
}

export async function GET() {
  try {
    // Profile + trackings in parallel
    const [profile, trackings] = await Promise.all([
      fetchXtracker(`/users/${ELON_HANDLE}`),
      fetchXtracker(`/users/${ELON_HANDLE}/trackings`),
    ]);

    const userId = profile?.id ?? null;

    // Metrics + all posts in parallel (metrics needs userId)
    const [metrics, posts] = await Promise.all([
      userId ? fetchXtracker(`/metrics/${userId}`) : Promise.resolve([]),
      fetchAllPosts(),
    ]);

    return Response.json({
      fetchedAt: new Date().toISOString(),
      profile,
      trackings: trackings ?? [],
      metrics: metrics ?? [],
      posts,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const XTRACKER_BASE = "https://xtracker.polymarket.com/api";
const ELON_HANDLE   = "elonmusk";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  Accept:       "application/json",
  Referer:      "https://xtracker.polymarket.com/",
  Origin:       "https://xtracker.polymarket.com",
};

const DATA_DIR   = process.env.VERCEL ? "/tmp" : join(process.cwd(), "data");
const POSTS_FILE = join(DATA_DIR, "elon-posts.json");

// ── Persistence ───────────────────────────────────────────────────────────────

function loadStored() {
  try {
    if (!existsSync(POSTS_FILE)) return [];
    return JSON.parse(readFileSync(POSTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePosts(posts) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(POSTS_FILE, JSON.stringify(posts), "utf8");
}

// ── Incremental fetch ─────────────────────────────────────────────────────────
// Fetches newest posts first, stopping as soon as the oldest post in a batch
// predates `newestDate` (i.e. we've reached already-stored territory).
// If newestDate is null we fetch everything (first run).

async function fetchPostsSince(newestDate, maxPages = 100) {
  const seen     = new Set();
  const newPosts = [];
  let endDate    = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${XTRACKER_BASE}/users/${ELON_HANDLE}/posts`);
    if (endDate) url.searchParams.set("endDate", endDate);

    const r = await fetch(url.toString(), { headers: HEADERS, cache: "no-store" });
    if (!r.ok) break;

    const json  = await r.json();
    const batch = json.success && Array.isArray(json.data) ? json.data : [];
    if (batch.length === 0) break;

    const oldestInBatch = batch.reduce(
      (min, p) => (p.createdAt < min ? p.createdAt : min),
      batch[0].createdAt
    );

    // Collect only genuinely new posts
    for (const post of batch) {
      if (!seen.has(post.id) && (!newestDate || post.createdAt > newestDate)) {
        seen.add(post.id);
        newPosts.push(post);
      }
    }

    // Stop once we've reached posts older than what we already have
    if (newestDate && oldestInBatch <= newestDate) break;
    if (batch.length < 500) break;

    const next = new Date(new Date(oldestInBatch).getTime() - 1).toISOString();
    if (next === endDate) break;
    endDate = next;
  }

  return newPosts;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load stored posts from disk, fetch any new ones from xtracker,
 * merge, save, and return all posts sorted chronologically.
 *
 * Returns { posts, newCount, totalCount, lastPostAt }
 */
export async function syncPosts() {
  const stored = loadStored();

  const newestDate =
    stored.length > 0
      ? stored.reduce((max, p) => (p.createdAt > max ? p.createdAt : max), stored[0].createdAt)
      : null;

  // On cold start (empty cache) limit pages so we don't time out on Vercel;
  // warm incremental syncs get the full 100-page budget.
  const maxPages = newestDate ? 100 : 5;
  const newPosts = await fetchPostsSince(newestDate, maxPages);

  if (newPosts.length === 0) {
    return {
      posts:       stored,
      newCount:    0,
      totalCount:  stored.length,
      lastPostAt:  newestDate,
    };
  }

  // Merge — Map ensures deduplication by id
  const byId = new Map(stored.map((p) => [p.id, p]));
  for (const p of newPosts) byId.set(p.id, p);

  const merged = Array.from(byId.values()).sort((a, b) =>
    a.createdAt > b.createdAt ? 1 : -1
  );

  savePosts(merged);

  const lastPostAt = merged[merged.length - 1]?.createdAt ?? null;
  return {
    posts:      merged,
    newCount:   newPosts.length,
    totalCount: merged.length,
    lastPostAt,
  };
}

/** Read stored posts without hitting the network. */
export function readStoredPosts() {
  return loadStored();
}

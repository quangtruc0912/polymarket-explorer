# Polymarket Explorer

Next.js 14 App Router app. No TypeScript, no `jsconfig.json`, no `next.config.js` — use **relative imports only** (never `@/`).

## Stack
- Next.js 14 App Router (`app/` directory, `route.js` files)
- Plain JavaScript (`.js`, `.jsx`)
- No component library, raw inline styles
- Anthropic SDK (`@anthropic-ai/sdk`) for Claude analysis

## Key env vars
- `ANTHROPIC_API_KEY` — required for `/api/elon-analysis`
- `VERCEL` — auto-set by Vercel, used to switch data dir to `/tmp`

## File layout

```
app/
  page.js                  # Single-page app, all UI components inline
  api/
    markets/route.js        # Polymarket + Gamma API — prediction markets
    elon-tweets/route.js    # Polymarket trackings + market events for Elon
    elon-stats/route.js     # Weekly tweet stats (uses syncPosts)
    elon-data/route.js      # Full xtracker profile + posts (uses syncPosts)
    elon-analysis/route.js  # Claude analysis per week (uses syncPosts + syncAnalysis)
lib/
  elonPosts.js              # Incremental post fetcher + file cache
  elonAnalysis.js           # Per-week Claude analysis + file cache
data/                       # Gitignored, local only
  elon-posts.json           # Cached xtracker posts
  elon-analysis.json        # Cached Claude analysis keyed by week start date
```

## Data flow

**Posts:** `xtracker.polymarket.com` → `lib/elonPosts.js` → `data/elon-posts.json`
- `syncPosts()` — incremental fetch (only new posts since last stored), merges by `id`, saves to disk
- `readStoredPosts()` — read-only, no network

**Analysis:** posts → `lib/elonAnalysis.js` → `data/elon-analysis.json`
- `syncAnalysis(posts)` — groups posts by week, sends all unanalyzed weeks to Claude in one call, saves merged result
- `analyzeWeek(posts, weekKey)` — on-demand single-week analysis, also saves to disk
- Stored analysis is keyed by week start date (`"YYYY-MM-DD": "reason..."`)

**Week bucketing:** fixed anchor `2026-04-28T16:00:00Z`, 7-day buckets backwards. `getWeekKey(iso)` in both lib files.

## Vercel notes
- Filesystem is read-only except `/tmp` — both lib files check `process.env.VERCEL` and switch `DATA_DIR` to `/tmp`
- `/tmp` is ephemeral (resets on cold start) — no persistent cache on Vercel
- `elon-analysis/route.js` has `export const maxDuration = 60` for Claude timeout

## UI structure (`app/page.js`)
- Two tabs: **Markets** and **Elon Tweets**
- `ElonTweetsTab` fetches `/api/elon-stats` and `/api/elon-analysis` in parallel on mount
- Weekly table shows Claude analysis inline; `analysisLoading` drives "analyzing…" placeholders
- Per-row "Ask why" button calls `/api/elon-analysis?week=YYYY-MM-DD` for on-demand single-week analysis
- `rowStates` — `{ [weekKey]: { loading, reason } }` — tracks in-flight per-row requests

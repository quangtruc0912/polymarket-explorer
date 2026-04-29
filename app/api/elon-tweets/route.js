const XTRACKER_API = "https://xtracker.polymarket.com/api/users/elonmusk/trackings?platform=X";
const GAMMA_API = "https://gamma-api.polymarket.com";

async function fetchJson(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "polymarket-explorer/1.0" },
      cache: "no-store",
    });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

function slugFromLink(marketLink) {
  if (!marketLink) return null;
  const m = marketLink.match(/polymarket\.com\/event\/(.+)$/);
  return m ? m[1].trim() : null;
}

function extractPeriod(title) {
  if (!title) return "";
  // "Elon Musk # tweets April 24 - May 1, 2026?" → "April 24 – May 1, 2026"
  const m = title.match(
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d+\s*[-–]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+)?\d+(?:,\s*\d{4})?)/i
  );
  return m ? m[1].trim() : title.replace(/^Elon Musk.*?#.*?tweets?\s*/i, "").replace(/\?$/, "").trim();
}

function extractBrackets(markets) {
  const brackets = [];
  let totalVolume = 0;
  let totalLiquidity = 0;

  for (const m of markets) {
    let prices = [];
    let outcomes = [];
    try { prices = JSON.parse(m.outcomePrices || "[]").map(Number); } catch {}
    try { outcomes = JSON.parse(m.outcomes || "[]"); } catch {}

    totalVolume += m.volumeNum ?? parseFloat(m.volume ?? 0);
    totalLiquidity += m.liquidityNum ?? parseFloat(m.liquidity ?? 0);

    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");

    if (yesIdx >= 0 && outcomes.length <= 2) {
      // Binary Yes/No — bracket is in the question after "?"
      const bm = (m.question || "").match(/\?\s*(.+)$/);
      const bracket = bm ? bm[1].trim() : null;
      if (bracket) brackets.push({ bracket, probability: prices[yesIdx] ?? 0, resolved: m.resolved ?? false });
    } else {
      // Multi-outcome — each outcome is a tweet-count range
      outcomes.forEach((out, i) => {
        if (!out || ["yes", "no"].includes(out.toLowerCase())) return;
        brackets.push({ bracket: out, probability: prices[i] ?? 0, resolved: m.resolved ?? false });
      });
    }
  }

  return { brackets, totalVolume, totalLiquidity };
}

function buildPeriod(tracking, event) {
  const title = tracking.title?.trim() ?? "";
  const slug = tracking.slug;
  const endDate = tracking.endDate?.slice(0, 10) ?? null;

  // No Polymarket event data — return skeleton row
  if (!event || Array.isArray(event)) {
    return { id: slug, period: extractPeriod(title), fullTitle: title, endDate, slug, winner: null, brackets: [], volume: 0, liquidity: 0, isResolved: false, noMarket: true };
  }

  const allMarkets = event.markets ?? [];
  const { brackets, totalVolume, totalLiquidity } = extractBrackets(allMarkets);

  const resolvedWinner = brackets.find((b) => b.resolved && b.probability >= 0.95);
  const leader = brackets.length > 0
    ? brackets.reduce((a, b) => (b.probability > a.probability ? b : a), brackets[0])
    : null;
  const winner = resolvedWinner ?? leader ?? null;

  return {
    id: slug,
    period: extractPeriod(title),
    fullTitle: title,
    endDate: event.endDate?.slice(0, 10) ?? endDate,
    slug,
    winner: winner ? { bracket: winner.bracket, probability: winner.probability } : null,
    brackets: brackets.sort((a, b) => b.probability - a.probability),
    volume: totalVolume,
    liquidity: totalLiquidity,
    isResolved: brackets.some((b) => b.resolved && b.probability >= 0.95),
    noMarket: false,
  };
}

export async function GET() {
  try {
    // ── Step 1: get all trackings from xtracker ──────────────────────────────
    let xtrackerRaw = null;
    let xtrackerStatus = null;
    let xtrackerBody = null;
    try {
      const r = await fetch(XTRACKER_API, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          "Accept": "application/json",
          "Referer": "https://xtracker.polymarket.com/",
          "Origin": "https://xtracker.polymarket.com",
        },
        cache: "no-store",
      });
      xtrackerStatus = r.status;
      xtrackerBody = await r.text();
      if (r.ok) xtrackerRaw = JSON.parse(xtrackerBody);
    } catch (e) {
      return Response.json({ error: `xtracker fetch failed: ${e.message}` }, { status: 502 });
    }

    // Unwrap common envelope shapes: { data: [] }, { items: [] }, { trackings: [] }, etc.
    let trackings = xtrackerRaw;
    if (!Array.isArray(trackings) && xtrackerRaw && typeof xtrackerRaw === "object") {
      trackings =
        xtrackerRaw.data ??
        xtrackerRaw.items ??
        xtrackerRaw.trackings ??
        xtrackerRaw.results ??
        null;
    }

    if (!Array.isArray(trackings)) {
      return Response.json({
        error: `xtracker 200 but unexpected shape: ${xtrackerBody?.slice(0, 300)}`,
      }, { status: 502 });
    }

    // ── Step 2: build list of slugs (skip entries with no marketLink) ─────────
    const items = trackings
      .map((t) => ({
        slug: slugFromLink(t.marketLink),
        title: t.title?.trim() ?? "",
        startDate: t.startDate,
        endDate: t.endDate,
        isActive: t.isActive,
      }))
      .filter((t) => t.slug); // only entries that have a Polymarket market

    // Deduplicate by slug
    const seen = new Set();
    const unique = items.filter((t) => {
      if (seen.has(t.slug)) return false;
      seen.add(t.slug);
      return true;
    });

    // ── Step 3: batch-fetch each event by slug (events embed their markets) ───
    const BATCH = 8;
    const periods = [];

    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const events = await Promise.all(
        batch.map((t) => fetchJson(`${GAMMA_API}/events/${t.slug}`))
      );
      for (let j = 0; j < batch.length; j++) {
        const ev = events[j];
        const row = buildPeriod(batch[j], (!ev || Array.isArray(ev)) ? null : ev);
        if (row) periods.push(row);
      }
    }

    periods.sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
    return Response.json({ periods });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

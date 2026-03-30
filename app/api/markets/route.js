const GAMMA_API = "https://gamma-api.polymarket.com";
const PAGE_SIZE = 500;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "0", 10);
  const offset = page * PAGE_SIZE;

  try {
    const res = await fetch(
      `${GAMMA_API}/markets?active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}`,
      {
        headers: { "User-Agent": "polymarket-explorer/1.0" },
        next: { revalidate: 60 },
      }
    );

    if (!res.ok) {
      return Response.json({ error: `Upstream error: ${res.status}` }, { status: 502 });
    }

    const raw = await res.json();

    const markets = raw.map((m) => {
      let prices = [];
      let outcomes = [];
      try { prices = JSON.parse(m.outcomePrices || "[]").map(Number); } catch {}
      try { outcomes = JSON.parse(m.outcomes || "[]"); } catch {}

      // Find the leading (highest probability) outcome
      let leadIdx = 0;
      for (let i = 1; i < prices.length; i++) {
        if (prices[i] > prices[leadIdx]) leadIdx = i;
      }

      const eventSlug = m.events?.[0]?.slug ?? m.slug ?? "";

      return {
        id: m.id,
        question: m.question ?? "",
        slug: eventSlug,
        outcome: outcomes[leadIdx] ?? "Yes",
        probability: prices[leadIdx] ?? null,
        allOutcomes: outcomes.map((o, i) => ({ outcome: o, price: prices[i] ?? 0 })),
        volume: m.volumeNum ?? parseFloat(m.volume ?? 0),
        volume24hr: parseFloat(m.volume24hr ?? 0),
        liquidity: m.liquidityNum ?? parseFloat(m.liquidity ?? 0),
        endDate: m.endDateIso ?? (m.endDate ? m.endDate.slice(0, 10) : null),
        dayChange: parseFloat(m.oneDayPriceChange ?? 0),
      };
    });

    return Response.json({
      markets,
      page,
      hasMore: raw.length === PAGE_SIZE,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

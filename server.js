const express = require("express");
const app = express();
const PORT = 3000;

const GAMMA_API = "https://gamma-api.polymarket.com";

// ─── API helpers ────────────────────────────────────────────────────────────

async function fetchMarkets(limit = 500, offset = 0) {
  const url =
    `${GAMMA_API}/markets?active=true&closed=false&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "polymarket-checker/1.0" },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Parse prices from a market. Returns array of { outcome, price } */
function getOutcomePrices(market) {
  // Method 1: outcomePrices is a JSON string e.g. '["0.97","0.03"]'
  if (market.outcomePrices) {
    try {
      const prices = JSON.parse(market.outcomePrices);
      const outcomes = market.outcomes ? JSON.parse(market.outcomes) : [];
      return prices.map((p, i) => ({
        outcome: outcomes[i] ?? `Outcome ${i + 1}`,
        price: parseFloat(p),
      }));
    } catch {}
  }

  // Method 2: tokens array with .price field
  if (Array.isArray(market.tokens)) {
    return market.tokens
      .filter((t) => t.price != null)
      .map((t) => ({ outcome: t.outcome ?? "Yes", price: parseFloat(t.price) }));
  }

  return [];
}

async function collectNearlyDecided(minProb = 0.97, maxProb = 0.99) {
  const results = [];
  let offset = 0;
  const limit = 500;
  let totalScanned = 0;

  while (true) {
    const markets = await fetchMarkets(limit, offset);
    if (!markets || markets.length === 0) break;

    for (const market of markets) {
      const prices = getOutcomePrices(market);
      for (const { outcome, price } of prices) {
        if (price >= minProb && price <= maxProb) {
          results.push({
            question: market.question ?? "Unknown",
            outcome,
            probability: price,
            volume: parseFloat(market.volume ?? 0),
            liquidity: parseFloat(market.liquidity ?? 0),
            endDate: market.endDate ?? market.end_date ?? null,
            url: market.slug
              ? `https://polymarket.com/event/${market.slug}`
              : null,
          });
          break; // one entry per market (the leading outcome)
        }
      }
    }

    totalScanned += markets.length;
    console.log(`Scanned ${totalScanned}, found ${results.length}...`);

    if (markets.length < limit) break;
    offset += limit;
  }

  results.sort((a, b) => b.probability - a.probability || b.volume - a.volume);
  return { results, totalScanned };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get("/api/markets", async (req, res) => {
  const minProb = parseFloat(req.query.min ?? "97") / 100;
  const maxProb = parseFloat(req.query.max ?? "99") / 100;
  try {
    const data = await collectNearlyDecided(minProb, maxProb);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Polymarket — Nearly Decided Markets</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem; }
    .subtitle { color: #718096; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .controls { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .controls label { font-size: 0.85rem; color: #a0aec0; }
    .controls input { width: 70px; padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid #2d3748; background: #1a202c; color: #e2e8f0; font-size: 0.9rem; }
    button { padding: 0.45rem 1.2rem; border-radius: 6px; border: none; background: #4f46e5; color: #fff; font-size: 0.9rem; cursor: pointer; font-weight: 600; }
    button:hover { background: #4338ca; }
    button:disabled { background: #2d3748; color: #718096; cursor: not-allowed; }
    #status { font-size: 0.85rem; color: #a0aec0; margin-bottom: 1rem; min-height: 1.2rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    thead th { text-align: left; padding: 0.6rem 0.8rem; color: #a0aec0; border-bottom: 1px solid #2d3748; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #1a202c; transition: background 0.1s; }
    tbody tr:hover { background: #1a202c; }
    td { padding: 0.75rem 0.8rem; vertical-align: middle; }
    .prob { font-weight: 700; font-size: 1rem; }
    .prob-high { color: #48bb78; }
    .prob-very-high { color: #f6ad55; }
    .question a { color: #90cdf4; text-decoration: none; }
    .question a:hover { text-decoration: underline; }
    .outcome-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #2d3748; font-size: 0.78rem; color: #a0aec0; }
    .vol { color: #68d391; }
    .date { color: #718096; font-size: 0.8rem; }
    .empty { text-align: center; padding: 3rem; color: #718096; }
    .bar-bg { width: 100%; height: 6px; background: #2d3748; border-radius: 3px; margin-top: 4px; }
    .bar-fill { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #4f46e5, #48bb78); }
  </style>
</head>
<body>
  <h1>Polymarket — Nearly Decided Markets</h1>
  <p class="subtitle">Markets where one outcome has probability between your chosen range</p>

  <div class="controls">
    <label>Min %: <input id="minP" type="number" value="97" min="1" max="99" /></label>
    <label>Max %: <input id="maxP" type="number" value="99" min="1" max="100" /></label>
    <button id="fetchBtn" onclick="loadMarkets()">Fetch Markets</button>
  </div>

  <div id="status">Press "Fetch Markets" to start.</div>
  <div id="tableWrap"></div>

  <script>
    async function loadMarkets() {
      const btn = document.getElementById("fetchBtn");
      const status = document.getElementById("status");
      const wrap = document.getElementById("tableWrap");
      const min = document.getElementById("minP").value;
      const max = document.getElementById("maxP").value;

      btn.disabled = true;
      btn.textContent = "Loading…";
      status.textContent = "Fetching markets… this may take a moment.";
      wrap.innerHTML = "";

      try {
        const res = await fetch(\`/api/markets?min=\${min}&max=\${max}\`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const { results, totalScanned } = data;
        status.textContent = \`Found \${results.length} markets out of \${totalScanned.toLocaleString()} scanned.\`;

        if (results.length === 0) {
          wrap.innerHTML = \`<div class="empty">No markets found in the \${min}–\${max}% range.</div>\`;
          return;
        }

        const rows = results.map((r) => {
          const pct = (r.probability * 100).toFixed(1);
          const probClass = r.probability >= 0.99 ? "prob-very-high" : "prob-high";
          const vol = r.volume > 0 ? \`$\${r.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}\` : "—";
          const endDate = r.endDate ? r.endDate.slice(0, 10) : "—";
          const link = r.url
            ? \`<a href="\${r.url}" target="_blank" rel="noopener">\${escHtml(r.question)}</a>\`
            : escHtml(r.question);
          const barWidth = Math.round(r.probability * 100);
          return \`<tr>
            <td><span class="prob \${probClass}">\${pct}%</span>
              <div class="bar-bg"><div class="bar-fill" style="width:\${barWidth}%"></div></div>
            </td>
            <td class="question">\${link}</td>
            <td><span class="outcome-badge">\${escHtml(r.outcome)}</span></td>
            <td class="vol">\${vol}</td>
            <td class="date">\${endDate}</td>
          </tr>\`;
        }).join("");

        wrap.innerHTML = \`<table>
          <thead><tr>
            <th>Prob</th><th>Market</th><th>Outcome</th><th>Volume</th><th>End Date</th>
          </tr></thead>
          <tbody>\${rows}</tbody>
        </table>\`;
      } catch (err) {
        status.textContent = "Error: " + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "Fetch Markets";
      }
    }

    function escHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
  </script>
</body>
</html>`);
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

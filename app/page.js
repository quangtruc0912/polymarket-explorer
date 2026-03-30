"use client";

import { useState, useCallback, useMemo } from "react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function probColor(p) {
  if (p >= 0.97) return "prob-high";
  if (p >= 0.5) return "prob-mid";
  return "prob-low";
}

function barColor(p) {
  if (p >= 0.97) return "#3fb950";
  if (p >= 0.7) return "#d29922";
  if (p >= 0.5) return "#58a6ff";
  return "#7d8590";
}

function fmtVolume(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  if (v > 0) return `$${v.toFixed(0)}`;
  return "—";
}

function isEndingSoon(dateStr) {
  if (!dateStr) return false;
  const diff = new Date(dateStr) - new Date();
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
}

function endingWithinMs(label) {
  const now = Date.now();
  const d = (days) => now + days * 24 * 60 * 60 * 1000;
  if (label === "today")   return d(1);
  if (label === "1week")   return d(7);
  if (label === "2weeks")  return d(14);
  if (label === "1month")  return d(30);
  if (label === "2months") return d(60);
  return null;
}

function fmtChange(v) {
  if (v === 0 || v == null) return null;
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function SortIcon({ dir }) {
  return <span className="sort-icon">{dir === "asc" ? "↑" : "↓"}</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  const [allMarkets, setAllMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextPage, setNextPage] = useState(0);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState("");
  const [minProb, setMinProb] = useState("");
  const [maxProb, setMaxProb] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [minLiquidity, setMinLiquidity] = useState("");
  const [endingWithin, setEndingWithin] = useState("any");
  const [dayChangeDir, setDayChangeDir] = useState("any"); // "rising" | "falling" | "any"

  // Sort
  const [sortKey, setSortKey] = useState("probability");
  const [sortDir, setSortDir] = useState("desc");

  // ── Fetch one page ──────────────────────────────────────────────────────────
  const fetchPage = useCallback(async (page) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets?page=${page}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAllMarkets((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const fresh = data.markets.filter((m) => !existingIds.has(m.id));
        return [...prev, ...fresh];
      });
      setHasMore(data.hasMore);
      setNextPage(page + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Load all pages ──────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoadingAll(true);
    let page = nextPage;
    try {
      while (true) {
        const res = await fetch(`/api/markets?page=${page}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setAllMarkets((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = data.markets.filter((m) => !existingIds.has(m.id));
          return [...prev, ...fresh];
        });
        if (!data.hasMore) {
          setHasMore(false);
          setNextPage(page + 1);
          break;
        }
        page++;
        setNextPage(page);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAll(false);
      setLoading(false);
    }
  }, [nextPage]);

  // ── Reset + reload ──────────────────────────────────────────────────────────
  function reload() {
    setAllMarkets([]);
    setNextPage(0);
    setHasMore(false);
    fetchPage(0);
  }

  // ── Filter + Sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lo = minProb !== "" ? parseFloat(minProb) / 100 : 0;
    const hi = maxProb !== "" ? parseFloat(maxProb) / 100 : 1;
    const volFloor = minVolume !== "" ? parseFloat(minVolume) : 0;
    const liqFloor = minLiquidity !== "" ? parseFloat(minLiquidity) : 0;
    const endCeil = endingWithinMs(endingWithin);

    return allMarkets
      .filter((m) => {
        if (q && !m.question.toLowerCase().includes(q)) return false;
        const p = m.probability;
        if (p === null) return false;
        if (p < lo || p > hi) return false;
        if (m.volume < volFloor) return false;
        if (m.liquidity < liqFloor) return false;
        if (endCeil !== null) {
          if (!m.endDate) return false;
          const t = new Date(m.endDate).getTime();
          if (t > endCeil || t < Date.now()) return false;
        }
        if (dayChangeDir === "rising" && m.dayChange <= 0) return false;
        if (dayChangeDir === "falling" && m.dayChange >= 0) return false;
        return true;
      })
      .sort((a, b) => {
        let av, bv;
        if (sortKey === "probability")  { av = a.probability ?? -1; bv = b.probability ?? -1; }
        else if (sortKey === "volume")  { av = a.volume;   bv = b.volume; }
        else if (sortKey === "vol24h")  { av = a.volume24hr; bv = b.volume24hr; }
        else if (sortKey === "liquidity") { av = a.liquidity; bv = b.liquidity; }
        else if (sortKey === "endDate") { av = a.endDate ?? "9999"; bv = b.endDate ?? "9999"; }
        else if (sortKey === "dayChange") { av = a.dayChange; bv = b.dayChange; }
        else { av = 0; bv = 0; }
        return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
  }, [allMarkets, search, minProb, maxProb, minVolume, minLiquidity, endingWithin, dayChangeDir, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function clearFilters() {
    setSearch(""); setMinProb(""); setMaxProb("");
    setMinVolume(""); setMinLiquidity("");
    setEndingWithin("any"); setDayChangeDir("any");
  }

  const started = allMarkets.length > 0 || loading;
  const anyFilter = search || minProb || maxProb || minVolume || minLiquidity || endingWithin !== "any" || dayChangeDir !== "any";

  return (
    <div className="container">
      <div className="header">
        <h1>Polymarket Explorer</h1>
        <p>Browse and filter active prediction markets</p>
      </div>

      {/* Filters */}
      <div className="filters">
        {/* Row 1 */}
        <div className="filter-group" style={{ flexBasis: "100%", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="filter-group">
            <label>Search</label>
            <input
              type="text"
              placeholder="Filter by question…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <label>Probability</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" placeholder="0%" min="0" max="100" value={minProb}
                onChange={(e) => setMinProb(e.target.value)} />
              <span style={{ color: "var(--muted)" }}>–</span>
              <input type="number" placeholder="100%" min="0" max="100" value={maxProb}
                onChange={(e) => setMaxProb(e.target.value)} />
            </div>
          </div>

          <div className="filter-group">
            <label>Min Volume ($)</label>
            <input type="number" placeholder="0" min="0" value={minVolume}
              style={{ width: 110 }}
              onChange={(e) => setMinVolume(e.target.value)} />
          </div>

          <div className="filter-group">
            <label>Min Liquidity ($)</label>
            <input type="number" placeholder="0" min="0" value={minLiquidity}
              style={{ width: 110 }}
              onChange={(e) => setMinLiquidity(e.target.value)} />
          </div>

          <div className="filter-group">
            <label>Ending Within</label>
            <select value={endingWithin} onChange={(e) => setEndingWithin(e.target.value)}>
              <option value="any">Any time</option>
              <option value="today">Today</option>
              <option value="1week">1 week</option>
              <option value="2weeks">2 weeks</option>
              <option value="1month">1 month</option>
              <option value="2months">2 months</option>
            </select>
          </div>

          <div className="filter-group">
            <label>24h Trend</label>
            <select value={dayChangeDir} onChange={(e) => setDayChangeDir(e.target.value)}>
              <option value="any">Any</option>
              <option value="rising">Rising ↑</option>
              <option value="falling">Falling ↓</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Sort By</label>
            <select value={sortKey} onChange={(e) => { setSortKey(e.target.value); setSortDir("desc"); }}>
              <option value="probability">Probability</option>
              <option value="volume">Total Volume</option>
              <option value="vol24h">24h Volume</option>
              <option value="liquidity">Liquidity</option>
              <option value="endDate">End Date</option>
              <option value="dayChange">24h Change</option>
            </select>
          </div>
        </div>

        {/* Row 2: Actions + presets */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
          {!started ? (
            <button className="btn btn-primary" onClick={() => fetchPage(0)} disabled={loading}>
              Load Markets
            </button>
          ) : (
            <button className="btn" onClick={reload} disabled={loading || loadingAll}>
              Refresh
            </button>
          )}
          <span style={{ color: "var(--muted)", fontSize: 12, margin: "0 4px" }}>Presets:</span>
          <button className="btn" onClick={() => { setMinProb("97"); setMaxProb("99"); }}>97–99% decided</button>
          <button className="btn" onClick={() => { setEndingWithin("1week"); setMinVolume("10000"); }}>Ending this week &gt;$10K</button>
          <button className="btn" onClick={() => { setDayChangeDir("rising"); setMinVolume("1000"); }}>Hot (rising 24h)</button>
          {anyFilter && (
            <button className="btn" onClick={clearFilters} style={{ marginLeft: 4 }}>✕ Clear filters</button>
          )}
        </div>
      </div>

      {/* Stats */}
      {started && (
        <div className="stats-bar">
          {(loading || loadingAll) && <span><span className="loading-dot" />Loading…</span>}
          <span>Loaded <strong>{allMarkets.length.toLocaleString()}</strong> markets</span>
          {anyFilter && (
            <span>Showing <strong>{filtered.length.toLocaleString()}</strong> matching</span>
          )}
          {error && <span style={{ color: "var(--red)" }}>Error: {error}</span>}
        </div>
      )}

      {/* Table */}
      {started && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className={sortKey === "probability" ? "active" : ""} onClick={() => toggleSort("probability")}>
                  Prob {sortKey === "probability" && <SortIcon dir={sortDir} />}
                </th>
                <th>Market</th>
                <th>Outcome</th>
                <th className={sortKey === "volume" ? "active" : ""} onClick={() => toggleSort("volume")}>
                  Volume {sortKey === "volume" && <SortIcon dir={sortDir} />}
                </th>
                <th className={sortKey === "vol24h" ? "active" : ""} onClick={() => toggleSort("vol24h")}>
                  24h Vol {sortKey === "vol24h" && <SortIcon dir={sortDir} />}
                </th>
                <th className={sortKey === "liquidity" ? "active" : ""} onClick={() => toggleSort("liquidity")}>
                  Liquidity {sortKey === "liquidity" && <SortIcon dir={sortDir} />}
                </th>
                <th className={sortKey === "dayChange" ? "active" : ""} onClick={() => toggleSort("dayChange")}>
                  24h Δ {sortKey === "dayChange" && <SortIcon dir={sortDir} />}
                </th>
                <th className={sortKey === "endDate" ? "active" : ""} onClick={() => toggleSort("endDate")}>
                  Ends {sortKey === "endDate" && <SortIcon dir={sortDir} />}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      <strong>No markets found</strong>
                      <p>
                        {allMarkets.length === 0
                          ? 'Click "Load Markets" to fetch data.'
                          : "Try adjusting your filters."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const pct = m.probability !== null ? (m.probability * 100).toFixed(1) : "—";
                  const soon = isEndingSoon(m.endDate);
                  const url = m.slug ? `https://polymarket.com/event/${m.slug}` : null;
                  const change = fmtChange(m.dayChange);
                  return (
                    <tr key={m.id}>
                      <td className="prob-cell">
                        <span className={`prob-value ${m.probability !== null ? probColor(m.probability) : "prob-low"}`}>
                          {pct}{m.probability !== null ? "%" : ""}
                        </span>
                        {m.probability !== null && (
                          <div className="prob-bar-bg">
                            <div className="prob-bar-fill"
                              style={{ width: `${Math.round(m.probability * 100)}%`, background: barColor(m.probability) }}
                            />
                          </div>
                        )}
                      </td>
                      <td className="question-cell">
                        <span className="question-text">
                          {url
                            ? <a href={url} target="_blank" rel="noopener noreferrer">{m.question}</a>
                            : m.question}
                        </span>
                      </td>
                      <td><span className="outcome-badge">{m.outcome}</span></td>
                      <td><span className="vol">{fmtVolume(m.volume)}</span></td>
                      <td><span className="vol">{fmtVolume(m.volume24hr)}</span></td>
                      <td><span style={{ color: "var(--accent)", fontSize: 13 }}>{fmtVolume(m.liquidity)}</span></td>
                      <td>
                        {change ? (
                          <span style={{ color: m.dayChange > 0 ? "var(--green)" : "var(--red)", fontSize: 12, fontWeight: 600 }}>
                            {change}
                          </span>
                        ) : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                      <td className={`date-cell ${soon ? "date-soon" : ""}`}>{m.endDate ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Load more footer */}
          {(hasMore || loadingAll) && (
            <div className="load-more-row">
              <button className="btn btn-primary" onClick={() => fetchPage(nextPage)} disabled={loading || loadingAll}>
                {loading ? "Loading…" : "Load 500 More"}
              </button>
              <button className="btn" onClick={loadAll} disabled={loading || loadingAll}>
                {loadingAll ? `Loading… (${allMarkets.length.toLocaleString()})` : "Load All Markets"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Initial empty state */}
      {!started && (
        <div className="table-wrap">
          <div className="empty">
            <strong>Ready to explore</strong>
            <p>Click <strong>Load Markets</strong> to fetch active markets from Polymarket.</p>
            <p style={{ marginTop: 8 }}>Use the <strong>97–99%</strong> preset to find nearly-decided markets.</p>
          </div>
        </div>
      )}
    </div>
  );
}

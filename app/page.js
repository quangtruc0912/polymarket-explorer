"use client";

import { useState, useCallback, useMemo, useEffect } from "react";

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

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "14px 16px",
    }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? "var(--fg)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Horizontal Mini Bar ─────────────────────────────────────────────────────

function MiniBar({ label, count, max, color }) {
  const pct = Math.round((count / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 36, fontSize: 11, color: "var(--muted)", textAlign: "right", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, background: "var(--border)", borderRadius: 2, height: 13, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <div style={{ width: 40, fontSize: 11, color: "var(--fg)", fontWeight: 600, textAlign: "right" }}>{count.toLocaleString()}</div>
    </div>
  );
}

// ─── Elon Tweets Tab ─────────────────────────────────────────────────────────

function ElonTweetsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [rowStates, setRowStates] = useState({});

  async function loadAnalysis() {
    setAnalysisLoading(true);
    try {
      const res = await fetch("/api/elon-analysis");
      const json = await res.json();
      if (!json.error) setAnalysis(json);
    } catch {}
    finally { setAnalysisLoading(false); }
  }

  async function askWhyWeek(weekKey) {
    setRowStates(prev => ({ ...prev, [weekKey]: { loading: true, reason: null } }));
    try {
      const res  = await fetch(`/api/elon-analysis?week=${weekKey}`);
      const json = await res.json();
      const reason = json.reason ?? null;
      setRowStates(prev => ({ ...prev, [weekKey]: { loading: false, reason } }));
      if (reason) {
        setAnalysis(prev => prev
          ? { ...prev, analyses: { ...prev.analyses, [weekKey]: reason } }
          : { analyses: { [weekKey]: reason } }
        );
      }
    } catch {
      setRowStates(prev => ({ ...prev, [weekKey]: { loading: false, reason: null } }));
    }
  }

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(force ? "/api/elon-stats?force=1" : "/api/elon-stats");
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); loadAnalysis(); }, []);

  if (loading) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)" }}>
        <span className="loading-dot" /> Loading tweet stats…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center" }}>
        <div style={{ color: "var(--red)", marginBottom: 12 }}>Error: {error}</div>
        <button className="btn" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const { summary, weekly, contentTypes, dayOfWeek, profile, dataFile } = data;
  const maxWeek = Math.max(...weekly.map((w) => w.count));
  const maxDow  = Math.max(...dayOfWeek.map((d) => d.count));

  const avgPerWeek     = summary.avgPerWeek;
  const highThreshold  = Math.round(avgPerWeek * 1.5);
  const lowThreshold   = Math.round(avgPerWeek * 0.5);

  function weekColor(count) {
    const r = count / maxWeek;
    if (r >= 0.8) return "#3fb950";
    if (r >= 0.5) return "#d29922";
    return "#58a6ff";
  }

  return (
    <div>
      {/* Profile header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
        {profile.avatarUrl && (
          <img src={profile.avatarUrl} alt={profile.name} style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0 }} />
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{profile.name}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>@{profile.handle}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.totalPosts.toLocaleString()}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>posts tracked</div>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", borderLeft: "1px solid var(--border)", paddingLeft: 14 }}>
          <div>Source: {dataFile}</div>
          <div>Fetched: {data.fetchedAt?.slice(0, 10)}</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <button className="btn" onClick={() => load(false)} style={{ fontSize: 11, padding: "2px 10px" }}>Refresh</button>
            <button className="btn" onClick={() => load(true)} style={{ fontSize: 11, padding: "2px 10px" }} title="Re-fetch last 4 weeks from xtracker">Force Sync</button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Tweets" value={summary.totalPosts.toLocaleString()} />
        <StatCard label="Weeks Tracked" value={summary.totalWeeks} />
        <StatCard label="Avg / Week" value={summary.avgPerWeek.toLocaleString()} />
        <StatCard
          label="Peak Week"
          value={summary.peakWeek.count.toLocaleString()}
          sub={`${summary.peakWeek.startDate} – ${summary.peakWeek.endDate}`}
          accent="#3fb950"
        />
        <StatCard
          label="Tracking Period"
          value={summary.firstDate}
          sub={`→ ${summary.lastDate}`}
        />
      </div>

      {/* Content type + Day of week side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
        <div className="table-wrap" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Content Type</div>
          <MiniBar label="RT" count={contentTypes.retweets} max={summary.totalPosts} color="#58a6ff" />
          <MiniBar label="Original" count={contentTypes.original} max={summary.totalPosts} color="#3fb950" />
          <MiniBar label="Reply" count={contentTypes.replies} max={summary.totalPosts} color="#d29922" />
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
            {((contentTypes.retweets / summary.totalPosts) * 100).toFixed(0)}% retweets
            &nbsp;·&nbsp;
            {((contentTypes.original / summary.totalPosts) * 100).toFixed(0)}% original
          </div>
        </div>

        <div className="table-wrap" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Most Active Day (UTC)</div>
          {dayOfWeek.map((d) => (
            <MiniBar key={d.day} label={d.day} count={d.count} max={maxDow} color="#58a6ff" />
          ))}
        </div>
      </div>

      {/* Weekly bar chart */}
      <div className="table-wrap" style={{ padding: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
          Tweets Per Week — {weekly[0]?.startDate} to {weekly[weekly.length - 1]?.endDate}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 108 }}>
          {weekly.map((w) => {
            const h = Math.max(3, Math.round((w.count / maxWeek) * 100));
            const color = weekColor(w.count);
            return (
              <div
                key={w.startDate}
                title={`Week ${w.weekNum}: ${w.startDate}\n${w.count} tweets${w.change !== null ? `\n${w.change >= 0 ? "+" : ""}${w.change} vs prev` : ""}`}
                style={{
                  flex: 1,
                  height: h,
                  background: color,
                  borderRadius: "2px 2px 0 0",
                  opacity: 0.8,
                  cursor: "default",
                  minWidth: 6,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 4 }}>
          <span>{weekly[0]?.startDate?.slice(0, 7)}</span>
          <span>{weekly[Math.floor(weekly.length / 2)]?.startDate?.slice(0, 7)}</span>
          <span>{weekly[weekly.length - 1]?.startDate?.slice(0, 7)}</span>
        </div>
      </div>

      {/* Weekly table — newest first */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              <th>Week (Mon – Sun)</th>
              <th style={{ textAlign: "right" }}>Tweets</th>
              <th style={{ textAlign: "right" }}>vs Prev</th>
              <th style={{ minWidth: 100 }}>Volume</th>
              <th style={{ minWidth: 260 }}>
                Why
                {analysisLoading && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>
                    <span className="loading-dot" /> analyzing…
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...weekly].reverse().map((w) => {
              const color   = weekColor(w.count);
              const pct     = Math.round((w.count / maxWeek) * 100);
              const isHigh   = w.count >= highThreshold;
              const isLow    = w.count <= lowThreshold;
              const notable  = isHigh || isLow;
              const reason   = analysis?.analyses?.[w.startDate] ?? rowStates[w.startDate]?.reason;
              const rowLoading = rowStates[w.startDate]?.loading;
              return (
                <tr key={w.startDate}>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{w.weekNum}</td>
                  <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                    {w.startDate} – {w.endDate}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color, fontSize: 15 }}>{w.count}</td>
                  <td style={{ textAlign: "right", fontSize: 12 }}>
                    {w.change !== null ? (
                      <span style={{ color: w.change > 0 ? "var(--green)" : w.change < 0 ? "var(--red)" : "var(--muted)" }}>
                        {w.change > 0 ? `+${w.change}` : w.change}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    <div style={{ background: "var(--border)", borderRadius: 2, height: 6 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
                    </div>
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 400 }}>
                    {reason ? (
                      <span style={{ color: "var(--fg)" }}>
                        {notable && (
                          <span style={{
                            display: "inline-block",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 3,
                            marginRight: 6,
                            background: isHigh ? "rgba(63,185,80,0.15)" : "rgba(88,166,255,0.15)",
                            color: isHigh ? "#3fb950" : "#58a6ff",
                          }}>
                            {isHigh ? "HIGH" : "LOW"}
                          </span>
                        )}
                        {reason}
                      </span>
                    ) : rowLoading ? (
                      <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 12 }}>
                        <span className="loading-dot" /> asking Claude…
                      </span>
                    ) : analysisLoading ? (
                      <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 12 }}>
                        {notable && (
                          <span style={{
                            display: "inline-block",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 3,
                            marginRight: 6,
                            background: isHigh ? "rgba(63,185,80,0.15)" : "rgba(88,166,255,0.15)",
                            color: isHigh ? "#3fb950" : "#58a6ff",
                          }}>
                            {isHigh ? "HIGH" : "LOW"}
                          </span>
                        )}
                        analyzing…
                      </span>
                    ) : (
                      <button
                        className="btn"
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        onClick={() => askWhyWeek(w.startDate)}
                      >
                        Ask why
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  const [activeTab, setActiveTab] = useState("markets");
  const [elonMounted, setElonMounted] = useState(false);

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
  const [dayChangeDir, setDayChangeDir] = useState("any");

  // Sort
  const [sortKey, setSortKey] = useState("probability");
  const [sortDir, setSortDir] = useState("desc");

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

  function reload() {
    setAllMarkets([]);
    setNextPage(0);
    setHasMore(false);
    fetchPage(0);
  }

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

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab-btn${activeTab === "markets" ? " active" : ""}`}
          onClick={() => setActiveTab("markets")}
        >
          Markets
        </button>
        <button
          className={`tab-btn${activeTab === "elon-tweets" ? " active" : ""}`}
          onClick={() => { setActiveTab("elon-tweets"); setElonMounted(true); }}
        >
          Elon Tweets
        </button>
      </div>

      {/* ── Markets Tab ── */}
      {activeTab === "markets" && (
        <>
          <div className="filters">
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
                          <td>
                            <span className={`outcome-badge${m.outcome?.toLowerCase() === "yes" ? " outcome-yes" : m.outcome?.toLowerCase() === "no" ? " outcome-no" : ""}`}>
                              {m.outcome}
                            </span>
                          </td>
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

          {!started && (
            <div className="table-wrap">
              <div className="empty">
                <strong>Ready to explore</strong>
                <p>Click <strong>Load Markets</strong> to fetch active markets from Polymarket.</p>
                <p style={{ marginTop: 8 }}>Use the <strong>97–99%</strong> preset to find nearly-decided markets.</p>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Elon Tweets Tab ── */}
      {elonMounted && (
        <div style={{ display: activeTab === "elon-tweets" ? "block" : "none" }}>
          <ElonTweetsTab />
        </div>
      )}
    </div>
  );
}

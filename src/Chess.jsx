import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Brush,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchJson, fetchRapidHistory, fetchGamesBetween } from "./api/chessApi";
import { PLAYERS, TIMEFRAMES } from "./constants/chessConfig";
import {
  buildChartDataForView,
  calculateYAxisDomain,
  mergeSeries,
  sliceSeriesByTimeframe,
} from "./utils/series";
import { formatShortDate, formatTooltipDate } from "./utils/formatting";

const INTERACTION_ANIM_DURATION = 1400;
const INTERACTION_ANIM_RESET_DELAY = 1500;
const DATA_REFRESH_ANIM_DURATION = 2800;
const DATA_REFRESH_ANIM_RESET_DELAY = 3000;

// HELPER: Convert epoch seconds to YYYY-MM-DD (Added here to fix the Unknown Date bug)
function toIsoDate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function nextMidnightDelay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 10, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

function AnimatedNumber({ value, duration = 1200 }) {
  const [displayValue, setDisplayValue] = useState(0);
  const prevValueRef = useRef(0);

  useEffect(() => {
    let animationFrame;
    let startValue = prevValueRef.current;
    const endValue = value;

    if (startValue == null || Number.isNaN(startValue)) {
      startValue = 0;
    }

    if (startValue === endValue) {
      prevValueRef.current = value;
      setDisplayValue(endValue);
      return;
    }

    if (Math.abs(endValue - startValue) < 2) {
      setDisplayValue(endValue);
      prevValueRef.current = value;
      return;
    }

    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

      const current = startValue + (endValue - startValue) * ease;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    prevValueRef.current = value;
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [value, duration]);

  return Math.round(displayValue).toLocaleString();
}

function CustomTooltip({ active, label, payload }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;

  const payloadByKey = new Map();
  payload.forEach((item) => {
    const key = item?.dataKey;
    if (!key || item?.value == null) return;
    if (!payloadByKey.has(key)) payloadByKey.set(key, item.value);
  });

  const rows = PLAYERS.filter((player) => payloadByKey.has(player.username)).map((player) => ({
    key: player.username,
    label: player.label,
    color: player.color,
    value: payloadByKey.get(player.username),
  }));

  if (rows.length === 0) return null;

  return (
    <div style={{ background: "#111827", border: "1px solid #293142", padding: "10px 12px" }}>
      <div style={{ color: "#d1d5db", marginBottom: 6 }}>{formatTooltipDate(label)}</div>
      {rows.map((entry) => (
        <div key={entry.key} style={{ color: entry.color, fontWeight: 700, marginBottom: 4 }}>
          {entry.label}: {entry.value}
        </div>
      ))}
    </div>
  );
}

function WinLossDrawDonut({ wins = 0, losses = 0, draws = 0 }) {
  const total = wins + losses + draws;
  const safeTotal = total > 0 ? total : 1;
  const winPct = wins / safeTotal;
  const lossPct = losses / safeTotal;
  const drawPct = draws / safeTotal;

  const radius = 15;
  const strokeWidth = 6;
  const size = 44;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  const winLength = circumference * winPct;
  const lossLength = circumference * lossPct;
  const drawLength = circumference * drawPct;

  return (
    <div className="wld-wrap" title={`W:${wins} L:${losses} D:${draws}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="wld-donut" aria-hidden="true">
        <circle cx={cx} cy={cy} r={radius} className="wld-ring-bg" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          className="wld-segment wld-win"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${winLength} ${circumference - winLength}`}
          strokeDashoffset={0}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          className="wld-segment wld-loss"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${lossLength} ${circumference - lossLength}`}
          strokeDashoffset={-winLength}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          className="wld-segment wld-draw"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${drawLength} ${circumference - drawLength}`}
          strokeDashoffset={-(winLength + lossLength)}
        />
      </svg>
      <div className="wld-counts">
        <span className="wld-text w">W {wins}</span>
        <span className="wld-text l">L {losses}</span>
        <span className="wld-text d">D {draws}</span>
      </div>
    </div>
  );
}

function StatCard({ player, value, best, gain, color, profile }) {
  const username = player.username;
  const label = player.label;
  const avatar = profile?.avatar;
  const online = Boolean(profile?.online);
  const record = profile?.record || {};

  return (
    <div className="stat-card" style={{ borderColor: `${color}66` }}>
      <div className="stat-head-row">
        <div className="stat-player-meta">
          {avatar ? (
            <img className="player-avatar" src={avatar} alt={`${label} avatar`} loading="lazy" />
          ) : (
            <div className="player-avatar-fallback" aria-hidden="true">
              {label.slice(0, 1)}
            </div>
          )}
          <p className="stat-title">{`${label} (@${username})`}</p>
        </div>
        <div className="status-wrap" title={online ? "Online" : "Offline"}>
          <span className={`status-dot ${online ? "online" : "offline"}`} aria-hidden="true" />
          <span className="status-label">{online ? "Online" : "Offline"}</span>
        </div>
      </div>

      <div className="stat-main-row">
        <div>
          <p className="stat-value" style={{ color }}>
            {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
          </p>
          
          <div className="stat-badges">
            {best && (
              <div className="stat-badge peak">
                <span className="badge-icon">👑</span> 
                <span>Peak {best}</span>
              </div>
            )}
            {typeof gain === 'number' && (
              <div className={`stat-badge gain ${gain >= 0 ? 'pos' : 'neg'}`}>
                <span className="badge-icon">{gain >= 0 ? '▲' : '▼'}</span>
                <span>{Math.abs(gain)}</span>
              </div>
            )}
            {!best && typeof gain !== 'number' && (
              <span className="stat-subtitle">No data yet</span>
            )}
          </div>

        </div>
        <WinLossDrawDonut
          wins={record.win || 0}
          losses={record.loss || 0}
          draws={record.draw || 0}
        />
      </div>
    </div>
  );
}

function SkeletonCard({ color }) {
  return (
    <div className="stat-card skeleton-card" style={{ borderColor: `${color}55` }}>
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-value" />
      <div className="skeleton-line skeleton-subtitle" />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="chart-skeleton" aria-hidden="true">
      <div className="chart-skeleton-grid" />
      <div className="chart-skeleton-grid" />
      <div className="chart-skeleton-grid" />
      <div className="chart-skeleton-shimmer" />
    </div>
  );
}

export default function Chess() {
  const [seriesByUser, setSeriesByUser] = useState({});
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());
  const [timeframe, setTimeframe] = useState("all");
  const [chartAnimDuration, setChartAnimDuration] = useState(0);
  const [chartAnimationCycle, setChartAnimationCycle] = useState(0);
  const chartContainerRef = useRef(null);
  const chartAnimTimeoutRef = useRef(null);
  const hasInteractionAnimationMountedRef = useRef(false);
  
  // Rivalry State
  const [h2hGames, setH2hGames] = useState([]);
  const [h2hLoading, setH2hLoading] = useState(false);

  // Load Rivalry Data & Calculate Running Score
  useEffect(() => {
    async function loadRivalry() {
      setH2hLoading(true);
      try {
        const games = await fetchGamesBetween("jstmtt", "addiprice03");
        
        // CALCULATE RUNNING SCORE
        // 1. Sort Oldest to Newest to count up
        const sortedOldToNew = [...games].sort((a, b) => a.end_time - b.end_time);
        
        let mWins = 0;
        let aWins = 0;
        let draws = 0;

        // 2. Map through and attach snapshot score
        const gamesWithScore = sortedOldToNew.map(game => {
            const matt = "jstmtt";
            const isMattWhite = game.white.username.toLowerCase() === matt;
            const mattResult = isMattWhite ? game.white.result : game.black.result;
            
            if (mattResult === "win") mWins++;
            else if (["agreed", "repetition", "stalemate", "insufficient", "timevsinsufficient", "50move"].includes(mattResult)) draws++;
            else aWins++;

            return {
                ...game,
                scoreSnapshot: { m: mWins, a: aWins, d: draws }
            };
        });

        // 3. Reverse back to Newest First for display
        setH2hGames(gamesWithScore.reverse());

      } catch (err) {
        console.error("Failed to load rivalry", err);
      } finally {
        setH2hLoading(false);
      }
    }
    loadRivalry();
  }, []);

  const startChartAnimation = useCallback((duration, resetDelay) => {
    setChartAnimDuration(duration);

    if (chartAnimTimeoutRef.current) {
      clearTimeout(chartAnimTimeoutRef.current);
    }

    chartAnimTimeoutRef.current = setTimeout(() => {
      setChartAnimDuration(0);
    }, resetDelay);
  }, []);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const entries = await Promise.all(
        PLAYERS.map(async (player) => {
          const historyPromise = fetchRapidHistory(player.username);
          const statsPromise = fetchJson(`https://api.chess.com/pub/player/${player.username}/stats`);
          const profilePromise = fetchJson(`https://api.chess.com/pub/player/${player.username}`);
          const onlinePromise = fetchJson(`https://api.chess.com/pub/player/${player.username}/is-online`)
            .catch(() => ({ online: false }));

          const [history, stats, profileData, onlineStatus] = await Promise.all([
            historyPromise,
            statsPromise,
            profilePromise,
            onlinePromise,
          ]);

          const historyBest = history.reduce(
            (best, point) => Math.max(best, point.rating),
            Number.NEGATIVE_INFINITY
          );
          const statsBest = stats.chess_rapid?.best?.rating;
          const bestRating = [statsBest, historyBest]
            .filter((rating) => Number.isFinite(rating))
            .reduce((best, rating) => Math.max(best, rating), Number.NEGATIVE_INFINITY);

          return [
            player.username,
            {
              history,
              profile: {
                current: stats.chess_rapid?.last?.rating ?? null,
                best: Number.isFinite(bestRating) ? bestRating : null,
                avatar: profileData?.avatar || null,
                online: Boolean(onlineStatus?.online),
                record: {
                  win: stats.chess_rapid?.record?.win ?? 0,
                  loss: stats.chess_rapid?.record?.loss ?? 0,
                  draw: stats.chess_rapid?.record?.draw ?? 0,
                },
              },
            },
          ];
        })
      );

      const nextSeries = {};
      const nextProfiles = {};
      entries.forEach(([username, payload]) => {
        nextSeries[username] = payload.history;
        nextProfiles[username] = payload.profile;
      });

      startChartAnimation(DATA_REFRESH_ANIM_DURATION, DATA_REFRESH_ANIM_RESET_DELAY);
      setChartAnimationCycle((prev) => prev + 1);
      setSeriesByUser(nextSeries);
      setProfiles(nextProfiles);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("Fetch error:", e);
      setError(e.message || "Failed to fetch Chess.com data.");
    } finally {
      setLoading(false);
    }
  }, [startChartAnimation]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      await loadAllData();
    }, nextMidnightDelay());

    return () => clearTimeout(timeoutId);
  }, [loadAllData, lastUpdated]);

  useEffect(() => {
    if (!hasInteractionAnimationMountedRef.current) {
      hasInteractionAnimationMountedRef.current = true;
      return;
    }

    startChartAnimation(INTERACTION_ANIM_DURATION, INTERACTION_ANIM_RESET_DELAY);
  }, [timeframe, hiddenPlayers, startChartAnimation]);

  useEffect(() => {
    const handleBrushInteraction = () => {
      startChartAnimation(INTERACTION_ANIM_DURATION, INTERACTION_ANIM_RESET_DELAY);
    };

    const container = chartContainerRef.current;
    if (!container) return;

    container.addEventListener("mousedown", handleBrushInteraction);
    container.addEventListener("touchstart", handleBrushInteraction);

    return () => {
      container.removeEventListener("mousedown", handleBrushInteraction);
      container.removeEventListener("touchstart", handleBrushInteraction);
      if (chartAnimTimeoutRef.current) {
        clearTimeout(chartAnimTimeoutRef.current);
      }
    };
  }, [startChartAnimation]);

  const chartData = useMemo(() => mergeSeries(PLAYERS, seriesByUser), [seriesByUser]);
  const showSkeleton = loading && chartData.length === 0;

  const timeframeData = useMemo(
    () => sliceSeriesByTimeframe(chartData, timeframe, TIMEFRAMES),
    [chartData, timeframe]
  );

  const activePlayers = useMemo(
    () => PLAYERS.filter((player) => !hiddenPlayers.has(player.username)),
    [hiddenPlayers]
  );

  const themePlayer = activePlayers[0] || PLAYERS[0];
  const themeAccent = themePlayer.color;

  const chartDataForView = useMemo(
    () => buildChartDataForView(timeframeData, PLAYERS, hiddenPlayers),
    [timeframeData, hiddenPlayers]
  );

  const yAxisDomain = useMemo(
    () => calculateYAxisDomain(chartDataForView, activePlayers),
    [chartDataForView, activePlayers]
  );

  const lastPointIndexByPlayer = useMemo(() => {
    const indexes = {};
    activePlayers.forEach((player) => {
      let lastIndex = -1;
      for (let i = chartDataForView.length - 1; i >= 0; i -= 1) {
        if (typeof chartDataForView[i][player.username] === "number") {
          lastIndex = i;
          break;
        }
      }
      indexes[player.username] = lastIndex;
    });
    return indexes;
  }, [chartDataForView, activePlayers]);

  const togglePlayer = useCallback((username) => {
    setHiddenPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
        return next;
      }

      if (PLAYERS.length - next.size <= 1) {
        return prev;
      }

      next.add(username);
      return next;
    });
  }, []);

  const latestByPlayer = useMemo(() => {
    const summary = {};
    for (const player of PLAYERS) {
      const history = seriesByUser[player.username] || [];
      summary[player.username] = history.length ? history[history.length - 1] : null;
    }
    return summary;
  }, [seriesByUser]);

  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div>
            <h1 style={{ color: themeAccent }}>Chess Rapid Rating Tracker</h1>
          </div>
          <button 
            className="refresh-button icon-only" 
            onClick={loadAllData} 
            disabled={loading}
            title="Refresh Data"
            aria-label="Refresh Data"
          >
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={loading ? "spin" : ""}>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
             </svg>
          </button>
        </header>

        {error ? <div className="error">{error}</div> : null}

        <section className="stats-grid">
          {showSkeleton
            ? PLAYERS.map((player) => <SkeletonCard key={player.username} color={player.color} />)
            : PLAYERS.map((player) => {
                const latest = latestByPlayer[player.username];
                const profile = profiles[player.username] || {};
                const first = (seriesByUser[player.username] || [])[0];
                const gain = latest && first ? latest.rating - first.rating : null;
                return (
                  <StatCard
                    key={player.username}
                    player={player}
                    value={profile.current ?? (latest ? latest.rating : "-")}
                    profile={profile}
                    best={profile.best}
                    gain={gain}
                    color={player.color}
                  />
                );
              })}
        </section>

        <section className="chart-panel">
          <div className="timeframe-chips" role="group" aria-label="Select timeframe">
            {TIMEFRAMES.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`timeframe-chip ${timeframe === option.key ? "active" : ""}`}
                style={timeframe === option.key ? { borderColor: themeAccent, boxShadow: `0 0 0 1px ${themeAccent}66 inset` } : undefined}
                onClick={() => setTimeframe(option.key)}
                disabled={showSkeleton}
                aria-pressed={timeframe === option.key}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="player-chips" role="group" aria-label="Toggle players">
            {PLAYERS.map((player) => {
              const hidden = hiddenPlayers.has(player.username);
              return (
                <button
                  key={player.username}
                  type="button"
                  className={`player-chip ${hidden ? "hidden" : ""}`}
                  onClick={() => togglePlayer(player.username)}
                  aria-pressed={!hidden}
                  disabled={showSkeleton}
                >
                  <span className="player-chip-dot" style={{ background: player.color }} />
                  {player.label}
                </button>
              );
            })}
          </div>

          {showSkeleton ? (
            <ChartSkeleton />
          ) : (
            <div ref={chartContainerRef}>
              <ResponsiveContainer width="100%" height={560}>
              <ComposedChart data={chartDataForView} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <defs>
                  {activePlayers.map((player) => (
                    <linearGradient key={player.username} id={`fill-${player.username}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={player.color} stopOpacity={player.areaOpacity} />
                      <stop offset="100%" stopColor={player.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="#293142" vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={40}
                  tickFormatter={formatShortDate}
                  stroke="#93A4BA"
                />
                <YAxis stroke="#93A4BA" domain={yAxisDomain} />
                <Tooltip content={<CustomTooltip />} />
                
                <Brush
                  dataKey="date"
                  height={40}
                  stroke={themeAccent}
                  fill="rgba(15, 23, 42, 0.6)"
                  tickFormatter={formatShortDate}
                  travellerWidth={8}
                >
                  <ComposedChart>
                    {activePlayers.map((player) => (
                      <Line
                        key={player.username}
                        type="monotone"
                        dataKey={player.username}
                        stroke={player.color}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </Brush>

                {activePlayers.map((player) => (
                  <Area
                    key={`${player.username}-area-${chartAnimationCycle}`}
                    type="monotone"
                    dataKey={player.username}
                    stroke="none"
                    fill={`url(#fill-${player.username})`}
                    connectNulls
                    isAnimationActive={chartAnimDuration > 0}
                    animationDuration={chartAnimDuration}
                    legendType="none"
                  />
                ))}

                {activePlayers.map((player) => (
                  <Line
                    key={`${player.username}-${chartAnimationCycle}`}
                    type="monotone"
                    dataKey={player.username}
                    name={player.label}
                    stroke={player.color}
                    strokeWidth={2.3}
                    dot={(props) => {
                      const isLast = props.index === lastPointIndexByPlayer[player.username];
                      if (!isLast) {
                        return <circle cx={props.cx} cy={props.cy} r={0} />;
                      }

                      return (
                        <g>
                          <circle className="pulse-dot" cx={props.cx} cy={props.cy} r={10} fill={player.color} opacity={0.25} />
                          <circle cx={props.cx} cy={props.cy} r={4} fill={player.color} stroke="#ffffff" strokeWidth={1.3} />
                        </g>
                      );
                    }}
                    connectNulls
                    isAnimationActive={chartAnimDuration > 0}
                    animationDuration={chartAnimDuration}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* RIVALRY SECTION */}
        <section className="rivalry-panel animate-in" style={{ animationDelay: "0.5s", marginTop: 24 }}>
          <div className="rivalry-header">
            <h3>⚔️ Rivalry: Matt vs Addi</h3>
            <div className="rivalry-score">
               <span style={{ color: "#43B0F1" }}>
                 {h2hGames.filter(g => 
                   g.white && g.black && (
                     (g.white.username.toLowerCase() === "jstmtt" && g.white.result === "win") || 
                     (g.black.username.toLowerCase() === "jstmtt" && g.black.result === "win")
                   )
                 ).length} Wins
               </span>
               <span className="score-divider">-</span>
               <span style={{ color: "#9ca3af" }}>
                 {h2hGames.filter(g => {
                    if (!g.white) return false;
                    const res = g.white.result;
                    return ["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"].includes(res);
                 }).length} Draws
               </span>
               <span className="score-divider">-</span>
               <span style={{ color: "#39d98a" }}>
                 {h2hGames.filter(g => 
                   g.white && g.black && (
                     (g.white.username.toLowerCase() === "addiprice03" && g.white.result === "win") || 
                     (g.black.username.toLowerCase() === "addiprice03" && g.black.result === "win")
                   )
                 ).length} Wins
               </span>
            </div>
          </div>

          <div className="rivalry-list">
            {h2hLoading ? (
              <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Finding games...</div>
            ) : h2hGames.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>No rapid rated games found yet!</div>
            ) : (
              h2hGames.map((game, i) => {
                if (!game || !game.white || !game.black || !game.end_time) return null;

                const matt = "jstmtt";
                const isMattWhite = game.white.username.toLowerCase() === matt;
                const mattResult = isMattWhite ? game.white.result : game.black.result;
                
                let winner = "addi";
                if (mattResult === "win") winner = "matt";
                else if (["agreed", "repetition", "stalemate", "insufficient", "timevsinsufficient", "50move"].includes(mattResult)) winner = "draw";

                // Safe Date Formatting
                let dateDisplay = "Unknown";
                try {
                   dateDisplay = formatShortDate(toIsoDate(game.end_time));
                } catch (e) { /* Ignore */ }

                // Get running score from snapshot
                const score = game.scoreSnapshot || {m:0, d:0, a:0};

                return (
                  <a key={game.url || i} href={game.url} target="_blank" rel="noreferrer" className={`rivalry-card winner-${winner}`}>
                    <div className="rivalry-date">{dateDisplay}</div>
                    
                    <div className="rivalry-result">
                      {winner === "matt" && <span style={{color: "#90cdf4"}}>MATT WON</span>}
                      {winner === "addi" && <span style={{color: "#68d391"}}>ADDI WON</span>}
                      {winner === "draw" && <span style={{color: "#cbd5e0"}}>DRAW</span>}
                    </div>

                    <div className="rivalry-running-score">
                        {score.m} - {score.d} - {score.a}
                    </div>
                  </a>
                );
              })
            )}
          </div>
        </section>

      </div>
    </main>
  );
}

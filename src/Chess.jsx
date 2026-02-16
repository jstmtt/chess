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

const PLAYERS = [
  { username: "jstmtt", label: "Matt", color: "#43B0F1", areaOpacity: 0.22 },
  { username: "addiprice03", label: "Addi", color: "#39d98a", areaOpacity: 0.2 },
  { username: "jessicasimian", label: "Jessica", color: "#ff3d7f", areaOpacity: 0.24 },
];

const TIMEFRAMES = [
  { key: "1m", label: "1M", months: 1 },
  { key: "3m", label: "3M", months: 3 },
  { key: "6m", label: "6M", months: 6 },
  { key: "1y", label: "1Y", months: 12 },
  { key: "all", label: "All", months: null },
];

function toIsoDate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatTooltipDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const HISTORY_CACHE_PREFIX = "chess-rapid-history-v3";

function getUtcRefreshKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function getMonthUrlsFromJoined(username, joinedEpoch) {
  if (!Number.isFinite(joinedEpoch)) return [];

  const start = new Date(joinedEpoch * 1000);
  const current = new Date();
  const urls = [];

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;

  const endYear = current.getUTCFullYear();
  const endMonth = current.getUTCMonth() + 1;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const mm = String(month).padStart(2, "0");
    urls.push(`https://api.chess.com/pub/player/${username}/games/${year}/${mm}`);

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return urls;
}

async function fetchMonthlyArchives(monthUrls, chunkSize = 8) {
  const chunks = [];
  for (let i = 0; i < monthUrls.length; i += chunkSize) {
    chunks.push(monthUrls.slice(i, i + chunkSize));
  }

  const allGames = [];

  for (const chunk of chunks) {
    const settled = await Promise.allSettled(chunk.map((url) => fetchJson(url)));
    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      const games = Array.isArray(result.value?.games) ? result.value.games : [];
      allGames.push(...games);
    }
  }

  return allGames;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchRapidHistory(username) {
  const cacheKey = `${HISTORY_CACHE_PREFIX}:${username}`;
  const refreshKey = getUtcRefreshKey();

  try {
    const cachedRaw = window.localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached?.refreshKey === refreshKey && Array.isArray(cached?.history)) {
        return cached.history;
      }
    }
  } catch {
    // Ignore cache issues and fetch fresh data.
  }

  const profileData = await fetchJson(`https://api.chess.com/pub/player/${username}`);
  const monthUrls = getMonthUrlsFromJoined(username, profileData?.joined);

  const fallbackArchives =
    monthUrls.length > 0
      ? monthUrls
      : (await fetchJson(`https://api.chess.com/pub/player/${username}/games/archives`)).archives || [];

  const monthlyGames = await fetchMonthlyArchives(fallbackArchives);

  const historyMap = new Map();

  const rapidGames = monthlyGames
    .filter((game) => game.time_class === "rapid" && game.rated)
    .sort((a, b) => a.end_time - b.end_time);

  for (const game of rapidGames) {
    const isWhite = game.white?.username?.toLowerCase() === username;
    const isBlack = game.black?.username?.toLowerCase() === username;
    const color = isWhite ? "white" : isBlack ? "black" : null;
    if (!color) continue;

    const rating = game[color]?.rating;
    if (typeof rating !== "number") continue;

    const date = toIsoDate(game.end_time);
    const previous = historyMap.get(date);
    if (!previous || game.end_time > previous.epoch) {
      historyMap.set(date, { date, rating, epoch: game.end_time });
    }
  }

  const history = [...historyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({ refreshKey, history, savedAt: new Date().toISOString() })
    );
  } catch {
    // Ignore cache write issues.
  }

  return history;
}


function mergeSeries(seriesByUser) {
  const allDates = new Set();
  Object.values(seriesByUser).forEach((entries) => {
    entries.forEach((entry) => allDates.add(entry.date));
  });

  const sortedDates = [...allDates].sort();
  const pointerByUser = Object.fromEntries(PLAYERS.map((p) => [p.username, 0]));
  const lastSeen = {};

  return sortedDates.map((date) => {
    const row = { date };

    for (const player of PLAYERS) {
      const series = seriesByUser[player.username] || [];
      let pointer = pointerByUser[player.username];

      while (pointer < series.length && series[pointer].date <= date) {
        lastSeen[player.username] = series[pointer].rating;
        pointer += 1;
      }

      pointerByUser[player.username] = pointer;
      row[player.username] = lastSeen[player.username] ?? null;
    }

    return row;
  });
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


function StatCard({ title, value, subtitle, color }) {
  return (
    <div className="stat-card" style={{ borderColor: `${color}66` }}>
      <p className="stat-title">{title}</p>
      <p className="stat-value" style={{ color }}>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </p>
      <p className="stat-subtitle">{subtitle}</p>
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

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const entries = await Promise.all(
        PLAYERS.map(async (player) => {
          const [history, stats] = await Promise.all([
            fetchRapidHistory(player.username),
            fetchJson(`https://api.chess.com/pub/player/${player.username}/stats`),
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

      setSeriesByUser(nextSeries);
      setProfiles(nextProfiles);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || "Failed to fetch Chess.com data.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    setChartAnimDuration(1400);
    const timer = setTimeout(() => {
      setChartAnimDuration(0);
    }, 1500);
    return () => clearTimeout(timer);
  }, [timeframe, hiddenPlayers]);

  const chartData = useMemo(() => mergeSeries(seriesByUser), [seriesByUser]);
  const showSkeleton = loading && chartData.length === 0;

  const timeframeData = useMemo(() => {
    if (timeframe === "all" || chartData.length === 0) {
      return chartData;
    }

    const selected = TIMEFRAMES.find((option) => option.key === timeframe);
    if (!selected?.months) {
      return chartData;
    }

    const cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);
    cutoffDate.setMonth(cutoffDate.getMonth() - selected.months);
    const cutoffKey = cutoffDate.toISOString().slice(0, 10);

    const startIndex = chartData.findIndex((row) => row.date >= cutoffKey);
    if (startIndex === -1) {
      return chartData.slice(-1);
    }

    const sliced = chartData.slice(startIndex);
    if (startIndex > 0) {
      sliced.unshift({ ...chartData[startIndex - 1], date: cutoffKey });
    }

    return sliced;
  }, [chartData, timeframe]);

  const activePlayers = useMemo(
    () => PLAYERS.filter((player) => !hiddenPlayers.has(player.username)),
    [hiddenPlayers]
  );

  const themePlayer = activePlayers[0] || PLAYERS[0];
  const themeAccent = themePlayer.color;

  const chartDataForView = useMemo(() => {
    return timeframeData.map((row) => {
      const next = { ...row };
      for (const player of PLAYERS) {
        if (hiddenPlayers.has(player.username)) {
          next[player.username] = null;
        }
      }
      return next;
    });
  }, [timeframeData, hiddenPlayers]);

  const yAxisDomain = useMemo(() => {
    const values = [];
    chartDataForView.forEach((row) => {
      activePlayers.forEach((player) => {
        const value = row[player.username];
        if (typeof value === "number") {
          values.push(value);
        }
      });
    });

    if (!values.length) return [0, 2000];

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const lower = Math.max(0, Math.floor((minValue - 40) / 100) * 100);
    let upper = Math.ceil((maxValue + 40) / 100) * 100;
    if (upper <= lower) upper = lower + 100;

    return [lower, upper];
  }, [chartDataForView, activePlayers]);

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
          <button className="refresh-button" onClick={loadAllData} disabled={loading}>
            {loading ? "Syncing..." : "Refresh now"}
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
                    title={`${player.label} (@${player.username})`}
                    value={latest ? latest.rating : "—"}
                    subtitle={
                      latest
                        ? `Best ${profile.best ?? "—"} • Net ${gain >= 0 ? "+" : ""}${
                            gain ?? "—"
                          }`
                        : "No rapid games found"
                    }
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
                    key={`${player.username}-area`}
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
                    key={player.username}
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
          )}
        </section>

      </div>
    </main>
  );
}

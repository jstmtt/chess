import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchRapidHistory(username) {
  const archivesData = await fetchJson(
    `https://api.chess.com/pub/player/${username}/games/archives`
  );
  const archives = archivesData.archives || [];

  const historyMap = new Map();

  for (const archiveUrl of archives) {
    const gamesData = await fetchJson(archiveUrl);
    const rapidGames = (gamesData.games || [])
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
  }

  return [...historyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
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

  const deduped = [];
  const seen = new Set();

  payload.forEach((item) => {
    const key = item?.dataKey;
    if (!key || seen.has(key)) return;
    if (item?.value == null) return;
    seen.add(key);

    const player = PLAYERS.find((entry) => entry.username === key);
    deduped.push({
      key,
      color: item?.color || player?.color || "#e5e7eb",
      label: player?.label || item?.name || key,
      value: item.value,
    });
  });

  if (deduped.length === 0) return null;

  return (
    <div style={{ background: "#111827", border: "1px solid #293142", padding: "10px 12px" }}>
      <div style={{ color: "#d1d5db", marginBottom: 6 }}>{formatTooltipDate(label)}</div>
      {deduped.map((entry) => (
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

export default function PortfolioTracker() {
  const [seriesByUser, setSeriesByUser] = useState({});
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());

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

  const chartData = useMemo(() => mergeSeries(seriesByUser), [seriesByUser]);


  const activePlayers = useMemo(
    () => PLAYERS.filter((player) => !hiddenPlayers.has(player.username)),
    [hiddenPlayers]
  );

  const chartDataForView = useMemo(() => {
    return chartData.map((row) => {
      const next = { ...row };
      for (const player of PLAYERS) {
        if (hiddenPlayers.has(player.username)) {
          next[player.username] = null;
        }
      }
      return next;
    });
  }, [chartData, hiddenPlayers]);

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
            <h1>Chess Rapid Rating Tracker</h1>
          </div>
          <button className="refresh-button" onClick={loadAllData} disabled={loading}>
            {loading ? "Syncing..." : "Refresh now"}
          </button>
        </header>

        {error ? <div className="error">{error}</div> : null}

        <section className="stats-grid">
          {PLAYERS.map((player) => {
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
                >
                  <span className="player-chip-dot" style={{ background: player.color }} />
                  {player.label}
                </button>
              );
            })}
          </div>

          <ResponsiveContainer width="100%" height={430}>
            <ComposedChart data={chartDataForView} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
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
              <YAxis stroke="#93A4BA" domain={[0, "dataMax + 40"]} />
              <Tooltip content={<CustomTooltip />} />
              {activePlayers.map((player) => (
                <Area
                  key={`${player.username}-area`}
                  type="monotone"
                  dataKey={player.username}
                  stroke="none"
                  fill={`url(#fill-${player.username})`}
                  connectNulls
                  isAnimationActive
                  animationDuration={1400}
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
                  dot={false}
                  connectNulls
                  isAnimationActive
                  animationDuration={1300}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </section>

      </div>
    </main>
  );
}

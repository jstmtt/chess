import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const PLAYERS = [
  { username: "jstmtt", label: "You", color: "#5DADE2" },
  { username: "addiprice03", label: "Addi", color: "#58D68D" },
  { username: "jessicasimian", label: "Jessica", color: "#F5B041" },
];


function toIsoDate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
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
  const lastSeen = {};

  return sortedDates.map((date) => {
    const row = { date };
    for (const player of PLAYERS) {
      const todayEntry = seriesByUser[player.username]?.find((e) => e.date === date);
      if (todayEntry) {
        lastSeen[player.username] = todayEntry.rating;
      }
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

function StatCard({ title, value, subtitle, color }) {
  return (
    <div className="stat-card" style={{ borderColor: `${color}66` }}>
      <p className="stat-title">{title}</p>
      <p className="stat-value" style={{ color }}>
        {value}
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
          return [
            player.username,
            {
              history,
              profile: {
                current: stats.chess_rapid?.last?.rating ?? null,
                best: stats.chess_rapid?.best?.rating ?? null,
                record: stats.chess_rapid?.record ?? null,
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
    const tick = () => {
      const timeoutId = setTimeout(async () => {
        await loadAllData();
        tick();
      }, nextMidnightDelay());
      return timeoutId;
    };

    const timeoutId = tick();
    return () => clearTimeout(timeoutId);
  }, [loadAllData]);

  const chartData = useMemo(() => mergeSeries(seriesByUser), [seriesByUser]);

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
            <p>
              Daily ratings pulled from Chess.com game archives. The data refreshes automatically
              shortly after midnight, and you can trigger a manual sync any time.
            </p>
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
          <ResponsiveContainer width="100%" height={430}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#293142" />
              <XAxis dataKey="date" minTickGap={40} stroke="#93A4BA" />
              <YAxis stroke="#93A4BA" domain={["dataMin - 30", "dataMax + 30"]} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #293142" }}
                labelStyle={{ color: "#d1d5db" }}
              />
              <Legend />
              {PLAYERS.map((player) => (
                <Line
                  key={player.username}
                  type="monotone"
                  dataKey={player.username}
                  name={player.label}
                  stroke={player.color}
                  strokeWidth={2.2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </section>

        <footer className="footer">
          <span>
            Last synced: {lastUpdated ? lastUpdated.toLocaleString() : "—"} • Data points: {" "}
            {chartData.length}
          </span>
          <span>Source: Chess.com public API (rapid rated games)</span>
        </footer>
      </div>
    </main>
  );
}

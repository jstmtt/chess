import { toIsoDate } from "../utils/formatting";

const HISTORY_CACHE_PREFIX = "chess-rapid-history-v3";

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

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

async function fetchMonthlyArchives(monthUrls, chunkSize = 2) {
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

function computeStreak(rapidGames, normalizedUsername) {
  let streak = null;
  if (!rapidGames || rapidGames.length === 0) return null;

  streak = { type: null, count: 0 };
  for (let i = rapidGames.length - 1; i >= 0; i--) {
    const game = rapidGames[i];
    const isWhite = game.white?.username?.toLowerCase() === normalizedUsername;
    const isBlack = game.black?.username?.toLowerCase() === normalizedUsername;
    const playerResult = isWhite ? game.white?.result : isBlack ? game.black?.result : null;

    if (!playerResult) continue;

    let resultType = 'draw';
    if (playerResult === 'win') {
      resultType = 'win';
    } else if (['checkmated', 'timeout', 'resigned', 'abandoned', 'lose'].includes(playerResult)) {
      resultType = 'loss';
    }

    if (streak.type === null) {
      streak.type = resultType;
      streak.count = 1;
    } else if (streak.type === resultType) {
      streak.count++;
    } else {
      break;
    }
  }
  return streak;
}

export async function fetchRapidHistory(username) {
  const normalizedUsername = username.toLowerCase();
  const cacheKey = `${HISTORY_CACHE_PREFIX}:${normalizedUsername}`;
  // We no longer strictly invalidate based on 'refreshKey' for the whole cache!
  // Instead, we just use it to know if we've already synced TODAY.
  const todayRefreshKey = getUtcRefreshKey();

  const profileData = await fetchJson(`https://api.chess.com/pub/player/${normalizedUsername}`);
  let cachedRefreshKey = null;
  let historyMap = new Map();

  // Try parsing existing cache
  try {
    const cachedRaw = window.localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      cachedRefreshKey = cached?.refreshKey;

      if (Array.isArray(cached?.history)) {
        for (const pt of cached.history) {
          historyMap.set(pt.date, pt);
        }
      }
    }
  } catch {
    // ignore
  }

  // Determine what archives we still need.
  const joinedEpoch = profileData?.joined;
  let allMonthUrls = getMonthUrlsFromJoined(normalizedUsername, joinedEpoch);

  if (allMonthUrls.length === 0) {
    // fallback if 'joined' is bizarre or empty
    try {
      allMonthUrls = (await fetchJson(`https://api.chess.com/pub/player/${normalizedUsername}/games/archives`)).archives || [];
    } catch {
      allMonthUrls = [];
    }
  }

  // Find the LAST epoch in our history cache.
  let maxEpoch = 0;
  for (const pt of historyMap.values()) {
    if (pt.epoch > maxEpoch) maxEpoch = pt.epoch;
  }

  const urlsToFetch = [];

  // If we already synced today, we don't necessarily NEED to fetch anything.
  // HOWEVER, we should fetch the CURRENT month anyway to get new games played today.
  // Exception: If we have literally 0 history, we need to fetch all MonthURLs.
  if (historyMap.size === 0) {
    urlsToFetch.push(...allMonthUrls);
  } else {
    // Identify which months contain dates >= our maxEpoch
    // A month URL looks like .../games/YYYY/MM
    // We will just grab the last 2 months by default to be safe and ensure overlap
    urlsToFetch.push(...allMonthUrls.slice(-2));
  }

  // Deduplicate URLs before fetching (in case allMonthUrls was < 2)
  const uniqueUrlsToFetch = [...new Set(urlsToFetch)];
  const monthlyGames = await fetchMonthlyArchives(uniqueUrlsToFetch);

  // Filter & sort rapid games retrieved
  const rapidGames = monthlyGames
    .filter((game) => game.time_class === "rapid" && game.rated)
    .sort((a, b) => a.end_time - b.end_time);

  // We STILL compute streak from the MOST RECENT month games, as doing it across 
  // the entire historyMap is awkward when we only have 1 point per day stored!
  const streak = computeStreak(rapidGames, normalizedUsername);

  // Update historyMap with the newly fetched data
  for (const game of rapidGames) {
    const isWhite = game.white?.username?.toLowerCase() === normalizedUsername;
    const isBlack = game.black?.username?.toLowerCase() === normalizedUsername;
    const color = isWhite ? "white" : isBlack ? "black" : null;
    if (!color) continue;

    const rating = game[color]?.rating;
    if (typeof rating !== "number") continue;

    const date = toIsoDate(game.end_time);
    const previous = historyMap.get(date);
    // Overwrite if newer (higher epoch on the same date) or if no entry for date
    if (!previous || game.end_time > previous.epoch) {
      historyMap.set(date, { date, rating, epoch: game.end_time });
    }
  }

  const finalHistory = [...historyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Save updated combined map
  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        refreshKey: todayRefreshKey,
        history: finalHistory,
        savedAt: new Date().toISOString()
      })
    );
  } catch {
    // Ignore cache write limits
  }

  return { history: finalHistory, streak };
}
// ... existing imports and code ...

/**
 * Fetches all games played between two specific usernames (with Daily Caching)
 */
export async function fetchGamesBetween(player1, player2) {
  const p1 = player1.toLowerCase();
  const p2 = player2.toLowerCase();
  const cacheKey = `rivalry-v1:${p1}-${p2}`;

  // Use the same daily refresh key logic as your main history fetch
  const refreshKey = new Date().toISOString().slice(0, 10);

  // 1. Check if we already have today's rivalry data saved in the browser
  try {
    const cachedRaw = window.localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      // If the cache is from today, instantly return the saved games
      if (cached?.refreshKey === refreshKey && Array.isArray(cached?.games)) {
        return cached.games;
      }
    }
  } catch {
    // Ignore cache read issues and proceed to fetch
  }

  // 2. Cache missed or expired. Do the heavy fetching.
  const profileData = await fetchJson(`https://api.chess.com/pub/player/${p1}`);
  const monthUrls = getMonthUrlsFromJoined(p1, profileData?.joined);

  const archives = monthUrls.length > 0
    ? monthUrls
    : (await fetchJson(`https://api.chess.com/pub/player/${p1}/games/archives`)).archives || [];

  const allGames = await fetchMonthlyArchives(archives);

  // 3. Filter for games ONLY against Player 2
  const mutualGames = allGames.filter(game => {
    if (game.time_class !== 'rapid' || !game.rated) return false;

    const white = game.white?.username?.toLowerCase();
    const black = game.black?.username?.toLowerCase();

    return (white === p1 && black === p2) || (white === p2 && black === p1);
  });

  // 4. Sort by newest first
  const sortedGames = mutualGames.sort((a, b) => b.end_time - a.end_time);

  // 5. Save the result to local storage so the rest of the day loads instantly
  try {
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({ refreshKey, games: sortedGames })
    );
  } catch {
    // Ignore cache write limits
  }

  return sortedGames;
}

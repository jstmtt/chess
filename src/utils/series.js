export function mergeSeries(players, seriesByUser) {
  const allDates = new Set();
  Object.values(seriesByUser).forEach((entries) => {
    entries.forEach((entry) => allDates.add(entry.date));
  });

  const sortedDates = [...allDates].sort();
  const pointerByUser = Object.fromEntries(players.map((p) => [p.username, 0]));
  const lastSeen = {};

  return sortedDates.map((date) => {
    const row = { date };

    for (const player of players) {
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

export function sliceSeriesByTimeframe(chartData, timeframe, timeframes, now = new Date()) {
  if (timeframe === "all" || chartData.length === 0) {
    return chartData;
  }

  const selected = timeframes.find((option) => option.key === timeframe);
  if (!selected?.months) {
    return chartData;
  }

  const cutoffDate = new Date(now);
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
}

export function buildChartDataForView(timeframeData, players, hiddenPlayers) {
  return timeframeData.map((row) => {
    const next = { ...row };
    for (const player of players) {
      if (hiddenPlayers.has(player.username)) {
        next[player.username] = null;
      }
    }
    return next;
  });
}

export function calculateYAxisDomain(chartDataForView, activePlayers) {
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
}

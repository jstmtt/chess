import {
  buildChartDataForView,
  calculateYAxisDomain,
  mergeSeries,
  sliceSeriesByTimeframe,
} from "./series";

const PLAYERS = [{ username: "alpha" }, { username: "beta" }];
const TIMEFRAMES = [
  { key: "1m", months: 1 },
  { key: "all", months: null },
];

describe("mergeSeries", () => {
  it("fills forward values across dates", () => {
    const rows = mergeSeries(PLAYERS, {
      alpha: [
        { date: "2025-01-01", rating: 1000 },
        { date: "2025-01-03", rating: 1010 },
      ],
      beta: [{ date: "2025-01-02", rating: 900 }],
    });

    expect(rows).toEqual([
      { date: "2025-01-01", alpha: 1000, beta: null },
      { date: "2025-01-02", alpha: 1000, beta: 900 },
      { date: "2025-01-03", alpha: 1010, beta: 900 },
    ]);
  });
});

describe("sliceSeriesByTimeframe", () => {
  it("slices to timeframe and adds cutoff baseline", () => {
    const data = [
      { date: "2025-01-01", alpha: 1000, beta: 900 },
      { date: "2025-02-01", alpha: 1010, beta: 920 },
      { date: "2025-03-01", alpha: 1020, beta: 940 },
    ];

    const sliced = sliceSeriesByTimeframe(data, "1m", TIMEFRAMES, new Date("2025-03-15T12:00:00Z"));

    expect(sliced).toEqual([
      { date: "2025-02-15", alpha: 1010, beta: 920 },
      { date: "2025-03-01", alpha: 1020, beta: 940 },
    ]);
  });
});

describe("buildChartDataForView", () => {
  it("nulls hidden player values", () => {
    const next = buildChartDataForView(
      [{ date: "2025-01-01", alpha: 1000, beta: 900 }],
      PLAYERS,
      new Set(["beta"])
    );

    expect(next).toEqual([{ date: "2025-01-01", alpha: 1000, beta: null }]);
  });
});

describe("calculateYAxisDomain", () => {
  it("returns padded rounded min/max", () => {
    const domain = calculateYAxisDomain(
      [
        { date: "2025-01-01", alpha: 1010, beta: 940 },
        { date: "2025-01-02", alpha: 1142, beta: 980 },
      ],
      PLAYERS
    );

    expect(domain).toEqual([900, 1200]);
  });
});

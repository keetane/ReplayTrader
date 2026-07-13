import { describe, expect, it } from "vitest";
import type { Bar } from "../types";
import {
  aggregateBars,
  calculateBollingerBands,
  calculateMovingAverage,
  calculateVisibleMovingAverage,
  filterBarsByDate,
  filterBarsFromDateLookback,
  resolveRequestedDate,
} from "./bars";

const bars: Bar[] = [
  bar("2024-05-17 09:00:00+0900", 100, 103, 99, 102, 10),
  bar("2024-05-17 09:01:00+0900", 102, 104, 101, 103, 20),
  bar("2024-05-17 09:04:00+0900", 103, 106, 102, 105, 30),
  bar("2024-05-17 09:05:00+0900", 105, 107, 104, 106, 40),
  bar("2024-05-20 09:00:00+0900", 200, 201, 199, 200, 50),
];

describe("bar helpers", () => {
  it("resolves the nearest available date when the requested date is absent", () => {
    expect(resolveRequestedDate(bars, "2024-05-19").activeDate).toBe("2024-05-20");
    expect(resolveRequestedDate(bars, "2024-05-17").exact).toBe(true);
  });

  it("filters by date and aggregates 1m bars into 5m bars", () => {
    const dayBars = filterBarsByDate(bars, "2024-05-17");
    const aggregated = aggregateBars(dayBars, 5);

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]).toMatchObject({ open: 100, high: 106, low: 99, close: 105, volume: 60 });
    expect(aggregated[1]).toMatchObject({ open: 105, high: 107, low: 104, close: 106, volume: 40 });
  });

  it("filters chart bars from two available trading dates before the active date", () => {
    const sourceBars = [
      bar("2024-05-14 09:00:00+0900", 80, 80, 80, 80, 10),
      bar("2024-05-15 09:00:00+0900", 90, 90, 90, 90, 10),
      bar("2024-05-16 09:00:00+0900", 100, 100, 100, 100, 10),
      bar("2024-05-17 09:00:00+0900", 110, 110, 110, 110, 10),
    ];

    expect(filterBarsFromDateLookback(sourceBars, "2024-05-17", 2).map((item) => item.datetime)).toEqual([
      "2024-05-15 09:00:00+0900",
      "2024-05-16 09:00:00+0900",
      "2024-05-17 09:00:00+0900",
    ]);
  });

  it("includes Friday data when Monday is selected across a weekend", () => {
    const sourceBars = [
      bar("2024-05-16 09:00:00+0900", 90, 90, 90, 90, 10),
      bar("2024-05-17 09:00:00+0900", 100, 100, 100, 100, 10),
      bar("2024-05-20 09:00:00+0900", 110, 110, 110, 110, 10),
    ];

    expect(filterBarsFromDateLookback(sourceBars, "2024-05-20", 2).map((item) => item.datetime)).toEqual([
      "2024-05-16 09:00:00+0900",
      "2024-05-17 09:00:00+0900",
      "2024-05-20 09:00:00+0900",
    ]);
  });

  it("calculates moving averages from displayed bars", () => {
    expect(calculateMovingAverage(bars, 3)).toEqual([
      { time: bars[2].time, value: 103.33333333333333 },
      { time: bars[3].time, value: 104.66666666666667 },
      { time: bars[4].time, value: 137 },
    ]);
  });

  it("calculates displayed moving averages with prior-day source bars", () => {
    const sourceBars = [
      bar("2024-05-16 14:58:00+0900", 90, 90, 90, 90, 10),
      bar("2024-05-16 14:59:00+0900", 100, 100, 100, 100, 10),
      bar("2024-05-17 09:00:00+0900", 110, 110, 110, 110, 10),
      bar("2024-05-17 09:01:00+0900", 120, 120, 120, 120, 10),
    ];
    const displayedBars = filterBarsByDate(sourceBars, "2024-05-17");

    expect(calculateVisibleMovingAverage(sourceBars, displayedBars, 3)).toEqual([
      { time: displayedBars[0].time, value: 100 },
      { time: displayedBars[1].time, value: 110 },
    ]);
  });

  it("calculates bollinger bands from closing prices", () => {
    const sourceBars = [
      bar("2024-05-17 09:00:00+0900", 1, 1, 1, 1, 10),
      bar("2024-05-17 09:01:00+0900", 2, 2, 2, 2, 10),
      bar("2024-05-17 09:02:00+0900", 3, 3, 3, 3, 10),
    ];

    const bands = calculateBollingerBands(sourceBars, 3, 2);

    expect(bands).toHaveLength(1);
    expect(bands[0].middle).toBe(2);
    expect(bands[0].upper).toBeCloseTo(3.633, 3);
    expect(bands[0].lower).toBeCloseTo(0.367, 3);
  });
});

function bar(datetime: string, open: number, high: number, low: number, close: number, volume: number): Bar {
  return {
    datetime,
    time: Math.floor(Date.parse(datetime.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) / 1000) as Bar["time"],
    open,
    high,
    low,
    close,
    volume,
  };
}

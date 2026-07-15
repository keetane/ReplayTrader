import { describe, expect, it } from "vitest";
import { buildSyntheticCsv, CsvParseError, parseCsvText } from "./csv";

describe("parseCsvText", () => {
  it("parses JST offset datetimes, sorts rows, and keeps the last duplicate row", () => {
    const result = parseCsvText(
      [
        "Datetime,Close,High,Low,Open,Volume",
        "2026-02-19 09:06:00+0900,101,102,99,100,1000",
        "2026-02-19 09:05:00+0900,91,92,89,90,900",
        "2026-02-19 09:06:00+0900,111,112,109,110,1200",
      ].join("\n"),
      "7203.csv",
    );

    expect(result.symbol.id).toBe("7203");
    expect(result.symbol.bars).toHaveLength(2);
    expect(result.symbol.bars[0].datetime).toBe("2026-02-19 09:05:00+0900");
    expect(result.symbol.bars[1].close).toBe(111);
    expect(result.symbol.warnings[0]).toContain("重複");
  });

  it("rejects missing columns and invalid OHLC values", () => {
    expect(() => parseCsvText("Datetime,Close\n2026-02-19 09:05:00+0900,100")).toThrow(CsvParseError);
    expect(() =>
      parseCsvText("Datetime,Close,High,Low,Open,Volume\n2026-02-19 09:05:00+0900,110,105,100,100,1"),
    ).toThrow("High");
  });

  it("rejects empty numeric cells, mismatched column counts, and impossible dates", () => {
    expect(() =>
      parseCsvText("Datetime,Close,High,Low,Open,Volume\n2026-02-19 09:05:00+0900,,105,100,100,1"),
    ).toThrow("Close が空");
    expect(() =>
      parseCsvText("Datetime,Close,High,Low,Open,Volume\n2026-02-19 09:05:00+0900,100,105,99,100"),
    ).toThrow("カラム数");
    expect(() =>
      parseCsvText("Datetime,Close,High,Low,Open,Volume\n2026-02-30 09:05:00+0900,100,105,99,100,1"),
    ).toThrow("実在する日時");
  });

  it("builds a volatile synthetic semiconductor-style sample", () => {
    const result = parseCsvText(buildSyntheticCsv(), "DEMO_半導体風_1m.csv");
    const bars = result.symbol.bars;
    const highs = bars.map((bar) => bar.high);
    const lows = bars.map((bar) => bar.low);
    const firstThirtyAverageVolume = average(bars.slice(0, 30).map((bar) => bar.volume));
    const middayAverageVolume = average(bars.slice(90, 140).map((bar) => bar.volume));

    expect(result.symbol.id).toBe("DEMO_半導体風_1m");
    expect(bars).toHaveLength(300);
    expect(bars[0].datetime).toBe("2024-05-17 09:00:00+0900");
    expect(bars[149].datetime).toBe("2024-05-17 11:29:00+0900");
    expect(bars[150].datetime).toBe("2024-05-17 12:30:00+0900");
    expect(bars.at(-1)?.datetime).toBe("2024-05-17 14:59:00+0900");
    expect(Math.max(...highs) - Math.min(...lows)).toBeGreaterThan(500);
    expect(firstThirtyAverageVolume).toBeGreaterThan(middayAverageVolume);
    expect(Math.max(...bars.map((bar) => bar.volume))).toBeGreaterThan(1_000_000);
  });
});

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

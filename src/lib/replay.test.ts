import { describe, expect, it } from "vitest";
import { getIntrabarWalkIntervalMs, getIntrabarWalkTickCount, getReplayAdvanceIntervalMs } from "./replay";

describe("getReplayAdvanceIntervalMs", () => {
  it("uses real candle duration for 1x playback", () => {
    expect(getReplayAdvanceIntervalMs("1m", 1)).toBe(60_000);
    expect(getReplayAdvanceIntervalMs("5m", 1)).toBe(300_000);
  });

  it("scales candle duration by playback speed", () => {
    expect(getReplayAdvanceIntervalMs("1m", 5)).toBe(12_000);
    expect(getReplayAdvanceIntervalMs("1m", 10)).toBe(6_000);
    expect(getReplayAdvanceIntervalMs("1m", 30)).toBe(2_000);
    expect(getReplayAdvanceIntervalMs("1m", 60)).toBe(1_000);
    expect(getReplayAdvanceIntervalMs("5m", 5)).toBe(60_000);
    expect(getReplayAdvanceIntervalMs("5m", 10)).toBe(30_000);
    expect(getReplayAdvanceIntervalMs("5m", 30)).toBe(10_000);
    expect(getReplayAdvanceIntervalMs("5m", 60)).toBe(5_000);
  });

  it("falls back to 1x for invalid playback speed", () => {
    expect(getReplayAdvanceIntervalMs("1m", 0)).toBe(60_000);
    expect(getReplayAdvanceIntervalMs("5m", Number.NaN)).toBe(300_000);
  });
});

describe("getIntrabarWalkTickCount", () => {
  it("increases tick count for higher volume candles", () => {
    const volumes = [100, 200, 400, 800, 1_600];

    expect(getIntrabarWalkTickCount(100, volumes)).toBeLessThan(getIntrabarWalkTickCount(1_600, volumes));
  });

  it("uses playback interval divided by volume-linked ticks", () => {
    const lowVolumeInterval = getIntrabarWalkIntervalMs("1m", 60, 100, [100, 200, 400, 800, 1_600]);
    const highVolumeInterval = getIntrabarWalkIntervalMs("1m", 60, 1_600, [100, 200, 400, 800, 1_600]);

    expect(highVolumeInterval).toBeLessThan(lowVolumeInterval);
  });
});

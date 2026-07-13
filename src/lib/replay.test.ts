import { describe, expect, it } from "vitest";
import {
  clampToTseTick,
  getIntrabarDisplayVolume,
  getIntrabarWalkIntervalMs,
  getIntrabarWalkTickCount,
  getReplayAdvanceIntervalMs,
  getTseTickSize,
  moveToAdjacentTseTick,
  roundToTseTick,
} from "./replay";

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
  it("increases tick count for higher volume candles in desktop mode", () => {
    const volumes = [100, 200, 400, 800, 1_600];

    expect(getIntrabarWalkTickCount(100, volumes)).toBeLessThan(getIntrabarWalkTickCount(1_600, volumes));
    expect(getIntrabarWalkTickCount(100, volumes)).toBe(60);
    expect(getIntrabarWalkTickCount(1_600, volumes)).toBe(2_400);
  });

  it("uses share-count based ticks capped at 120 in mobile mode", () => {
    const volumes = [100, 1_000, 12_000, 24_000];

    expect(getIntrabarWalkTickCount(100, volumes, "mobile")).toBe(1);
    expect(getIntrabarWalkTickCount(1_000, volumes, "mobile")).toBe(10);
    expect(getIntrabarWalkTickCount(12_000, volumes, "mobile")).toBe(120);
    expect(getIntrabarWalkTickCount(24_000, volumes, "mobile")).toBe(120);
  });

  it("uses playback interval divided by volume-linked ticks", () => {
    const lowVolumeInterval = getIntrabarWalkIntervalMs("1m", 1, 100, [100, 200, 400, 800, 1_600]);
    const highVolumeInterval = getIntrabarWalkIntervalMs("1m", 1, 1_600, [100, 200, 400, 800, 1_600]);
    const mobileHighVolumeInterval = getIntrabarWalkIntervalMs("1m", 1, 12_000, [100, 1_000, 12_000], "mobile");

    expect(highVolumeInterval).toBeLessThan(lowVolumeInterval);
    expect(lowVolumeInterval).toBe(1_000);
    expect(highVolumeInterval).toBe(40);
    expect(mobileHighVolumeInterval).toBe(500);
  });
});

describe("getIntrabarDisplayVolume", () => {
  it("increases displayed volume by intrabar elapsed time", () => {
    expect(getIntrabarDisplayVolume(120_000, 0, "1m")).toBe(0);
    expect(getIntrabarDisplayVolume(120_000, 15_000, "1m")).toBe(30_000);
    expect(getIntrabarDisplayVolume(120_000, 30_000, "1m")).toBe(60_000);
    expect(getIntrabarDisplayVolume(120_000, 60_000, "1m")).toBe(120_000);
  });

  it("uses the selected timeframe duration", () => {
    expect(getIntrabarDisplayVolume(300_000, 60_000, "5m")).toBe(60_000);
    expect(getIntrabarDisplayVolume(300_000, 300_000, "5m")).toBe(300_000);
  });
});

describe("TOPIX500 tick size helpers", () => {
  it("uses TOPIX500 quote units by price band", () => {
    expect(getTseTickSize(1_000)).toBe(0.1);
    expect(getTseTickSize(1_000.1)).toBe(0.5);
    expect(getTseTickSize(3_000)).toBe(0.5);
    expect(getTseTickSize(3_000.1)).toBe(1);
    expect(getTseTickSize(10_000)).toBe(1);
    expect(getTseTickSize(10_000.1)).toBe(5);
    expect(getTseTickSize(100_000)).toBe(10);
    expect(getTseTickSize(100_001)).toBe(50);
    expect(getTseTickSize(1_000_000)).toBe(100);
    expect(getTseTickSize(1_000_001)).toBe(500);
    expect(getTseTickSize(50_000_001)).toBe(10_000);
  });

  it("rounds prices to the nearest TOPIX500 quote unit", () => {
    expect(roundToTseTick(999.94)).toBe(999.9);
    expect(roundToTseTick(999.96)).toBe(1_000);
    expect(roundToTseTick(1_000.2)).toBe(1_000);
    expect(roundToTseTick(1_000.3)).toBe(1_000.5);
    expect(roundToTseTick(3_000.4)).toBe(3_000);
    expect(roundToTseTick(3_000.6)).toBe(3_001);
    expect(roundToTseTick(10_002)).toBe(10_000);
    expect(roundToTseTick(10_003)).toBe(10_005);
    expect(roundToTseTick(100_024)).toBe(100_000);
    expect(roundToTseTick(100_026)).toBe(100_050);
  });

  it("keeps rounded random-walk prices inside the candle range", () => {
    const rounded = clampToTseTick(1_000.3, 1_000, 1_000.5);

    expect(rounded).toBeGreaterThanOrEqual(1_000);
    expect(rounded).toBeLessThanOrEqual(1_000.5);
    expect(rounded).toBe(1_000.5);
  });

  it("moves to the adjacent valid quote when rounding would keep the same price", () => {
    expect(moveToAdjacentTseTick(1_000, 1, 999, 1_001)).toBe(1_000.5);
    expect(moveToAdjacentTseTick(1_000, -1, 999, 1_001)).toBe(999.9);
    expect(moveToAdjacentTseTick(1_000, 1, 999, 1_000.4)).toBe(1_000);
  });
});

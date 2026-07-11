import type { Timeframe } from "../types";

const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
};

export function getTimeframeDurationMs(timeframe: Timeframe): number {
  return TIMEFRAME_DURATION_MS[timeframe];
}

export function getReplayAdvanceIntervalMs(timeframe: Timeframe, speed: number): number {
  const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return getTimeframeDurationMs(timeframe) / normalizedSpeed;
}

export function getIntrabarWalkTickCount(volume: number, volumes: number[]): number {
  const finiteVolumes = volumes.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!Number.isFinite(volume) || volume <= 0 || finiteVolumes.length === 0) return 6;

  const rank = finiteVolumes.filter((value) => value <= volume).length;
  const percentile = finiteVolumes.length <= 1 ? 1 : (rank - 1) / (finiteVolumes.length - 1);
  return Math.round(6 + percentile * 34);
}

export function getIntrabarWalkIntervalMs(timeframe: Timeframe, speed: number, volume: number, volumes: number[]): number {
  const advanceIntervalMs = getReplayAdvanceIntervalMs(timeframe, speed);
  const tickCount = getIntrabarWalkTickCount(volume, volumes);
  return Math.min(2_000, Math.max(40, Math.round(advanceIntervalMs / tickCount)));
}

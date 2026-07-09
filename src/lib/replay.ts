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

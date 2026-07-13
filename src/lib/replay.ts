import type { TickMode, Timeframe } from "../types";

const TIMEFRAME_DURATION_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
};

const TOPIX500_TICK_BANDS = [
  { lowerExclusive: 0, upperInclusive: 1_000, tick: 0.1 },
  { lowerExclusive: 1_000, upperInclusive: 3_000, tick: 0.5 },
  { lowerExclusive: 3_000, upperInclusive: 5_000, tick: 1 },
  { lowerExclusive: 5_000, upperInclusive: 10_000, tick: 1 },
  { lowerExclusive: 10_000, upperInclusive: 30_000, tick: 5 },
  { lowerExclusive: 30_000, upperInclusive: 50_000, tick: 10 },
  { lowerExclusive: 50_000, upperInclusive: 100_000, tick: 10 },
  { lowerExclusive: 100_000, upperInclusive: 300_000, tick: 50 },
  { lowerExclusive: 300_000, upperInclusive: 500_000, tick: 100 },
  { lowerExclusive: 500_000, upperInclusive: 1_000_000, tick: 100 },
  { lowerExclusive: 1_000_000, upperInclusive: 3_000_000, tick: 500 },
  { lowerExclusive: 3_000_000, upperInclusive: 5_000_000, tick: 1_000 },
  { lowerExclusive: 5_000_000, upperInclusive: 10_000_000, tick: 1_000 },
  { lowerExclusive: 10_000_000, upperInclusive: 30_000_000, tick: 5_000 },
  { lowerExclusive: 30_000_000, upperInclusive: 50_000_000, tick: 10_000 },
  { lowerExclusive: 50_000_000, upperInclusive: Number.POSITIVE_INFINITY, tick: 10_000 },
] as const;

export function getTimeframeDurationMs(timeframe: Timeframe): number {
  return TIMEFRAME_DURATION_MS[timeframe];
}

export function getReplayAdvanceIntervalMs(timeframe: Timeframe, speed: number): number {
  const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return getTimeframeDurationMs(timeframe) / normalizedSpeed;
}

export function getIntrabarWalkTickCount(volume: number, volumes: number[], tickMode: TickMode = "desktop"): number {
  if (tickMode === "mobile") {
    if (!Number.isFinite(volume) || volume <= 0) return 1;
    return Math.min(120, Math.max(1, Math.round(volume / 100)));
  }

  const minTicks = 60;
  const maxTicks = 2_400;
  const finiteVolumes = volumes.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!Number.isFinite(volume) || volume <= 0 || finiteVolumes.length === 0) return minTicks;

  const rank = finiteVolumes.filter((value) => value <= volume).length;
  const percentile = finiteVolumes.length <= 1 ? 1 : (rank - 1) / (finiteVolumes.length - 1);
  return Math.round(minTicks + percentile * (maxTicks - minTicks));
}

export function getIntrabarWalkIntervalMs(
  timeframe: Timeframe,
  speed: number,
  volume: number,
  volumes: number[],
  tickMode: TickMode = "desktop",
): number {
  const advanceIntervalMs = getReplayAdvanceIntervalMs(timeframe, speed);
  const tickCount = getIntrabarWalkTickCount(volume, volumes, tickMode);
  return Math.max(40, Math.round(advanceIntervalMs / tickCount));
}

export function getIntrabarDisplayVolume(volume: number, elapsedMs: number, timeframe: Timeframe): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  const durationMs = getTimeframeDurationMs(timeframe);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;

  const progress = Math.min(1, elapsedMs / durationMs);
  return Math.min(volume, Math.round(volume * progress));
}

export function getTseTickSize(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 1;
  return TOPIX500_TICK_BANDS.find((band) => price > band.lowerExclusive && price <= band.upperInclusive)?.tick ?? 10_000;
}

export function roundToTseTick(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  return findNearestTseTickPrice(price, 0, Number.POSITIVE_INFINITY) ?? normalizePrice(price);
}

export function clampToTseTick(price: number, min: number, max: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(min) || !Number.isFinite(max)) return price;

  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const bounded = Math.min(upper, Math.max(lower, price));
  return findNearestTseTickPrice(bounded, lower, upper) ?? normalizePrice(bounded);
}

export function moveToAdjacentTseTick(price: number, direction: number, min: number, max: number): number {
  if (!Number.isFinite(direction) || direction === 0) return clampToTseTick(price, min, max);

  const current = clampToTseTick(price, min, max);
  const adjacent = findAdjacentTseTickPrice(current, direction > 0 ? 1 : -1, Math.min(min, max), Math.max(min, max));
  return adjacent ?? current;
}

function findNearestTseTickPrice(price: number, min: number, max: number): number | null {
  let bestPrice: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const band of TOPIX500_TICK_BANDS) {
    const overlapMin = Math.max(min, band.lowerExclusive);
    const overlapMax = Math.min(max, band.upperInclusive);
    if (overlapMax <= band.lowerExclusive || overlapMin > overlapMax) continue;

    const seedPrices = [
      Math.round(price / band.tick) * band.tick,
      Math.floor(price / band.tick) * band.tick,
      Math.ceil(price / band.tick) * band.tick,
      Math.ceil(overlapMin / band.tick) * band.tick,
      Math.floor(overlapMax / band.tick) * band.tick,
    ];

    for (const seedPrice of seedPrices) {
      for (const candidate of [seedPrice - band.tick, seedPrice, seedPrice + band.tick]) {
        if (!isValidTseTickCandidate(candidate, band.lowerExclusive, band.upperInclusive, min, max, band.tick)) continue;

        const distance = Math.abs(candidate - price);
        if (distance < bestDistance || (distance === bestDistance && (bestPrice === null || candidate > bestPrice))) {
          bestPrice = candidate;
          bestDistance = distance;
        }
      }
    }
  }

  return bestPrice === null ? null : normalizePrice(bestPrice);
}

function findAdjacentTseTickPrice(price: number, direction: 1 | -1, min: number, max: number): number | null {
  let bestPrice: number | null = null;
  const epsilon = 1e-9;

  for (const band of TOPIX500_TICK_BANDS) {
    const overlapMin = Math.max(min, band.lowerExclusive);
    const overlapMax = Math.min(max, band.upperInclusive);
    if (overlapMax <= band.lowerExclusive || overlapMin > overlapMax) continue;

    const boundaryPrice =
      direction > 0
        ? Math.ceil(Math.max(overlapMin, price + epsilon) / band.tick) * band.tick
        : Math.floor(Math.min(overlapMax, price - epsilon) / band.tick) * band.tick;
    for (const candidate of [boundaryPrice - band.tick, boundaryPrice, boundaryPrice + band.tick]) {
      if (!isValidTseTickCandidate(candidate, band.lowerExclusive, band.upperInclusive, min, max, band.tick)) continue;
      if ((direction > 0 && candidate <= price) || (direction < 0 && candidate >= price)) continue;

      if (
        bestPrice === null ||
        (direction > 0 && candidate < bestPrice) ||
        (direction < 0 && candidate > bestPrice)
      ) {
        bestPrice = candidate;
      }
    }
  }

  return bestPrice === null ? null : normalizePrice(bestPrice);
}

function isValidTseTickCandidate(
  price: number,
  lowerExclusive: number,
  upperInclusive: number,
  min: number,
  max: number,
  tick: number,
): boolean {
  if (!Number.isFinite(price)) return false;
  if (price <= lowerExclusive || price > upperInclusive || price < min || price > max) return false;
  return Math.abs(price / tick - Math.round(price / tick)) < 1e-9;
}

function normalizePrice(price: number): number {
  return Number(price.toFixed(6));
}

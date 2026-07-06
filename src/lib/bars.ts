import type { Bar, Timeframe } from "../types";

export interface ResolvedDate {
  requestedDate: string;
  activeDate?: string;
  exact: boolean;
}

export function getTradingDates(bars: Bar[]): string[] {
  return Array.from(new Set(bars.map((bar) => bar.datetime.slice(0, 10)))).sort();
}

export function resolveRequestedDate(bars: Bar[], requestedDate: string, now = new Date()): ResolvedDate {
  const dates = getTradingDates(bars);
  if (dates.length === 0) {
    return { requestedDate, activeDate: undefined, exact: false };
  }

  if (requestedDate && !isDateInput(requestedDate)) {
    return { requestedDate, activeDate: undefined, exact: false };
  }

  const normalizedRequest = requestedDate || formatDateInput(now);
  if (dates.includes(normalizedRequest)) {
    return { requestedDate, activeDate: normalizedRequest, exact: true };
  }

  const target = Date.parse(`${normalizedRequest}T00:00:00+09:00`);
  const activeDate = dates.reduce((nearest, date) => {
    const currentDistance = Math.abs(Date.parse(`${date}T00:00:00+09:00`) - target);
    const nearestDistance = Math.abs(Date.parse(`${nearest}T00:00:00+09:00`) - target);
    return currentDistance < nearestDistance ? date : nearest;
  }, dates[0]);

  return { requestedDate, activeDate, exact: false };
}

export function filterBarsByDate(bars: Bar[], date?: string): Bar[] {
  if (!date) return [];
  return bars.filter((bar) => bar.datetime.startsWith(date));
}

export function prepareBarsForTimeframe(bars: Bar[], timeframe: Timeframe): Bar[] {
  if (timeframe === "1m") return bars;
  return aggregateBars(bars, 5);
}

export function aggregateBars(bars: Bar[], minutes: number): Bar[] {
  if (bars.length === 0) return [];
  const bucketSeconds = minutes * 60;
  const result: Bar[] = [];
  let currentBucket = Math.floor(bars[0].time / bucketSeconds) * bucketSeconds;
  let aggregate = createAggregateBar(bars[0], currentBucket);

  for (const bar of bars.slice(1)) {
    const bucket = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    if (bucket !== currentBucket) {
      result.push(aggregate);
      currentBucket = bucket;
      aggregate = createAggregateBar(bar, bucket);
      continue;
    }

    aggregate.high = Math.max(aggregate.high, bar.high);
    aggregate.low = Math.min(aggregate.low, bar.low);
    aggregate.close = bar.close;
    aggregate.volume += bar.volume;
  }

  result.push(aggregate);
  return result;
}

export function calculateMovingAverage(bars: Bar[], period: number): { time: Bar["time"]; value: number }[] {
  if (period <= 0 || bars.length < period) return [];
  const values: { time: Bar["time"]; value: number }[] = [];
  let sum = 0;

  for (let index = 0; index < bars.length; index += 1) {
    sum += bars[index].close;
    if (index >= period) {
      sum -= bars[index - period].close;
    }
    if (index >= period - 1) {
      values.push({ time: bars[index].time, value: sum / period });
    }
  }

  return values;
}

export function calculateVisibleMovingAverage(
  sourceBars: Bar[],
  displayedBars: Bar[],
  period: number,
): { time: Bar["time"]; value: number }[] {
  if (displayedBars.length === 0) return [];
  const displayedTimes = new Set(displayedBars.map((bar) => bar.time));
  return calculateMovingAverage(sourceBars, period).filter((point) => displayedTimes.has(point.time));
}

function createAggregateBar(bar: Bar, bucket: number): Bar {
  return {
    time: bucket as Bar["time"],
    datetime: bar.datetime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function formatDateInput(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+09:00`));
}

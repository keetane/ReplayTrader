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

export function filterBarsFromDateLookback(bars: Bar[], date: string | undefined, lookbackDays: number): Bar[] {
  if (!date) return [];
  const dates = getTradingDates(bars);
  const activeDateIndex = dates.indexOf(date);
  if (activeDateIndex === -1) return [];

  const startDateIndex = Math.max(0, activeDateIndex - Math.max(0, Math.floor(lookbackDays)));
  const visibleDates = new Set(dates.slice(startDateIndex, activeDateIndex + 1));
  return bars.filter((bar) => visibleDates.has(bar.datetime.slice(0, 10)));
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

export interface BollingerBandPoint {
  time: Bar["time"];
  upper: number;
  middle: number;
  lower: number;
}

export function calculateBollingerBands(bars: Bar[], period: number, multiplier: number): BollingerBandPoint[] {
  if (period <= 0 || multiplier <= 0 || bars.length < period) return [];
  const values: BollingerBandPoint[] = [];
  let sum = 0;
  let squaredSum = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const close = bars[index].close;
    sum += close;
    squaredSum += close * close;

    if (index >= period) {
      const dropped = bars[index - period].close;
      sum -= dropped;
      squaredSum -= dropped * dropped;
    }

    if (index >= period - 1) {
      const middle = sum / period;
      const variance = Math.max(0, squaredSum / period - middle * middle);
      const bandWidth = Math.sqrt(variance) * multiplier;
      values.push({
        time: bars[index].time,
        upper: middle + bandWidth,
        middle,
        lower: middle - bandWidth,
      });
    }
  }

  return values;
}

export function calculateVisibleBollingerBands(
  sourceBars: Bar[],
  displayedBars: Bar[],
  period: number,
  multiplier: number,
): BollingerBandPoint[] {
  if (displayedBars.length === 0) return [];
  const displayedTimes = new Set(displayedBars.map((bar) => bar.time));
  return calculateBollingerBands(sourceBars, period, multiplier).filter((point) => displayedTimes.has(point.time));
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

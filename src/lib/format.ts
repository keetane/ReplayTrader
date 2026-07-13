import { roundToTseTick } from "./replay";

export function formatPrice(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

export function formatTseTickPrice(value: number): string {
  return formatPrice(roundToTseTick(value));
}

export function formatYen(value: number): string {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value)} 円`;
}

export function formatSignedYen(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatYen(value)}`;
}

export function formatVolume(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}%`;
}

import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import { formatTseTickPrice } from "./format";
import type { Bar, Execution, HistoricalTrade, LanguageMode, Timeframe } from "../types";

const OPEN_BUY_COLOR = "#166534";
const OPEN_SELL_COLOR = "#ec4899";
const PROFIT_CLOSE_COLOR = "#22c55e";
const LOSS_CLOSE_COLOR = "#ef4444";
const FLAT_CLOSE_COLOR = "#94a3b8";

export interface ExecutionMarkerLabel {
  id: string;
  time: Time;
  price: number;
  text: string;
  color: string;
  verticalPreference: "above" | "below";
}

export function historicalTradeAsExecution(trade: HistoricalTrade): Execution {
  return {
    id: `historical-${trade.id}`,
    orderId: trade.orderNumber ?? trade.id,
    symbol: trade.symbolId ?? trade.ticker,
    side: trade.side,
    tradeType: trade.tradeType,
    quantity: trade.quantity,
    price: trade.price,
    time: trade.time,
    realizedPnl: trade.realizedPnl ?? 0,
    note: "実約定履歴",
  };
}

export function alignHistoricalExecutionToBar(execution: Execution, bars: Bar[], timeframe: Timeframe): Execution {
  const timestamp = parseExecutionTimestamp(execution.time);
  if (timestamp == null || bars.length === 0) return execution;

  const date = execution.time.slice(0, 10);
  const dateBars = bars.filter((bar) => bar.datetime.startsWith(date));
  if (dateBars.length === 0) return execution;

  const stepSeconds = timeframe === "5m" ? 300 : 60;
  const bucketTime = Math.floor(timestamp / stepSeconds) * stepSeconds;
  const primaryBar =
    dateBars.find((bar) => Number(bar.time) === bucketTime) ??
    dateBars.reduce((nearest, bar) => (Number(bar.time) <= timestamp && Number(bar.time) > Number(nearest.time) ? bar : nearest), dateBars[0]);
  const matchingBar = dateBars
    .filter((bar) => execution.price >= bar.low && execution.price <= bar.high)
    .sort((first, second) => Math.abs(Number(first.time) - timestamp) - Math.abs(Number(second.time) - timestamp))[0];

  if (matchingBar) {
    if (matchingBar.time === primaryBar.time) return execution;
    return {
      ...execution,
      displayTime: matchingBar.datetime,
      displayPrice: execution.price,
      displayAdjustment: "matched-bar",
    };
  }

  return {
    ...execution,
    displayTime: primaryBar.datetime,
    displayPrice: Math.min(primaryBar.high, Math.max(primaryBar.low, execution.price)),
    displayAdjustment: "clamped-to-bar",
  };
}

export function buildExecutionMarkers(executions: Execution[], timeframe: Timeframe): SeriesMarker<Time>[] {
  return executions
    .map((execution): SeriesMarker<Time> | null => {
      const time = executionMarkerTime(execution.displayTime ?? execution.time, timeframe);
      if (time == null) return null;

      const closeMarker = buildCloseMarker(execution);
      const price = execution.displayPrice ?? execution.price;
      if (closeMarker) {
        return {
          id: execution.id,
          time,
          position: "atPriceMiddle",
          price,
          shape: closeMarker.shape,
          color: closeMarker.color,
          size: executionMarkerSize(execution.quantity),
        };
      }

      return {
        id: execution.id,
        time,
        position: "atPriceMiddle",
        price,
        shape: execution.side === "buy" ? "arrowUp" : "arrowDown",
        color: execution.side === "buy" ? OPEN_BUY_COLOR : OPEN_SELL_COLOR,
        size: executionMarkerSize(execution.quantity),
      };
    })
    .filter((marker): marker is SeriesMarker<Time> => marker != null)
    .sort((first, second) => Number(first.time) - Number(second.time));
}

export function buildExecutionMarkerLabels(
  executions: Execution[],
  timeframe: Timeframe,
  languageMode: LanguageMode = "ja",
): ExecutionMarkerLabel[] {
  return executions
    .map((execution): ExecutionMarkerLabel | null => {
      const time = executionMarkerTime(execution.displayTime ?? execution.time, timeframe);
      if (time == null) return null;
      const closeMarker = buildCloseMarker(execution, languageMode);
      const isClose = closeMarker != null;
      const color = closeMarker?.color ?? (execution.side === "buy" ? OPEN_BUY_COLOR : OPEN_SELL_COLOR);
      const actualPriceNote = formatDisplayAdjustment(execution, languageMode);
      return {
        id: execution.id,
        time,
        price: execution.displayPrice ?? execution.price,
        text: closeMarker?.text
          ? `${closeMarker.text}${actualPriceNote}`
          : `${execution.side === "buy" ? orderLabel("buy", languageMode) : orderLabel("sell", languageMode)} ${formatQuantity(execution.quantity, languageMode)}${actualPriceNote}`,
        color,
        verticalPreference: isClose || execution.side === "sell" ? "above" : "below",
      };
    })
    .filter((label): label is ExecutionMarkerLabel => label != null)
    .sort((first, second) => Number(first.time) - Number(second.time));
}

function buildCloseMarker(
  execution: Execution,
  languageMode: LanguageMode = "ja",
): Pick<SeriesMarker<Time>, "shape" | "color" | "text"> | null {
  if (!isClosingExecution(execution)) return null;

  if (execution.realizedPnl > 0) {
    return {
      shape: "circle",
      color: PROFIT_CLOSE_COLOR,
      text: `${languageMode === "ja" ? "利確" : "Profit"} ${formatSignedYen(execution.realizedPnl, languageMode)} ${formatQuantity(execution.quantity, languageMode)}`,
    };
  }

  if (execution.realizedPnl < 0) {
    return {
      shape: "square",
      color: LOSS_CLOSE_COLOR,
      text: `× ${languageMode === "ja" ? "損失" : "Loss"} ${formatSignedYen(execution.realizedPnl, languageMode)} ${formatQuantity(execution.quantity, languageMode)}`,
    };
  }

  return {
    shape: "square",
    color: FLAT_CLOSE_COLOR,
    text: `${languageMode === "ja" ? "決済" : "Close"} ${formatSignedYen(execution.realizedPnl, languageMode)} ${formatQuantity(execution.quantity, languageMode)}`,
  };
}

function isClosingExecution(execution: Execution): boolean {
  return execution.tradeType === "marginClose" || (execution.tradeType === "cash" && execution.side === "sell");
}

function executionMarkerTime(datetime: string, timeframe: Timeframe): UTCTimestamp | null {
  const timestamp = parseExecutionTimestamp(datetime);
  if (timestamp == null) return null;
  const stepSeconds = timeframe === "5m" ? 300 : 60;
  return (Math.floor(timestamp / stepSeconds) * stepSeconds) as UTCTimestamp;
}

function parseExecutionTimestamp(datetime: string): number | null {
  const timestamp = Date.parse(datetime.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function formatDisplayAdjustment(execution: Execution, languageMode: LanguageMode): string {
  if (!execution.displayAdjustment) return "";
  const price = formatTseTickPrice(execution.price);
  return languageMode === "ja" ? ` @${price}円` : ` @¥${price}`;
}

function executionMarkerSize(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 1;
  return Math.min(3.2, Math.max(1, Math.sqrt(quantity / 100)));
}

function orderLabel(side: "buy" | "sell", languageMode: LanguageMode): string {
  if (languageMode === "ja") return side === "buy" ? "買" : "売";
  return side === "buy" ? "Buy" : "Sell";
}

function formatQuantity(quantity: number, languageMode: LanguageMode): string {
  return quantity.toLocaleString(languageMode === "ja" ? "ja-JP" : "en-US");
}

function formatSignedYen(value: number, languageMode: LanguageMode): string {
  const sign = value > 0 ? "+" : "";
  const locale = languageMode === "ja" ? "ja-JP" : "en-US";
  const rounded = Math.round(value).toLocaleString(locale);
  return languageMode === "ja" ? `${sign}${rounded}円` : `${sign}¥${rounded}`;
}

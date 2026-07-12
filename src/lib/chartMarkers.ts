import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import type { Execution, Timeframe } from "../types";

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

export function buildExecutionMarkers(executions: Execution[], timeframe: Timeframe): SeriesMarker<Time>[] {
  return executions
    .map((execution): SeriesMarker<Time> | null => {
      const time = executionMarkerTime(execution.time, timeframe);
      if (time == null) return null;

      const closeMarker = buildCloseMarker(execution);
      if (closeMarker) {
        return {
          id: execution.id,
          time,
          position: "atPriceMiddle",
          price: execution.price,
          shape: closeMarker.shape,
          color: closeMarker.color,
          size: executionMarkerSize(execution.quantity),
        };
      }

      return {
        id: execution.id,
        time,
        position: "atPriceMiddle",
        price: execution.price,
        shape: execution.side === "buy" ? "arrowUp" : "arrowDown",
        color: execution.side === "buy" ? OPEN_BUY_COLOR : OPEN_SELL_COLOR,
        size: executionMarkerSize(execution.quantity),
      };
    })
    .filter((marker): marker is SeriesMarker<Time> => marker != null)
    .sort((first, second) => Number(first.time) - Number(second.time));
}

export function buildExecutionMarkerLabels(executions: Execution[], timeframe: Timeframe): ExecutionMarkerLabel[] {
  return executions
    .map((execution): ExecutionMarkerLabel | null => {
      const time = executionMarkerTime(execution.time, timeframe);
      if (time == null) return null;
      const closeMarker = buildCloseMarker(execution);
      const isClose = closeMarker != null;
      const color = closeMarker?.color ?? (execution.side === "buy" ? OPEN_BUY_COLOR : OPEN_SELL_COLOR);
      return {
        id: execution.id,
        time,
        price: execution.price,
        text: closeMarker?.text ?? `${execution.side === "buy" ? "買" : "売"} ${formatQuantity(execution.quantity)}`,
        color,
        verticalPreference: isClose || execution.side === "sell" ? "above" : "below",
      };
    })
    .filter((label): label is ExecutionMarkerLabel => label != null)
    .sort((first, second) => Number(first.time) - Number(second.time));
}

function buildCloseMarker(
  execution: Execution,
): Pick<SeriesMarker<Time>, "shape" | "color" | "text"> | null {
  if (!isClosingExecution(execution)) return null;

  if (execution.realizedPnl > 0) {
    return {
      shape: "circle",
      color: PROFIT_CLOSE_COLOR,
      text: `利確 ${formatSignedYen(execution.realizedPnl)} ${formatQuantity(execution.quantity)}`,
    };
  }

  if (execution.realizedPnl < 0) {
    return {
      shape: "square",
      color: LOSS_CLOSE_COLOR,
      text: `× 損失 ${formatSignedYen(execution.realizedPnl)} ${formatQuantity(execution.quantity)}`,
    };
  }

  return {
    shape: "square",
    color: FLAT_CLOSE_COLOR,
    text: `決済 ${formatSignedYen(execution.realizedPnl)} ${formatQuantity(execution.quantity)}`,
  };
}

function isClosingExecution(execution: Execution): boolean {
  return execution.tradeType === "marginClose" || (execution.tradeType === "cash" && execution.side === "sell");
}

function executionMarkerTime(datetime: string, timeframe: Timeframe): UTCTimestamp | null {
  const timestamp = Date.parse(datetime.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isFinite(timestamp)) return null;
  const stepSeconds = timeframe === "5m" ? 300 : 60;
  return (Math.floor(timestamp / 1000 / stepSeconds) * stepSeconds) as UTCTimestamp;
}

function executionMarkerSize(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 1;
  return Math.min(3.2, Math.max(1, Math.sqrt(quantity / 100)));
}

function formatQuantity(quantity: number): string {
  return quantity.toLocaleString("ja-JP");
}

function formatSignedYen(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value).toLocaleString("ja-JP")}円`;
}

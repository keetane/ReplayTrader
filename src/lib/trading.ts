import type { Bar, Execution, Position, PositionProduct, Side, TradeType, TradingState, VirtualOrder } from "../types";

export const DEFAULT_INITIAL_CASH = 5_000_000;
export const DEFAULT_MARGIN_REQUIREMENT_RATE = 0.3;

export const INITIAL_TRADING_STATE: TradingState = {
  initialCash: DEFAULT_INITIAL_CASH,
  cash: DEFAULT_INITIAL_CASH,
  realizedPnl: 0,
  orders: [],
  executions: [],
  positions: [],
};

export interface SubmitOrderInput {
  symbol: string;
  side: Side;
  tradeType: TradeType;
  orderType: "market" | "limit";
  quantity: number;
  limitPrice?: number;
  bar: Bar;
  replayIndex: number;
}

export function submitVirtualOrder(state: TradingState, input: SubmitOrderInput): TradingState {
  const normalizedState = normalizeTradingState(state);
  const orderId = crypto.randomUUID();
  const quantity = Math.trunc(input.quantity);
  const orderDate = tradingDate(input.bar.datetime);
  const order: VirtualOrder = {
    id: orderId,
    symbol: input.symbol,
    side: input.side,
    tradeType: input.tradeType,
    orderType: input.orderType,
    quantity,
    limitPrice: input.limitPrice,
    requestedAt: input.bar.datetime,
    replayIndex: input.replayIndex,
    status: "rejected",
  };

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return appendRejected(normalizedState, order, "数量は1以上の整数で指定してください。");
  }

  if (input.tradeType === "marginOpen" && hasCarriedMarginPositions(normalizedState.positions, orderDate)) {
    return appendRejected(normalizedState, order, "日跨ぎ建玉があるため新規注文はできません。信用返済で建玉を解消してください。");
  }

  if (input.tradeType === "cash" && input.side === "sell") {
    const closableQuantity = totalQuantity(normalizedState.positions, "cash", input.symbol, "long");
    if (closableQuantity <= 0) {
      return appendRejected(normalizedState, order, "売却対象の現物保有がありません。");
    }
    if (quantity > closableQuantity) {
      return appendRejected(normalizedState, order, "現物保有数量を超えています。");
    }
  }

  if (input.tradeType === "marginClose") {
    const closingSide = input.side === "buy" ? "short" : "long";
    const closableQuantity = totalQuantity(normalizedState.positions, "margin", input.symbol, closingSide);
    if (closableQuantity <= 0) {
      return appendRejected(normalizedState, order, "返済対象の建玉がありません。");
    }
    if (quantity > closableQuantity) {
      return appendRejected(normalizedState, order, "返済可能数量を超えています。");
    }
  }

  const fillPrice = resolveFillPrice(input);
  if (fillPrice == null) {
    return appendRejected(normalizedState, order, "指値が現在バーの高値/安値に到達していません。");
  }

  if (input.tradeType === "cash" && input.side === "buy" && fillPrice * quantity > normalizedState.cash) {
    return appendRejected(normalizedState, order, "現金残高を超える現物買い注文です。");
  }

  if (input.tradeType === "marginOpen") {
    const currentExposure = evaluateMarginExposure(normalizedState.positions, fillPrice);
    const buyingPower = evaluateMarginBuyingPower(normalizedState.cash, currentExposure);
    const orderExposure = fillPrice * quantity;
    if (orderExposure > buyingPower) {
      return appendRejected(normalizedState, order, "信用建余力を超える新規注文です。");
    }
  }

  const execution: Execution = {
    id: crypto.randomUUID(),
    orderId,
    symbol: input.symbol,
    side: input.side,
    tradeType: input.tradeType,
    quantity,
    price: fillPrice,
    time: input.bar.datetime,
    realizedPnl: 0,
    note: "仮想約定: 実注文ではありません",
  };

  const { positions, realizedPnl, cashDelta } = applyExecution(normalizedState.positions, execution);
  execution.realizedPnl = realizedPnl;

  return {
    ...normalizedState,
    cash: normalizedState.cash + cashDelta,
    realizedPnl: normalizedState.realizedPnl + realizedPnl,
    orders: [{ ...order, status: "filled" as const }, ...normalizedState.orders].slice(0, 200),
    executions: [execution, ...normalizedState.executions].slice(0, 200),
    positions,
  };
}

export function normalizeTradingState(state: TradingState): TradingState {
  const initialCash = Number.isFinite(state.initialCash) ? state.initialCash : DEFAULT_INITIAL_CASH;
  return {
    ...state,
    initialCash,
    cash: Number.isFinite(state.cash) ? state.cash : initialCash,
    positions: state.positions.map(normalizePosition),
  };
}

export function updateInitialCash(state: TradingState, nextInitialCash: number): TradingState {
  const normalizedState = normalizeTradingState(state);
  const rounded = Math.trunc(nextInitialCash);
  if (!Number.isFinite(rounded) || rounded < 0) {
    return normalizedState;
  }
  const delta = rounded - normalizedState.initialCash;
  return {
    ...normalizedState,
    initialCash: rounded,
    cash: normalizedState.cash + delta,
  };
}

export function evaluateUnrealizedPnl(positions: Position[], latestPrice: number): number {
  return positions.reduce((sum, position) => sum + evaluatePositionUnrealizedPnl(position, latestPrice), 0);
}

export function evaluatePositionUnrealizedPnl(position: Position, latestPrice: number): number {
  if (position.side === "long") {
    return (latestPrice - position.entryPrice) * position.quantity;
  }
  return (position.entryPrice - latestPrice) * position.quantity;
}

export function evaluatePositionPnlSummary(positions: Position[], latestPrice: number): { buy: number; sell: number; total: number } {
  return positions.reduce(
    (summary, position) => {
      const pnl = evaluatePositionUnrealizedPnl(position, latestPrice);
      if (position.side === "long") {
        summary.buy += pnl;
      } else {
        summary.sell += pnl;
      }
      summary.total += pnl;
      return summary;
    },
    { buy: 0, sell: 0, total: 0 },
  );
}

export function evaluateMarginUnrealizedPnl(positions: Position[], latestPrice: number): number {
  return evaluateUnrealizedPnl(
    positions.filter((position) => position.product === "margin"),
    latestPrice,
  );
}

export function evaluateCashMarketValue(positions: Position[], latestPrice: number): number {
  return positions.reduce((sum, position) => {
    if (position.product !== "cash") return sum;
    return sum + latestPrice * position.quantity;
  }, 0);
}

export function evaluateMarginExposure(positions: Position[], latestPrice: number): number {
  return positions.reduce((sum, position) => {
    if (position.product !== "margin") return sum;
    return sum + latestPrice * position.quantity;
  }, 0);
}

export function evaluateMaintenanceRatio(accountValue: number, marginExposure: number): number | null {
  if (marginExposure <= 0) return null;
  return (accountValue / marginExposure) * 100;
}

export function evaluateMarginBuyingPower(
  cashAvailable: number,
  marginExposure: number,
  requirementRate = DEFAULT_MARGIN_REQUIREMENT_RATE,
): number {
  if (!Number.isFinite(cashAvailable) || !Number.isFinite(marginExposure) || requirementRate <= 0) {
    return 0;
  }
  return Math.max(0, cashAvailable / requirementRate - marginExposure);
}

function resolveFillPrice(input: SubmitOrderInput): number | null {
  if (input.orderType === "market") {
    return input.bar.close;
  }
  const price = input.limitPrice;
  if (price === undefined || !Number.isFinite(price)) {
    return null;
  }
  return price >= input.bar.low && price <= input.bar.high ? price : null;
}

function appendRejected(state: TradingState, order: VirtualOrder, message: string): TradingState {
  return {
    ...state,
    orders: [{ ...order, message }, ...state.orders].slice(0, 200),
  };
}

function normalizePosition(position: Position, index: number): Position {
  const legacy = position as Partial<Position> & { averagePrice?: number };
  const product: PositionProduct = legacy.product === "cash" ? "cash" : "margin";
  const openedDate = legacy.openedDate ?? inferTradingDate(legacy.openedAt);
  const side = product === "cash" ? "long" : legacy.side === "short" ? "short" : "long";
  const entryPrice = legacy.entryPrice ?? legacy.averagePrice ?? 0;
  return {
    id: legacy.id ?? `${product}-${legacy.symbol ?? "unknown"}-${side}-${openedDate}-${index}`,
    product,
    symbol: legacy.symbol ?? "unknown",
    side,
    quantity: Number.isFinite(legacy.quantity) ? Math.max(0, Math.trunc(legacy.quantity ?? 0)) : 0,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
    openedDate,
    openedAt: legacy.openedAt ?? `${openedDate} 00:00:00+0900`,
  };
}

function applyExecution(
  positions: Position[],
  execution: Execution,
): { positions: Position[]; realizedPnl: number; cashDelta: number } {
  const next = positions.map((position) => ({ ...position }));
  const closingSide = execution.side === "buy" ? "short" : "long";
  const openingSide = execution.side === "buy" ? "long" : "short";
  const openingDate = tradingDate(execution.time);

  if (execution.tradeType === "cash") {
    if (execution.side === "buy") {
      return {
        positions: [
          ...next.filter((position) => position.quantity > 0),
          buildPosition(execution, "cash", "long", openingDate),
        ],
        realizedPnl: 0,
        cashDelta: -execution.price * execution.quantity,
      };
    }

    const close = closePositions(next, execution, "cash", "long");
    return {
      positions: close.positions,
      realizedPnl: close.realizedPnl,
      cashDelta: execution.price * execution.quantity,
    };
  }

  if (execution.tradeType === "marginClose") {
    const close = closePositions(next, execution, "margin", closingSide);
    return { positions: close.positions, realizedPnl: close.realizedPnl, cashDelta: close.realizedPnl };
  }

  return {
    positions: [...next.filter((position) => position.quantity > 0), buildPosition(execution, "margin", openingSide, openingDate)],
    realizedPnl: 0,
    cashDelta: 0,
  };
}

function buildPosition(execution: Execution, product: PositionProduct, side: Position["side"], openedDate: string): Position {
  return {
    id: execution.id,
    product,
    symbol: execution.symbol,
    side,
    quantity: execution.quantity,
    entryPrice: execution.price,
    openedDate,
    openedAt: execution.time,
  };
}

function closePositions(
  positions: Position[],
  execution: Execution,
  product: PositionProduct,
  closingSide: Position["side"],
): { positions: Position[]; realizedPnl: number } {
  let remaining = execution.quantity;
  let realizedPnl = 0;

  for (const position of positions) {
    if (
      position.product !== product ||
      position.symbol !== execution.symbol ||
      position.side !== closingSide ||
      remaining <= 0
    ) {
      continue;
    }

    const closeQuantity = Math.min(position.quantity, remaining);
    if (position.side === "long") {
      realizedPnl += (execution.price - position.entryPrice) * closeQuantity;
    } else {
      realizedPnl += (position.entryPrice - execution.price) * closeQuantity;
    }
    position.quantity -= closeQuantity;
    remaining -= closeQuantity;
  }

  return { positions: positions.filter((position) => position.quantity > 0), realizedPnl };
}

function tradingDate(datetime: string): string {
  return datetime.slice(0, 10);
}

function inferTradingDate(datetime: string | undefined): string {
  if (!datetime) return "unknown";
  const date = tradingDate(datetime);
  return date || "unknown";
}

function hasCarriedMarginPositions(positions: Position[], currentDate: string): boolean {
  return positions.some((position) => position.product === "margin" && position.openedDate !== currentDate);
}

function totalQuantity(positions: Position[], product: PositionProduct, symbol: string, side: Position["side"]): number {
  return positions.reduce((sum, position) => {
    if (position.product !== product || position.symbol !== symbol || position.side !== side) return sum;
    return sum + position.quantity;
  }, 0);
}

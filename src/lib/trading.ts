import type { Bar, Execution, Position, Side, TradeType, TradingState, VirtualOrder } from "../types";

export const DEFAULT_INITIAL_CASH = 5_000_000;

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

  if (input.tradeType !== "marginClose" && hasCarriedPositions(normalizedState.positions, orderDate)) {
    return appendRejected(normalizedState, order, "日跨ぎ建玉があるため新規注文はできません。信用返済で建玉を解消してください。");
  }

  if (input.tradeType === "marginClose") {
    const closingSide = input.side === "buy" ? "short" : "long";
    const closableQuantity = totalQuantity(normalizedState.positions, input.symbol, closingSide);
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

  const { positions, realizedPnl } = applyExecution(normalizedState.positions, execution);
  execution.realizedPnl = realizedPnl;

  return {
    ...normalizedState,
    cash: normalizedState.cash + realizedPnl,
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
    positions: state.positions.map((position) => ({
      ...position,
      openedDate: position.openedDate ?? "unknown",
    })),
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
  return positions.reduce((sum, position) => {
    if (position.side === "long") {
      return sum + (latestPrice - position.averagePrice) * position.quantity;
    }
    return sum + (position.averagePrice - latestPrice) * position.quantity;
  }, 0);
}

export function evaluateMarginExposure(positions: Position[], latestPrice: number): number {
  return positions.reduce((sum, position) => sum + latestPrice * position.quantity, 0);
}

export function evaluateMaintenanceRatio(accountValue: number, marginExposure: number): number | null {
  if (marginExposure <= 0) return null;
  return (accountValue / marginExposure) * 100;
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

function applyExecution(positions: Position[], execution: Execution): { positions: Position[]; realizedPnl: number } {
  const next = positions.map((position) => ({ ...position }));
  const closingSide = execution.side === "buy" ? "short" : "long";
  const openingSide = execution.side === "buy" ? "long" : "short";
  const openingDate = tradingDate(execution.time);
  let remaining = execution.quantity;
  let realizedPnl = 0;

  if (execution.tradeType === "marginClose") {
    for (const position of next) {
      if (position.symbol !== execution.symbol || position.side !== closingSide || remaining <= 0) {
        continue;
      }

      const closeQuantity = Math.min(position.quantity, remaining);
      if (position.side === "long") {
        realizedPnl += (execution.price - position.averagePrice) * closeQuantity;
      } else {
        realizedPnl += (position.averagePrice - execution.price) * closeQuantity;
      }
      position.quantity -= closeQuantity;
      remaining -= closeQuantity;
    }

    return { positions: next.filter((position) => position.quantity > 0), realizedPnl };
  }

  const filtered = next.filter((position) => position.quantity > 0);

  if (remaining > 0) {
    const existing = filtered.find(
      (position) => position.symbol === execution.symbol && position.side === openingSide && position.openedDate === openingDate,
    );
    if (existing) {
      const totalCost = existing.averagePrice * existing.quantity + execution.price * remaining;
      existing.quantity += remaining;
      existing.averagePrice = totalCost / existing.quantity;
    } else {
      filtered.push({
        symbol: execution.symbol,
        side: openingSide,
        quantity: remaining,
        averagePrice: execution.price,
        openedDate: openingDate,
      });
    }
  }

  return { positions: filtered, realizedPnl };
}

function tradingDate(datetime: string): string {
  return datetime.slice(0, 10);
}

function hasCarriedPositions(positions: Position[], currentDate: string): boolean {
  return positions.some((position) => position.openedDate !== currentDate);
}

function totalQuantity(positions: Position[], symbol: string, side: Position["side"]): number {
  return positions.reduce((sum, position) => {
    if (position.symbol !== symbol || position.side !== side) return sum;
    return sum + position.quantity;
  }, 0);
}

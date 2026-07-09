import type { UTCTimestamp } from "lightweight-charts";

export type Side = "buy" | "sell";
export type TradeType = "cash" | "marginOpen" | "marginClose";
export type OrderType = "market" | "limit";
export type Timeframe = "1m" | "5m";
export type ThemeMode = "light" | "dark";
export type PositionProduct = "cash" | "margin";

export interface Bar {
  time: UTCTimestamp;
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SymbolData {
  id: string;
  fileName: string;
  bars: Bar[];
  warnings: string[];
  loadedAt: string;
}

export interface ParseResult {
  symbol: SymbolData;
}

export interface VirtualOrder {
  id: string;
  symbol: string;
  side: Side;
  tradeType: TradeType;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  requestedAt: string;
  replayIndex: number;
  status: "filled" | "rejected";
  message?: string;
}

export interface Execution {
  id: string;
  orderId: string;
  symbol: string;
  side: Side;
  tradeType: TradeType;
  quantity: number;
  price: number;
  time: string;
  realizedPnl: number;
  note: string;
}

export interface Position {
  id: string;
  product: PositionProduct;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  openedDate: string;
  openedAt: string;
}

export interface TradingState {
  initialCash: number;
  cash: number;
  realizedPnl: number;
  orders: VirtualOrder[];
  executions: Execution[];
  positions: Position[];
}

export interface PersistedSession {
  version: 1;
  selectedSymbolId?: string;
  replayIndex: number;
  speed: number;
  timeframe?: Timeframe;
  requestedDate?: string;
  themeMode?: ThemeMode;
  trading: TradingState;
  symbols: SymbolData[];
  savedAt: string;
}

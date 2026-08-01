import type { UTCTimestamp } from "lightweight-charts";

export type Side = "buy" | "sell";
export type TradeType = "cash" | "marginOpen" | "marginClose";
export type OrderType = "market" | "limit";
export type Timeframe = "1m" | "5m";
export type ThemeMode = "light" | "dark";
export type LanguageMode = "ja" | "en";
export type IndicatorMode = "ma" | "bb";
export type TickMode = "desktop" | "mobile";
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
  displayTime?: string;
  displayPrice?: number;
  displayAdjustment?: "matched-bar" | "clamped-to-bar";
}

export interface HistoricalTrade {
  id: string;
  symbolId?: string;
  ticker: string;
  companyName: string;
  exchange: string;
  orderNumber?: string;
  algoOrderNumber?: string;
  transaction: string;
  side: Side;
  tradeType: TradeType;
  product: PositionProduct;
  quantity: number;
  price: number;
  notional: number;
  time: string;
  date: string;
  orderType: string;
  status: string;
  realizedPnl?: number;
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
  tickMode?: TickMode;
  timeframe?: Timeframe;
  indicatorMode?: IndicatorMode;
  bollingerPeriod?: number;
  requestedDate?: string;
  themeMode?: ThemeMode;
  languageMode?: LanguageMode;
  historicalTrades?: HistoricalTrade[];
  showHistoricalTrades?: boolean;
  trading: TradingState;
  symbols: SymbolData[];
  savedAt: string;
}

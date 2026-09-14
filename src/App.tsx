import { type DragEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftToLine,
  BarChart3,
  Camera,
  CalendarDays,
  ClipboardList,
  FileUp,
  Languages,
  Menu,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Sun,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { ChartPanel } from "./components/ChartPanel";
import { findReplayBarIndex, filterBarsByDate, prepareBarsForTimeframe, resolveRequestedDate, sliceBarsToReplayPosition } from "./lib/bars";
import { buildSyntheticCsv, CsvParseError, parseCsvText } from "./lib/csv";
import { decodeTradeHistory, historicalTradeMatchesSymbol, parseTradeHistoryText, TradeHistoryParseError } from "./lib/tradeHistory";
import { formatPercent, formatPrice, formatVolume } from "./lib/format";
import {
  clampToTseTick,
  getIntrabarDisplayVolume,
  getIntrabarWalkIntervalMs,
  getReplayRemainingIntervalMs,
  getTimeframeDurationMs,
  moveToAdjacentTseTick,
  roundToTseTick,
} from "./lib/replay";
import { clearSession, loadSession, saveSession } from "./lib/storage";
import {
  evaluateCashMarketValue,
  evaluateMaintenanceRatio,
  evaluateMarginBuyingPower,
  evaluateMarginExposure,
  evaluateMarginUnrealizedPnl,
  evaluatePositionPnlSummary,
  evaluatePositionUnrealizedPnl,
  evaluateUnrealizedPnl,
  INITIAL_TRADING_STATE,
  normalizeTradingState,
  submitVirtualOrder,
  updateInitialCash,
} from "./lib/trading";
import type {
  Bar,
  HistoricalTrade,
  IndicatorMode,
  LanguageMode,
  PersistedSession,
  PositionProduct,
  Side,
  SymbolData,
  ThemeMode,
  TickMode,
  Timeframe,
  TradingState,
  TradeType,
} from "./types";
import "./styles.css";

const SPEEDS = [1, 5, 10, 30, 60];
const MA_PERIODS: [number, number, number] = [5, 25, 60];
const BOLLINGER_PERIOD_OPTIONS = [10, 20, 25, 50, 75];
const INITIAL_CASH_OPTIONS = [500_000, 1_000_000, 3_000_000, 5_000_000, 10_000_000];
const LOT_SIZE = 100;
const EMPTY_POSITION_PNL_SUMMARY = { buy: 0, sell: 0, total: 0 };
const ORDER_PANEL_WIDTH = 420;
const ORDER_PANEL_MAX_HEIGHT = 760;
const ORDER_PANEL_MARGIN = 12;
type OrderMode = "normal" | "ifdoco";
type IfdEntryTradeType = "cash" | "marginOpen";

const UI_TEXT = {
  ja: {
    initialMessage: "CSVを選択するか、架空サンプルを生成してください。",
    brandSubtitle: "ローカルCSV専用・サーバー送信なし・すべて仮想取引",
    languageToggle: "English",
    themeToDark: "ダーク",
    themeToLight: "ライト",
    csvTitle: "CSV読込",
    chooseCsv: "分足CSV",
    csvHint: "1分足 OHLCV / 複数選択可 / ドラッグ&ドロップ可",
    openSymbolDrawer: "銘柄メニューを開く",
    closeSymbolDrawer: "銘柄メニューを閉じる",
    closeDrawerBackdrop: "銘柄メニューの外側を閉じる",
    tradeHistoryTitle: "実約定履歴",
    showHistoricalTrades: "実約定を表示",
    hideHistoricalTrades: "実約定を非表示",
    chooseTradeHistory: "約定・取引履歴CSV",
    tradeHistoryHint: "stockorder / tradehistory対応・約定済みのみ表示 / Shift-JIS対応",
    noHistoricalTrades: "実約定履歴はありません。",
    historicalTradeCount: "実約定",
    excludedTradeCount: "除外",
    historicalTimeNote: "stockorderは注文時刻、tradehistoryは約定価格を含む最初の足へ表示",
    generateSample: "架空サンプルを生成",
    replayDate: "ジャンプ先の日付",
    symbolList: "銘柄一覧",
    noSymbols: "読み込み済みCSVはありません。",
    previousChange: "前日比",
    rows: "行",
    dataInfo: "データ情報",
    period: "期間",
    barType: "足種",
    displayDate: "表示日",
    storage: "保存",
    oneMinute: "1分",
    fiveMinutes: "5分",
    oneMinuteBars: "1分足",
    fiveMinuteBars: "5分足",
    csvNotSelected: "CSV未選択",
    loadCsvInBrowser: "CSVをブラウザ内で読み込んでください",
    dailyOpen: "当日始",
    dailyHigh: "当日高",
    dailyLow: "当日安",
    open: "始",
    high: "高",
    low: "安",
    close: "終",
    volume: "出来高",
    tick: "Tick",
    desktop: "PC",
    mobile: "スマホ",
    timeframe: "時間足",
    indicator: "指標",
    playbackPosition: "リプレイ位置",
    pause: "一時停止",
    play: "再生",
  first: "先頭へ",
  previous: "前へ",
  next: "次へ",
  last: "末尾へ",
    speed: "再生速度",
    save: "保存",
    restore: "復元",
    clear: "クリア",
    virtualOrder: "仮想注文",
    orderNotice: "トレーニング用の紙トレードです。実際の注文は発注されません。",
    openOrderPanel: "注文パネル",
    screenshot: "チャートをスクショ保存",
    currentPrice: "現在値",
    pendingIfdoco: "IFDOCO待機",
    pendingStop: "逆指値待機",
    accountSummary: "口座サマリー",
    initialCash: "初期資金",
    virtualCapital: "仮想資金",
    cashBalance: "現金残高",
    cashMarketValue: "現物評価額",
    longPositionPnl: "買い建玉損益",
    shortPositionPnl: "売り建玉損益",
    totalPositionPnl: "建玉損益合計",
    realizedPnl: "確定損益",
    totalPnl: "トータル損益",
    marginExposure: "信用建玉評価額",
    marginBuyingPower: "信用建余力",
    maintenanceRatio: "信用維持率",
    accountValue: "評価額",
    marginNote: "信用建余力は現金残高を保証金、委託保証金率30%として簡易計算します。手数料・金利は計算対象外です。",
    positions: "建玉",
    symbol: "銘柄",
    product: "種別",
    type: "区分",
    quantity: "数量",
    entryPrice: "建値",
    pnl: "損益",
    openedDate: "建日",
    noPositions: "建玉はありません。",
    cash: "現物",
    margin: "信用",
    executions: "約定履歴",
    time: "時刻",
    side: "売買",
    price: "価格",
    noExecutions: "履歴はありません。",
    buy: "買",
    sell: "売",
    orderDialogDescription: "通常注文とIFDOCOを紙トレードとして記録します。",
    closeDialog: "閉じる",
    orderMethod: "注文方式",
    normalOrder: "通常注文",
    tradeType: "取引区分",
    cashTrade: "現物",
    marginOpen: "信用新規",
    marginClose: "信用返済",
    market: "成行",
    limit: "指値",
    stop: "逆指値",
    limitPrice: "指値価格",
    triggerPrice: "トリガー価格",
    setCurrentPrice: "現在値",
    buyOrder: "買い注文",
    sellOrder: "売り注文",
    entryType: "新規区分",
    cashBuy: "現物買い",
    entryLimit: "新規指値",
    targetPrice: "利確価格",
    stopPrice: "損切価格",
    ifdocoNote: "新規が現在バーで約定した場合にOCO返済を登録します。同一バーでの返済判定は行いません。",
    buyIfdoco: "買いIFDOCO",
    sellIfdoco: "売りIFDOCO",
    footerData: "データソース: ユーザー選択CSVのみ",
    footerAdvice: "投資判断は提供しません",
    footerLimits: "約定・手数料・税金・信用規制を保証しません",
  },
  en: {
    initialMessage: "Choose a CSV file or generate a sample.",
    brandSubtitle: "Local CSV only · no server upload · paper trading only",
    languageToggle: "日本語",
    themeToDark: "Dark",
    themeToLight: "Light",
    csvTitle: "CSV Upload",
    chooseCsv: "Bar CSV",
    csvHint: "1-minute OHLCV / multiple files / drag & drop",
    openSymbolDrawer: "Open symbol menu",
    closeSymbolDrawer: "Close symbol menu",
    closeDrawerBackdrop: "Close symbol menu backdrop",
    tradeHistoryTitle: "Historical fills",
    showHistoricalTrades: "Show historical fills",
    hideHistoricalTrades: "Hide historical fills",
    chooseTradeHistory: "Orders / trades CSV",
    tradeHistoryHint: "Supports stockorder and tradehistory / confirmed fills only / Shift-JIS supported",
    noHistoricalTrades: "No historical fills.",
    historicalTradeCount: "fills",
    excludedTradeCount: "excluded",
    historicalTimeNote: "stockorder uses order time; tradehistory uses the first bar containing the fill price",
    generateSample: "Generate sample",
    replayDate: "Jump to date",
    symbolList: "Symbols",
    noSymbols: "No CSV files loaded.",
    previousChange: "Change",
    rows: "rows",
    dataInfo: "Data",
    period: "Period",
    barType: "Bar type",
    displayDate: "Display date",
    storage: "Storage",
    oneMinute: "1m",
    fiveMinutes: "5m",
    oneMinuteBars: "1-minute bars",
    fiveMinuteBars: "5-minute bars",
    csvNotSelected: "No CSV selected",
    loadCsvInBrowser: "Load a CSV file in your browser",
    dailyOpen: "Open",
    dailyHigh: "High",
    dailyLow: "Low",
    open: "O",
    high: "H",
    low: "L",
    close: "C",
    volume: "Volume",
    tick: "Tick",
    desktop: "Desktop",
    mobile: "Mobile",
    timeframe: "Timeframe",
    indicator: "Indicator",
    playbackPosition: "Replay position",
    pause: "Pause",
    play: "Play",
  first: "First",
  previous: "Previous",
  next: "Next",
  last: "Last",
    speed: "Replay speed",
    save: "Save",
    restore: "Restore",
    clear: "Clear",
    virtualOrder: "Paper Order",
    orderNotice: "Paper trading for training. No real orders are sent.",
    openOrderPanel: "Order panel",
    screenshot: "Save chart screenshot",
    currentPrice: "Current",
    pendingIfdoco: "IFDOCO pending",
    pendingStop: "Stop pending",
    accountSummary: "Account Summary",
    initialCash: "Initial cash",
    virtualCapital: "Virtual capital",
    cashBalance: "Cash balance",
    cashMarketValue: "Cash market value",
    longPositionPnl: "Long position P/L",
    shortPositionPnl: "Short position P/L",
    totalPositionPnl: "Position P/L total",
    realizedPnl: "Realized P/L",
    totalPnl: "Total P/L",
    marginExposure: "Margin exposure",
    marginBuyingPower: "Margin buying power",
    maintenanceRatio: "Maintenance ratio",
    accountValue: "Account value",
    marginNote: "Margin buying power is estimated from cash balance as collateral with a 30% margin requirement. Fees and interest are excluded.",
    positions: "Positions",
    symbol: "Symbol",
    product: "Product",
    type: "Type",
    quantity: "Qty",
    entryPrice: "Entry",
    pnl: "P/L",
    openedDate: "Opened",
    noPositions: "No positions.",
    cash: "Cash",
    margin: "Margin",
    executions: "Executions",
    time: "Time",
    side: "Side",
    price: "Price",
    noExecutions: "No executions.",
    buy: "Buy",
    sell: "Sell",
    orderDialogDescription: "Record normal and IFDOCO orders as paper trades.",
    closeDialog: "Close",
    orderMethod: "Order method",
    normalOrder: "Normal",
    tradeType: "Trade type",
    cashTrade: "Cash",
    marginOpen: "Margin open",
    marginClose: "Margin close",
    market: "Market",
    limit: "Limit",
    stop: "Stop",
    limitPrice: "Limit price",
    triggerPrice: "Trigger price",
    setCurrentPrice: "Current",
    buyOrder: "Buy order",
    sellOrder: "Sell order",
    entryType: "Entry type",
    cashBuy: "Cash buy",
    entryLimit: "Entry limit",
    targetPrice: "Take profit",
    stopPrice: "Stop loss",
    ifdocoNote: "If the entry fills in the current bar, OCO exit conditions are registered. Exit checks do not run in the same bar.",
    buyIfdoco: "Buy IFDOCO",
    sellIfdoco: "Sell IFDOCO",
    footerData: "Data source: user-selected CSV only",
    footerAdvice: "No investment decisions are provided",
    footerLimits: "Executions, fees, taxes, and margin rules are not guaranteed",
  },
} as const satisfies Record<LanguageMode, Record<string, string>>;

interface IntrabarWalkState {
  time: Bar["time"];
  close: number;
  high: number;
  low: number;
  volume: number;
  elapsedMs: number;
  startedAtMs: number;
}

interface DailyMarketStats {
  open: number;
  high: number;
  low: number;
  change: number | null;
  changePercent: number | null;
}

interface SymbolOpenChange {
  change: number | null;
  changePercent: number | null;
}

interface PendingOcoOrder {
  id: string;
  symbol: string;
  closeSide: Side;
  closeTradeType: "cash" | "marginClose";
  quantity: number;
  targetPrice: number;
  stopPrice: number;
  activateAtTime: number;
}

interface PendingEntryOrder {
  id: string;
  symbol: string;
  side: Side;
  tradeType: "cash" | "marginOpen";
  quantity: number;
  stopPrice: number;
  activateAtTime: number;
}

interface FloatingPanelPosition {
  x: number;
  y: number;
}

interface DragPanelState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

function App() {
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>();
  const [requestedDate, setRequestedDate] = useState("");
  const [tickMode, setTickMode] = useState<TickMode>("mobile");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [indicatorMode, setIndicatorMode] = useState<IndicatorMode>("ma");
  const [bollingerPeriod, setBollingerPeriod] = useState(25);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [languageMode, setLanguageMode] = useState<LanguageMode>("ja");
  const [replayIndex, setReplayIndex] = useState(0);
  const [chartAnchorIndex, setChartAnchorIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [trading, setTrading] = useState<TradingState>(INITIAL_TRADING_STATE);
  const [historicalTrades, setHistoricalTrades] = useState<HistoricalTrade[]>([]);
  const [showHistoricalTrades, setShowHistoricalTrades] = useState(true);
  const [parseMessage, setParseMessage] = useState<string>(UI_TEXT.ja.initialMessage);
  const [tradeType, setTradeType] = useState<TradeType>("marginOpen");
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [quantity, setQuantity] = useState(100);
  const [limitPrice, setLimitPrice] = useState("");
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [orderPanelPosition, setOrderPanelPosition] = useState<FloatingPanelPosition | null>(null);
  const [orderMode, setOrderMode] = useState<OrderMode>("normal");
  const [ifdTradeType, setIfdTradeType] = useState<IfdEntryTradeType>("marginOpen");
  const [ifdOrderType, setIfdOrderType] = useState<"market" | "limit">("market");
  const [ifdQuantity, setIfdQuantity] = useState(100);
  const [ifdLimitPrice, setIfdLimitPrice] = useState("");
  const [ifdTargetPrice, setIfdTargetPrice] = useState("");
  const [ifdStopPrice, setIfdStopPrice] = useState("");
  const [ifdTargetPriceSynced, setIfdTargetPriceSynced] = useState(true);
  const [ifdStopPriceSynced, setIfdStopPriceSynced] = useState(true);
  const [pendingOcoOrders, setPendingOcoOrders] = useState<PendingOcoOrder[]>([]);
  const [pendingEntryOrders, setPendingEntryOrders] = useState<PendingEntryOrder[]>([]);
  const [walkState, setWalkState] = useState<IntrabarWalkState | null>(null);
  const [isCsvDragging, setIsCsvDragging] = useState(false);
  const [isTradeHistoryDragging, setIsTradeHistoryDragging] = useState(false);
  const [isSymbolDrawerOpen, setIsSymbolDrawerOpen] = useState(false);
  const chartScreenshotRef = useRef<(() => Promise<void>) | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tradeHistoryInputRef = useRef<HTMLInputElement | null>(null);
  const orderOpenButtonRef = useRef<HTMLButtonElement | null>(null);
  const orderPanelDragRef = useRef<DragPanelState | null>(null);
  const orderPanelDragCleanupRef = useRef<(() => void) | null>(null);
  const ui = UI_TEXT[languageMode];
  const locale = languageMode === "ja" ? "ja-JP" : "en-US";
  const registerChartScreenshot = useCallback((handler: (() => Promise<void>) | null) => {
    chartScreenshotRef.current = handler;
  }, []);

  const selectedSymbol = symbols.find((symbol) => symbol.id === selectedSymbolId);
  const resolvedDate = useMemo(
    () => resolveRequestedDate(selectedSymbol?.bars ?? [], requestedDate),
    [requestedDate, selectedSymbol?.bars],
  );
  const timeframeBars = useMemo(
    () => prepareBarsForTimeframe(selectedSymbol?.bars ?? [], timeframe),
    [selectedSymbol?.bars, timeframe],
  );
  const bars = timeframeBars;
  const jumpIndex = useMemo(
    () => Math.max(0, bars.findIndex((bar) => bar.datetime.startsWith(resolvedDate.activeDate ?? "invalid"))),
    [bars, resolvedDate.activeDate],
  );
  const currentIndex = bars.length === 0 ? 0 : Math.min(replayIndex, bars.length - 1);
  const currentBar = bars[currentIndex];
  const displayCurrentBar = currentBar ? resolveDisplayCurrentBar(currentBar, walkState, playing) : currentBar;
  const displayDatetime = currentBar ? resolveDisplayDatetime(currentBar, walkState, playing) : undefined;
  const visibleBars = useMemo(
    () => sliceBarsToReplayPosition(bars, currentIndex, displayCurrentBar),
    [bars, currentIndex, displayCurrentBar],
  );
  const dailyMarketStats = useMemo(() => {
    const date = currentBar?.datetime.slice(0, 10);
    const dayBars = filterBarsByDate(bars, date);
    const dayIndex = dayBars.findIndex((bar) => bar.time === currentBar?.time);
    return calculateDailyMarketStats(dayBars, dayIndex, displayCurrentBar, bars, date);
  }, [bars, currentBar, displayCurrentBar]);
  const valuationPrice = displayCurrentBar?.close;
  const unrealizedPnl = valuationPrice == null ? 0 : evaluateUnrealizedPnl(trading.positions, valuationPrice);
  const positionPnlSummary =
    valuationPrice == null ? EMPTY_POSITION_PNL_SUMMARY : evaluatePositionPnlSummary(trading.positions, valuationPrice);
  const marginUnrealizedPnl = valuationPrice == null ? 0 : evaluateMarginUnrealizedPnl(trading.positions, valuationPrice);
  const cashMarketValue = valuationPrice == null ? 0 : evaluateCashMarketValue(trading.positions, valuationPrice);
  const marginExposure = valuationPrice == null ? 0 : evaluateMarginExposure(trading.positions, valuationPrice);
  const accountValue = trading.cash + cashMarketValue + marginUnrealizedPnl;
  const totalPnl = trading.realizedPnl + unrealizedPnl;
  const maintenanceRatio = evaluateMaintenanceRatio(accountValue, marginExposure);
  const marginBuyingPower = evaluateMarginBuyingPower(trading.cash, marginExposure);
  const chartViewportKey = `${selectedSymbolId ?? "none"}:${resolvedDate.activeDate ?? "none"}:${timeframe}:${indicatorMode}:${bollingerPeriod}`;

  const selectedHistoricalSymbol = useMemo(
    () => symbols.find((symbol) => symbol.id === selectedSymbolId),
    [selectedSymbolId, symbols],
  );
  const visibleHistoricalTrades = useMemo(() => {
    if (!showHistoricalTrades || !selectedHistoricalSymbol) return [];
    const sourceBars = selectedHistoricalSymbol.bars;
    const start = sourceBars[0]?.time;
    const end = sourceBars.at(-1)?.time;
    if (start == null || end == null) return [];
    const dates = new Set(sourceBars.map((bar) => bar.datetime.slice(0, 10)));
    return historicalTrades.filter((trade) => {
      const timestamp = historicalTradeTimestamp(trade);
      return historicalTradeMatchesSymbol(trade, selectedHistoricalSymbol)
        && dates.has(trade.date) && timestamp >= start && timestamp < Number(end) + 60;
    });
  }, [historicalTrades, selectedHistoricalSymbol, showHistoricalTrades]);

  useEffect(() => {
    if (!currentBar) return;
    const triggeredMessages: string[] = [];
    setPendingEntryOrders((current) => {
      const remaining: PendingEntryOrder[] = [];
      for (const order of current) {
        if (order.symbol !== selectedSymbolId || Number(currentBar.time) < order.activateAtTime) {
          remaining.push(order);
          continue;
        }

        const triggered = order.side === "buy" ? currentBar.high >= order.stopPrice : currentBar.low <= order.stopPrice;
        if (!triggered) {
          remaining.push(order);
          continue;
        }

        setTrading((currentTrading) =>
          submitVirtualOrder(currentTrading, {
            symbol: order.symbol,
            side: order.side,
            tradeType: order.tradeType,
            orderType: "market",
            quantity: order.quantity,
            bar: currentBar,
            replayIndex: currentIndex,
          }),
        );
        triggeredMessages.push(
          languageMode === "ja"
            ? `逆指値エントリーがトリガーされました: ${formatPrice(currentBar.close)}`
            : `Stop entry triggered at ${formatPrice(currentBar.close)}`,
        );
      }
      return remaining;
    });
    if (triggeredMessages.length > 0) {
      setParseMessage(triggeredMessages.join("\n"));
    }
  }, [currentBar, currentIndex, languageMode, selectedSymbolId]);

  useEffect(() => {
    if (!playing || !currentBar || bars.length === 0) {
      setWalkState(null);
      return;
    }

    setWalkState((value) => nextWalkState(value, currentBar, timeframe, speed));
    const elapsedAtSchedule = walkState?.time === currentBar.time ? walkState.elapsedMs : 0;
    const nextAdvanceDelayMs = getReplayRemainingIntervalMs(timeframe, speed, elapsedAtSchedule);
    const walkVolume = currentIndex === 0 ? bars[1]?.volume ?? currentBar.volume : currentBar.volume;
    const walkIntervalMs = getIntrabarWalkIntervalMs(
      timeframe,
      speed,
      walkVolume,
      bars.map((bar) => bar.volume),
      tickMode,
    );
    const walkTimer = window.setInterval(() => {
      setWalkState((value) => nextWalkState(value, currentBar, timeframe, speed));
    }, walkIntervalMs);
    const advanceTimer = window.setTimeout(() => {
      setReplayIndex((value) => {
        if (value >= bars.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, nextAdvanceDelayMs);

    return () => {
      window.clearInterval(walkTimer);
      window.clearTimeout(advanceTimer);
    };
  }, [bars, bars.length, currentBar, currentIndex, playing, speed, tickMode, timeframe]);

  useEffect(() => {
    if (orderMode !== "ifdoco" || !displayCurrentBar) return;
    const currentPrice = formatOrderPriceInput(displayCurrentBar.close);
    if (ifdTargetPriceSynced) {
      setIfdTargetPrice(currentPrice);
    }
    if (ifdStopPriceSynced) {
      setIfdStopPrice(currentPrice);
    }
  }, [displayCurrentBar?.close, ifdStopPriceSynced, ifdTargetPriceSynced, orderMode]);

  useEffect(() => {
    return () => {
      orderPanelDragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!currentBar) return;
    const triggeredMessages: string[] = [];
    setPendingOcoOrders((current) => {
      const remaining: PendingOcoOrder[] = [];
      for (const order of current) {
        if (order.symbol !== selectedSymbolId || Number(currentBar.time) < order.activateAtTime) {
          remaining.push(order);
          continue;
        }

        const targetHit = order.closeSide === "sell" ? currentBar.high >= order.targetPrice : currentBar.low <= order.targetPrice;
        const stopHit = order.closeSide === "sell" ? currentBar.low <= order.stopPrice : currentBar.high >= order.stopPrice;
        const triggerPrice = stopHit ? order.stopPrice : targetHit ? order.targetPrice : null;
        if (triggerPrice == null) {
          remaining.push(order);
          continue;
        }

        setTrading((currentTrading) =>
          submitVirtualOrder(currentTrading, {
            symbol: order.symbol,
            side: order.closeSide,
            tradeType: order.closeTradeType,
            orderType: "limit",
            quantity: order.quantity,
            limitPrice: triggerPrice,
            bar: currentBar,
            replayIndex: currentIndex,
          }),
        );
        triggeredMessages.push(
          languageMode === "ja"
            ? `IFDOCOのOCO返済を約定しました: ${formatPrice(triggerPrice)}`
            : `IFDOCO OCO exit filled: ${formatPrice(triggerPrice)}`,
        );
      }
      return remaining;
    });
    if (triggeredMessages.length > 0) {
      setParseMessage(triggeredMessages.join("\n"));
    }
  }, [currentBar, currentIndex, languageMode, selectedSymbolId]);

  useEffect(() => {
    if (bars.length > 0 && replayIndex > bars.length - 1) {
      setReplayIndex(bars.length - 1);
    }
  }, [bars.length, replayIndex]);

  useEffect(() => {
    setPlaying(false);
    if (resolvedDate.activeDate) {
      setReplayIndex(jumpIndex);
      setChartAnchorIndex(jumpIndex);
    }
    setWalkState(null);
  }, [selectedSymbolId, resolvedDate.activeDate]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const loaded: SymbolData[] = [];
    const messages: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const result = parseCsvText(text, file.name);
        loaded.push(result.symbol);
        messages.push(
          languageMode === "ja"
            ? `${file.name}: ${result.symbol.bars.length.toLocaleString(locale)} 本を読み込みました。`
            : `${file.name}: loaded ${result.symbol.bars.length.toLocaleString(locale)} bars.`,
        );
      } catch (error) {
        const message =
          error instanceof CsvParseError
            ? translateCsvParseMessage(error.message, languageMode)
            : languageMode === "ja"
              ? "CSVの読み込みに失敗しました。"
              : "Failed to load CSV.";
        messages.push(`${file.name}: ${message}`);
      }
    }

    if (loaded.length > 0) {
      const mergedSymbols = mergeSymbols(symbols, loaded);
      setSymbols(mergedSymbols);
      const refreshedSymbolId = mergedSymbols.find((symbol) => loaded.some((item) => item.fileName === symbol.fileName))?.id;
      setSelectedSymbolId((current) => {
        if (current && mergedSymbols.some((symbol) => symbol.id === current)) return current;
        return refreshedSymbolId ?? current ?? loaded[0]?.id;
      });
      setRequestedDate("");
      setReplayIndex(0);
      setPlaying(false);
    }

    setParseMessage(messages.join("\n"));
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleTradeHistoryFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const messages: string[] = [];
    const loaded: HistoricalTrade[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = decodeTradeHistory(await file.arrayBuffer());
        const result = parseTradeHistoryText(text, file.name);
        loaded.push(...result.trades);
        messages.push(
          languageMode === "ja"
            ? `${file.name}: ${result.trades.length.toLocaleString(locale)}件の約定を読み込み、${result.excludedRows.toLocaleString(locale)}件を除外しました。`
            : `${file.name}: loaded ${result.trades.length.toLocaleString(locale)} fills and excluded ${result.excludedRows.toLocaleString(locale)} rows.`,
        );
        if (result.warnings.length > 0) messages.push(...result.warnings);
      } catch (error) {
        const message =
          error instanceof TradeHistoryParseError
            ? error.message
            : languageMode === "ja"
              ? "取引履歴CSVの読み込みに失敗しました。"
              : "Failed to load trade history CSV.";
        messages.push(`${file.name}: ${message}`);
      }
    }

    if (loaded.length > 0) {
      setHistoricalTrades((current) => mergeHistoricalTrades(current, loaded));
    }
    setParseMessage(messages.join("\n"));
    if (tradeHistoryInputRef.current) tradeHistoryInputRef.current.value = "";
  }

  function handleTradeHistoryDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsTradeHistoryDragging(true);
  }

  function handleTradeHistoryDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsTradeHistoryDragging(false);
    void handleTradeHistoryFiles(event.dataTransfer.files);
  }

  function handleCsvDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsCsvDragging(true);
  }

  function handleCsvDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsCsvDragging(false);
    void handleFiles(event.dataTransfer.files);
  }

  function addSyntheticSample() {
    const result = parseCsvText(buildSyntheticCsv(), "DEMO_半導体風_1m.csv");
    setSymbols((current) => mergeSymbols(current, [result.symbol]));
    setSelectedSymbolId(result.symbol.id);
    setRequestedDate("");
    setReplayIndex(0);
    setPlaying(false);
    setParseMessage(
      languageMode === "ja"
        ? "半導体株風の架空サンプルを生成しました。実在相場データではありません。"
        : "Generated a synthetic semiconductor-style sample. This is not real market data.",
    );
  }

  async function persistSession() {
    const session: PersistedSession = {
      version: 1,
      selectedSymbolId,
      replayIndex: currentIndex,
      speed,
      tickMode,
      timeframe,
      indicatorMode,
      bollingerPeriod,
      requestedDate,
      themeMode,
      languageMode,
      historicalTrades,
      showHistoricalTrades,
      trading,
      symbols,
      savedAt: new Date().toISOString(),
    };
    await saveSession(session);
    setParseMessage(
      languageMode === "ja"
        ? "IndexedDBにローカル保存しました。外部送信はしていません。"
        : "Saved locally to IndexedDB. Nothing was sent externally.",
    );
  }

  async function restoreSession() {
    const session = await loadSession();
    if (!session) {
      setParseMessage(languageMode === "ja" ? "保存済みセッションがありません。" : "No saved session found.");
      return;
    }
    setSymbols(session.symbols);
    setSelectedSymbolId(session.selectedSymbolId ?? session.symbols[0]?.id);
    setReplayIndex(session.replayIndex);
    setSpeed(session.speed);
    setTickMode(session.tickMode ?? "mobile");
    setTimeframe(session.timeframe ?? "1m");
    setIndicatorMode(session.indicatorMode ?? "ma");
    setBollingerPeriod(session.bollingerPeriod ?? 25);
    setRequestedDate(session.requestedDate ?? "");
    setThemeMode(session.themeMode ?? "dark");
    const restoredLanguageMode = session.languageMode ?? "ja";
    setLanguageMode(restoredLanguageMode);
    setHistoricalTrades(session.historicalTrades ?? []);
    setShowHistoricalTrades(session.showHistoricalTrades ?? true);
    setTrading(normalizeTradingState(session.trading));
    setPlaying(false);
    setParseMessage(
      restoredLanguageMode === "ja"
        ? `セッションを復元しました: ${new Date(session.savedAt).toLocaleString("ja-JP")}`
        : `Session restored: ${new Date(session.savedAt).toLocaleString("en-US")}`,
    );
  }

  async function resetAll() {
    setPlaying(false);
    setReplayIndex(0);
    setTrading({ ...INITIAL_TRADING_STATE, orders: [], executions: [], positions: [] });
    setHistoricalTrades([]);
    await clearSession();
    setParseMessage(
      languageMode === "ja"
        ? "仮想取引と保存セッションをクリアしました。読み込み済みCSVは画面上に残しています。"
        : "Cleared paper trades and the saved session. Loaded CSV data remains on screen.",
    );
  }

  function setPriceToCurrent(setter: (value: string) => void) {
    if (!displayCurrentBar) return;
    setter(formatOrderPriceInput(displayCurrentBar.close));
  }

  function movePriceByTick(value: string, setter: (value: string) => void, direction: 1 | -1) {
    const parsed = parseOrderPrice(value);
    const reference = Number.isFinite(parsed) ? parsed : displayCurrentBar?.close;
    if (reference == null || !Number.isFinite(reference) || reference <= 0) return;
    const current = roundToTseTick(reference);
    const next = moveToAdjacentTseTick(current, direction, 0, Number.MAX_SAFE_INTEGER);
    setter(formatOrderPriceInput(next));
  }

  function changeTimeframe(nextTimeframe: Timeframe) {
    if (nextTimeframe === timeframe) return;

    const nextBars = prepareBarsForTimeframe(selectedSymbol?.bars ?? [], nextTimeframe);
    const currentElapsedMs = currentBar && walkState?.time === currentBar.time ? walkState.elapsedMs : 0;
    const replayTimestamp = currentBar ? Number(currentBar.time) + currentElapsedMs / 1_000 : 0;
    const nextIndex = findReplayBarIndex(nextBars, replayTimestamp);
    const nextBar = nextBars[nextIndex];

    setTimeframe(nextTimeframe);
    setReplayIndex(nextIndex);
    setChartAnchorIndex(nextIndex);

    if (!playing || !nextBar) {
      setWalkState(null);
      return;
    }

    const elapsedMs = clamp(
      (replayTimestamp - Number(nextBar.time)) * 1_000,
      0,
      Math.max(0, getTimeframeDurationMs(nextTimeframe) - 1_000),
    );
    const close = clampToTseTick(displayCurrentBar?.close ?? nextBar.open, nextBar.low, nextBar.high);
    const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
    setWalkState({
      time: nextBar.time,
      close,
      high: Math.max(nextBar.open, close),
      low: Math.min(nextBar.open, close),
      volume: getIntrabarDisplayVolume(nextBar.volume, elapsedMs, nextTimeframe),
      elapsedMs,
      startedAtMs: Date.now() - elapsedMs / normalizedSpeed,
    });
  }

  function placeOrder(orderSide: Side) {
    if (!selectedSymbol || !currentBar) {
      setParseMessage(
        languageMode === "ja"
          ? "注文前にCSVを読み込んでリプレイ位置を選択してください。"
          : "Load a CSV file and select a replay position before ordering.",
      );
      return;
    }

    const normalizedQuantity = normalizeLotQuantity(quantity);
    setQuantity(normalizedQuantity);

    if (orderType === "stop") {
      if (tradeType === "marginClose" || (tradeType === "cash" && orderSide === "sell")) {
        setParseMessage(
          languageMode === "ja"
            ? "逆指値エントリーは現物買いまたは信用新規で指定してください。"
            : "Stop entries support cash buys and margin opens only.",
        );
        return;
      }
      const stopPrice = parseOrderPrice(limitPrice);
      const currentPrice = displayCurrentBar?.close;
      if (stopPrice == null || currentPrice == null) {
        setParseMessage(languageMode === "ja" ? "逆指値のトリガー価格を確認してください。" : "Check the stop trigger price.");
        return;
      }
      const directionIsValid = orderSide === "buy" ? stopPrice > currentPrice : stopPrice < currentPrice;
      if (!directionIsValid) {
        setParseMessage(
          languageMode === "ja"
            ? "買い逆指値は現在値より高く、売り逆指値は現在値より安く指定してください。"
            : "Buy stops must be above the current price; sell stops must be below it.",
        );
        return;
      }
      setPendingEntryOrders((current) => [
        {
          id: crypto.randomUUID(),
          symbol: selectedSymbol.id,
          side: orderSide,
          tradeType: tradeType as "cash" | "marginOpen",
          quantity: normalizedQuantity,
          stopPrice,
          activateAtTime: Number(currentBar.time) + getTimeframeDurationMs(timeframe) / 1_000,
        },
        ...current,
      ]);
      setParseMessage(
        languageMode === "ja"
          ? `逆指値エントリーを待機しました: ${formatPrice(stopPrice)}`
          : `Stop entry is pending at ${formatPrice(stopPrice)}`,
      );
      return;
    }

    setTrading((current) => {
      const next = submitVirtualOrder(current, {
        symbol: selectedSymbol.id,
        side: orderSide,
        tradeType,
        orderType,
        quantity: normalizedQuantity,
        limitPrice: orderType === "limit" ? parseOrderPrice(limitPrice) : undefined,
        bar: {
          ...displayCurrentBar,
          datetime: displayDatetime ?? displayCurrentBar.datetime,
        },
        replayIndex: currentIndex,
      });
      const latestOrder = next.orders[0];
      if (latestOrder?.status === "rejected") {
        setParseMessage(
          languageMode === "ja"
            ? `注文を拒否しました: ${latestOrder.message ?? "条件を確認してください。"}`
            : `Order rejected: ${translateOrderMessage(latestOrder.message, languageMode)}`,
        );
      } else {
        setParseMessage(languageMode === "ja" ? "仮想注文を約定しました。実注文ではありません。" : "Paper order filled. This is not a real order.");
      }
      return next;
    });
  }

  function placeIfdOco(entrySide: Side) {
    if (!selectedSymbol || !currentBar) {
      setParseMessage(
        languageMode === "ja"
          ? "注文前にCSVを読み込んでリプレイ位置を選択してください。"
          : "Load a CSV file and select a replay position before ordering.",
      );
      return;
    }
    if (ifdTradeType === "cash" && entrySide === "sell") {
      setParseMessage(languageMode === "ja" ? "現物のIFDOCOは買い新規のみ対応しています。" : "Cash IFDOCO supports buy entries only.");
      return;
    }

    const normalizedQuantity = normalizeLotQuantity(ifdQuantity);
    const activeBar = displayCurrentBar ?? currentBar;
    const entryReferencePrice = ifdOrderType === "limit" ? parseOrderPrice(ifdLimitPrice) : activeBar.close;
    const targetPrice = parseOrderPrice(ifdTargetPrice);
    const stopPrice = parseOrderPrice(ifdStopPrice);
    setIfdQuantity(normalizedQuantity);

    if (![entryReferencePrice, targetPrice, stopPrice].every(Number.isFinite)) {
      setParseMessage(
        languageMode === "ja"
          ? "IFDOCOの新規価格、利確価格、損切価格を確認してください。"
          : "Check the IFDOCO entry, take-profit, and stop-loss prices.",
      );
      return;
    }
    if (entrySide === "buy" && !(targetPrice > entryReferencePrice && stopPrice < entryReferencePrice)) {
      setParseMessage(
        languageMode === "ja"
          ? "買いIFDOCOは利確価格を新規価格より上、損切価格を新規価格より下にしてください。"
          : "For a buy IFDOCO, set take profit above the entry and stop loss below it.",
      );
      return;
    }
    if (entrySide === "sell" && !(targetPrice < entryReferencePrice && stopPrice > entryReferencePrice)) {
      setParseMessage(
        languageMode === "ja"
          ? "売りIFDOCOは利確価格を新規価格より下、損切価格を新規価格より上にしてください。"
          : "For a sell IFDOCO, set take profit below the entry and stop loss above it.",
      );
      return;
    }

    const next = submitVirtualOrder(trading, {
      symbol: selectedSymbol.id,
      side: entrySide,
      tradeType: ifdTradeType,
      orderType: ifdOrderType,
      quantity: normalizedQuantity,
      limitPrice: ifdOrderType === "limit" ? entryReferencePrice : undefined,
      bar: {
        ...activeBar,
        datetime: displayDatetime ?? activeBar.datetime,
      },
      replayIndex: currentIndex,
    });
    setTrading(next);

    const latestOrder = next.orders[0];
    const latestExecution = next.executions[0];
    if (latestOrder?.status === "rejected" || latestExecution == null) {
      setParseMessage(
        languageMode === "ja"
          ? `IFDOCO新規注文を拒否しました: ${latestOrder?.message ?? "条件を確認してください。"}`
          : `IFDOCO entry rejected: ${translateOrderMessage(latestOrder?.message, languageMode)}`,
      );
      return;
    }

    const closeSide: Side = entrySide === "buy" ? "sell" : "buy";
    const closeTradeType: PendingOcoOrder["closeTradeType"] = ifdTradeType === "cash" ? "cash" : "marginClose";
    setPendingOcoOrders((currentOco) => [
      {
        id: crypto.randomUUID(),
        symbol: selectedSymbol.id,
        closeSide,
        closeTradeType,
        quantity: normalizedQuantity,
        targetPrice,
        stopPrice,
        activateAtTime: Number(currentBar.time) + getTimeframeDurationMs(timeframe) / 1_000,
      },
      ...currentOco,
    ]);
    setParseMessage(
      languageMode === "ja"
        ? "IFDOCO新規注文が約定し、OCO返済条件を登録しました。実注文ではありません。"
        : "IFDOCO entry filled and OCO exit conditions were registered. This is not a real order.",
    );
  }

  function openOrderPanel() {
    setOrderPanelPosition(calculateOrderPanelPosition(orderOpenButtonRef.current));
    setIsOrderModalOpen(true);
  }

  function startOrderPanelDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.closest<HTMLElement>(".order-modal");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    orderPanelDragRef.current = dragState;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== dragState.pointerId) return;
      setOrderPanelPosition(
        clampOrderPanelPosition({
          x: moveEvent.clientX - dragState.offsetX,
          y: moveEvent.clientY - dragState.offsetY,
        }),
      );
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      orderPanelDragRef.current = null;
      orderPanelDragCleanupRef.current = null;
    };
    const handlePointerEnd = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== dragState.pointerId) return;
      cleanup();
    };

    orderPanelDragCleanupRef.current?.();
    orderPanelDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    event.preventDefault();
  }

  return (
    <main className="app-shell" data-theme={themeMode}>
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">
            <BarChart3 size={20} />
          </span>
          <div>
            <h1>Replay Trader</h1>
            <p>{ui.brandSubtitle}</p>
          </div>
        </div>
        <div className="top-actions">
          <button
            className={`header-file-button bars-upload-button ${isCsvDragging ? "dragging" : ""}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={handleCsvDragOver}
            onDragOver={handleCsvDragOver}
            onDragLeave={() => setIsCsvDragging(false)}
            onDrop={handleCsvDrop}
            title={ui.csvHint}
          >
            <FileUp size={15} />
            {ui.chooseCsv}
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => void handleFiles(event.currentTarget.files)}
          />
          <button
            className={`header-file-button trade-history-upload-button ${isTradeHistoryDragging ? "dragging" : ""}`}
            type="button"
            onClick={() => tradeHistoryInputRef.current?.click()}
            onDragEnter={handleTradeHistoryDragOver}
            onDragOver={handleTradeHistoryDragOver}
            onDragLeave={() => setIsTradeHistoryDragging(false)}
            onDrop={handleTradeHistoryDrop}
            title={ui.tradeHistoryHint}
          >
            <ClipboardList size={15} />
            {ui.chooseTradeHistory}
          </button>
          <input
            ref={tradeHistoryInputRef}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => void handleTradeHistoryFiles(event.currentTarget.files)}
          />
          <button
            className="icon-button history-visibility-button"
            type="button"
            aria-label={showHistoricalTrades ? ui.hideHistoricalTrades : ui.showHistoricalTrades}
            title={showHistoricalTrades ? ui.hideHistoricalTrades : ui.showHistoricalTrades}
            onClick={() => setShowHistoricalTrades((value) => !value)}
          >
            {showHistoricalTrades ? <Eye size={17} /> : <EyeOff size={17} />}
          </button>
          <button ref={orderOpenButtonRef} className="primary-button header-order-button" type="button" onClick={openOrderPanel}>
            <ClipboardList size={15} />
            {ui.openOrderPanel}
          </button>
          <button
            className="icon-button screenshot-button"
            type="button"
            aria-label={ui.screenshot}
            title={ui.screenshot}
            disabled={visibleBars.length === 0}
            onClick={() => {
              const captureScreenshot = chartScreenshotRef.current;
              if (!captureScreenshot) {
                console.error("Screenshot handler is not ready");
                return;
              }
              void captureScreenshot();
            }}
          >
            <Camera size={17} />
          </button>
          <button
            className="icon-button drawer-toggle"
            type="button"
            aria-label={ui.openSymbolDrawer}
            title={ui.openSymbolDrawer}
            onClick={() => setIsSymbolDrawerOpen(true)}
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {isSymbolDrawerOpen ? (
        <>
          <button
            className="drawer-backdrop"
            type="button"
            aria-label={ui.closeDrawerBackdrop}
            onClick={() => setIsSymbolDrawerOpen(false)}
          />
          <aside className="symbol-drawer panel" aria-label={ui.symbolList}>
            <div className="symbol-drawer-header">
              <h2>{ui.symbolList}</h2>
              <button
                className="icon-button"
                type="button"
                aria-label={ui.closeSymbolDrawer}
                title={ui.closeSymbolDrawer}
                onClick={() => setIsSymbolDrawerOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="symbol-list">
              {symbols.length === 0 ? <p className="empty-text">{ui.noSymbols}</p> : null}
              {symbols.map((symbol) => {
                const openChange = calculateSymbolOpenChange(symbol, requestedDate);
                return (
                  <button
                    className={`symbol-row ${symbol.id === selectedSymbolId ? "selected" : ""}`}
                    key={symbol.id}
                    type="button"
                    onClick={() => {
                      setSelectedSymbolId(symbol.id);
                      setReplayIndex(0);
                      setPlaying(false);
                      setIsSymbolDrawerOpen(false);
                    }}
                  >
                    <span>
                      <strong>{symbol.id}</strong>
                      <small>{symbol.fileName}</small>
                    </span>
                    <span className="symbol-row-meta">
                      <small className={getOpenChangeClassName(openChange.change)}>
                        {ui.previousChange}{" "}
                        {openChange.change == null || openChange.changePercent == null
                          ? "-"
                          : `${formatSignedPrice(openChange.change)} (${formatSignedPercent(openChange.changePercent)})`}
                      </small>
                      <b>
                        {symbol.bars.length.toLocaleString(locale)} {ui.rows}
                      </b>
                    </span>
                  </button>
                );
              })}
            </div>
            <section className="drawer-section drawer-sample">
              <button className="secondary-button drawer-action" type="button" onClick={addSyntheticSample}>
                {ui.generateSample}
              </button>
            </section>
            <section className="drawer-section drawer-settings">
              <h3>{languageMode === "ja" ? "各種モード" : "Modes"}</h3>
              <button
                className="theme-toggle drawer-action"
                type="button"
                onClick={() => setThemeMode((value) => (value === "light" ? "dark" : "light"))}
              >
                {themeMode === "light" ? <Moon size={16} /> : <Sun size={16} />}
                {themeMode === "light" ? ui.themeToDark : ui.themeToLight}
              </button>
              <button
                className="theme-toggle drawer-action"
                type="button"
                onClick={() => setLanguageMode((value) => (value === "ja" ? "en" : "ja"))}
              >
                <Languages size={16} />
                {ui.languageToggle}
              </button>
            </section>
          </aside>
        </>
      ) : null}

      <section className="workspace">
        <section className="center-panel">
          <div className="chart-header panel">
            <div>
              <h2>{selectedSymbol?.id ?? ui.csvNotSelected}</h2>
              <span>{displayDatetime ?? ui.loadCsvInBrowser}</span>
            </div>
            <div className="chart-tools">
              <div className="daily-strip">
                <span>
                  {ui.dailyOpen} {dailyMarketStats ? formatPrice(dailyMarketStats.open) : "-"}
                </span>
                <span className={getChangeClassName("daily-change", dailyMarketStats?.change ?? null)}>
                  {ui.previousChange}{" "}
                  {dailyMarketStats?.change == null || dailyMarketStats.changePercent == null
                    ? "-"
                    : `${formatSignedPrice(dailyMarketStats.change)} (${formatSignedPercent(dailyMarketStats.changePercent)})`}
                </span>
                <span>
                  {ui.dailyHigh} {dailyMarketStats ? formatPrice(dailyMarketStats.high) : "-"}
                </span>
                <span>
                  {ui.dailyLow} {dailyMarketStats ? formatPrice(dailyMarketStats.low) : "-"}
                </span>
              </div>
              <div className="ohlc-strip">
                <span>
                  {ui.open} {displayCurrentBar ? formatPrice(displayCurrentBar.open) : "-"}
                </span>
                <span>
                  {ui.high} {displayCurrentBar ? formatPrice(displayCurrentBar.high) : "-"}
                </span>
                <span>
                  {ui.low} {displayCurrentBar ? formatPrice(displayCurrentBar.low) : "-"}
                </span>
                <span>
                  {ui.close} {displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"}
                </span>
                <span>
                  {ui.volume} {displayCurrentBar ? formatVolume(displayCurrentBar.volume) : "-"}
                </span>
              </div>
              <div className="chart-picker-row">
                <label className="timeframe-picker">
                  <span>{ui.tick}</span>
                  <select value={tickMode} onChange={(event) => setTickMode(event.currentTarget.value as TickMode)}>
                    <option value="desktop">{ui.desktop}</option>
                    <option value="mobile">{ui.mobile}</option>
                  </select>
                </label>
                <label className="timeframe-picker">
                  <span>{ui.timeframe}</span>
                  <select value={timeframe} onChange={(event) => changeTimeframe(event.currentTarget.value as Timeframe)}>
                    <option value="1m">{ui.oneMinute}</option>
                    <option value="5m">{ui.fiveMinutes}</option>
                  </select>
                </label>
                <label className="timeframe-picker">
                  <span>{ui.indicator}</span>
                  <select value={indicatorMode} onChange={(event) => setIndicatorMode(event.currentTarget.value as IndicatorMode)}>
                    <option value="ma">MA</option>
                    <option value="bb">BB</option>
                  </select>
                </label>
                {indicatorMode === "bb" ? (
                  <label className="timeframe-picker">
                    <span>{ui.period}</span>
                    <select value={bollingerPeriod} onChange={(event) => setBollingerPeriod(Number(event.currentTarget.value))}>
                      {BOLLINGER_PERIOD_OPTIONS.map((period) => (
                        <option key={period} value={period}>
                          {period}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>
          </div>

          <ChartPanel
            bars={visibleBars}
            maSourceBars={visibleBars}
            executions={trading.executions.filter((item) => item.symbol === selectedSymbolId)}
            historicalTrades={visibleHistoricalTrades}
            markerBars={bars}
            maPeriods={MA_PERIODS}
            indicatorMode={indicatorMode}
            languageMode={languageMode}
            bollingerPeriod={bollingerPeriod}
            themeMode={themeMode}
            timeframe={timeframe}
            viewportKey={chartViewportKey}
            jumpIndex={chartAnchorIndex}
            canTogglePlayback={bars.length > 0}
            onTogglePlayback={() => setPlaying((value) => !value)}
            onScreenshotReady={registerChartScreenshot}
            screenshotSymbol={selectedSymbol?.id ?? "chart"}
            screenshotFileName={`ReplayTrader_${selectedSymbolId ?? "chart"}_${resolvedDate.activeDate ?? "undated"}`}
          />

          <div className="replay-panel panel">
            <div className="timeline-row">
              <div>
                <strong>{displayDatetime?.split(" ")[0] ?? "----/--/--"}</strong>
                <span>{displayDatetime?.split(" ")[1]?.slice(0, 8) ?? "--:--:--"}</span>
              </div>
              <input
                aria-label={ui.playbackPosition}
                type="range"
                min={0}
                max={Math.max(0, bars.length - 1)}
                value={currentIndex}
                onChange={(event) => {
                  setPlaying(false);
                  setWalkState(null);
                  setReplayIndex(Number(event.currentTarget.value));
                }}
              />
              <small>
                {bars.length === 0 ? 0 : currentIndex + 1} / {bars.length}
              </small>
            </div>
            <p className="date-note replay-date-note">
              {formatDateNote(resolvedDate.activeDate, requestedDate, resolvedDate.exact, Boolean(selectedSymbol), languageMode)}
            </p>
            <div className="control-row">
              <label className="replay-date-picker">
                <CalendarDays size={16} aria-hidden="true" />
                <span className="sr-only">{ui.replayDate}</span>
                <input
                  aria-label={ui.replayDate}
                  title={ui.replayDate}
                  type="date"
                  value={requestedDate}
                  onChange={(event) => setRequestedDate(event.currentTarget.value)}
                />
              </label>
              <button type="button" className="primary-button" disabled={bars.length === 0} onClick={() => setPlaying((value) => !value)}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
                {playing ? ui.pause : ui.play}
              </button>
              <IconButton
                label={ui.first}
                onClick={() => {
                  setWalkState(null);
                  setReplayIndex(0);
                }}
                disabled={bars.length === 0}
              >
                <ArrowLeftToLine size={16} />
              </IconButton>
              <IconButton
                label={ui.previous}
                onClick={() => {
                  setWalkState(null);
                  setReplayIndex((value) => Math.max(0, value - 1));
                }}
                disabled={bars.length === 0}
              >
                <SkipBack size={16} />
              </IconButton>
              <IconButton
                label={ui.next}
                onClick={() => {
                  setWalkState(null);
                  setReplayIndex((value) => Math.min(bars.length - 1, value + 1));
                }}
                disabled={bars.length === 0}
              >
                <SkipForward size={16} />
              </IconButton>
              <IconButton
                label={ui.last}
                onClick={() => {
                  setPlaying(false);
                  setWalkState(null);
                  setReplayIndex(Math.max(0, bars.length - 1));
                }}
                disabled={bars.length === 0 || currentIndex >= bars.length - 1}
              >
                <SkipForward size={16} />
              </IconButton>
              <div className="speed-group" aria-label={ui.speed}>
                {SPEEDS.map((value) => (
                  <button className={speed === value ? "active" : ""} key={value} type="button" onClick={() => setSpeed(value)}>
                    {value}x
                  </button>
                ))}
              </div>
              <button type="button" className="secondary-button compact" onClick={() => void persistSession()} disabled={symbols.length === 0}>
                <Save size={15} />
                {ui.save}
              </button>
              <button type="button" className="secondary-button compact" onClick={() => void restoreSession()}>
                {ui.restore}
              </button>
              <button type="button" className="secondary-button compact danger" onClick={() => void resetAll()}>
                <RotateCcw size={15} />
                {ui.clear}
              </button>
            </div>
          </div>
        </section>

        <aside className="right-panel panel">
          <section className="panel-section summary-card">
            <h2>{ui.accountSummary}</h2>
            <label className="capital-field">
              {ui.initialCash}
              <select
                value={trading.initialCash}
                onChange={(event) => {
                  const nextInitialCash = Number(event.currentTarget.value);
                  setTrading((current) => updateInitialCash(current, nextInitialCash));
                }}
              >
                {INITIAL_CASH_OPTIONS.map((cash) => (
                  <option key={cash} value={cash}>
                    {formatCurrency(cash, languageMode)}
                  </option>
                ))}
              </select>
            </label>
            <Metric label={ui.virtualCapital} value={formatCurrency(trading.initialCash, languageMode)} />
            <Metric label={ui.cashBalance} value={formatCurrency(trading.cash, languageMode)} />
            <Metric label={ui.cashMarketValue} value={formatCurrency(cashMarketValue, languageMode)} />
            <Metric label={ui.longPositionPnl} value={formatSignedCurrency(positionPnlSummary.buy, languageMode)} strong={positionPnlSummary.buy !== 0} />
            <Metric label={ui.shortPositionPnl} value={formatSignedCurrency(positionPnlSummary.sell, languageMode)} strong={positionPnlSummary.sell !== 0} />
            <Metric label={ui.totalPositionPnl} value={formatSignedCurrency(positionPnlSummary.total, languageMode)} strong={positionPnlSummary.total !== 0} />
            <Metric label={ui.realizedPnl} value={formatSignedCurrency(trading.realizedPnl, languageMode)} strong={trading.realizedPnl !== 0} />
            <Metric label={ui.totalPnl} value={formatSignedCurrency(totalPnl, languageMode)} strong={totalPnl !== 0} />
            <Metric label={ui.marginExposure} value={formatCurrency(marginExposure, languageMode)} />
            <Metric label={ui.marginBuyingPower} value={formatCurrency(marginBuyingPower, languageMode)} />
            <Metric
              label={ui.maintenanceRatio}
              value={maintenanceRatio == null ? "-" : formatPercent(maintenanceRatio)}
              strong={maintenanceRatio != null && maintenanceRatio < 30}
            />
            <Metric label={ui.accountValue} value={formatCurrency(accountValue, languageMode)} />
            <p className="notice compact-notice">{ui.marginNote}</p>
          </section>

          <section className="panel-section table-section">
            <h2>{ui.positions}</h2>
            <table>
              <thead>
                <tr>
                  <th>{ui.symbol}</th>
                  <th>{ui.product}</th>
                  <th>{ui.type}</th>
                  <th>{ui.quantity}</th>
                  <th>{ui.entryPrice}</th>
                  <th>{ui.pnl}</th>
                  <th>{ui.openedDate}</th>
                </tr>
              </thead>
              <tbody>
                {trading.positions.length === 0 ? (
                  <tr>
                    <td colSpan={7}>{ui.noPositions}</td>
                  </tr>
                ) : (
                  trading.positions.map((position) => (
                    <tr key={position.id}>
                      <td>{position.symbol}</td>
                      <td>{position.product === "cash" ? ui.cash : ui.margin}</td>
                      <td>{formatPositionSide(position.product, position.side, languageMode)}</td>
                      <td>{position.quantity.toLocaleString(locale)}</td>
                      <td>{formatPrice(position.entryPrice)}</td>
                      <td className={valuationPrice == null ? "" : "signed"}>
                        {valuationPrice == null ? "-" : formatSignedCurrency(evaluatePositionUnrealizedPnl(position, valuationPrice), languageMode)}
                      </td>
                      <td>{position.openedDate}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="panel-section table-section">
            <h2>{ui.executions}</h2>
            <table>
              <thead>
                <tr>
                  <th>{ui.time}</th>
                  <th>{ui.side}</th>
                  <th>{ui.quantity}</th>
                  <th>{ui.price}</th>
                </tr>
              </thead>
              <tbody>
                {trading.executions.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{ui.noExecutions}</td>
                  </tr>
                ) : (
                  trading.executions.slice(0, 7).map((execution) => (
                    <tr key={execution.id}>
                      <td>{execution.time.split(" ")[1]?.slice(0, 5)}</td>
                      <td className={execution.side}>{execution.side === "buy" ? ui.buy : ui.sell}</td>
                      <td>{execution.quantity.toLocaleString(locale)}</td>
                      <td>{formatPrice(execution.price)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="panel-section table-section historical-trades-section">
            <h2>{ui.tradeHistoryTitle}</h2>
            <p className="notice compact-notice">{ui.historicalTimeNote}</p>
            <table>
              <thead>
                <tr>
                  <th>{ui.time}</th>
                  <th>{ui.symbol}</th>
                  <th>{ui.side}</th>
                  <th>{ui.quantity}</th>
                  <th>{ui.price}</th>
                  <th>{ui.pnl}</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistoricalTrades.length === 0 ? (
                  <tr>
                    <td colSpan={6}>{ui.noHistoricalTrades}</td>
                  </tr>
                ) : (
                  [...visibleHistoricalTrades].reverse().slice(0, 20).map((trade) => (
                    <tr key={trade.id}>
                      <td>{trade.time.split(" ")[1]?.slice(0, 8)}</td>
                      <td>{trade.companyName}</td>
                      <td className={trade.side}>{formatHistoricalTradeLabel(trade, languageMode)}</td>
                      <td>{trade.quantity.toLocaleString(locale)}</td>
                      <td>{formatPrice(trade.price)}</td>
                      <td className={trade.realizedPnl == null ? "" : "signed"}>
                        {trade.realizedPnl == null ? "-" : formatSignedCurrency(trade.realizedPnl, languageMode)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </aside>
      </section>

      {isOrderModalOpen ? (
        <section
          className="order-modal panel"
          role="dialog"
          aria-modal="false"
          aria-label={ui.virtualOrder}
          style={{
            left: orderPanelPosition?.x ?? ORDER_PANEL_MARGIN,
            top: orderPanelPosition?.y ?? ORDER_PANEL_MARGIN,
          }}
        >
            <header
              className="modal-header draggable-header"
              onPointerDown={startOrderPanelDrag}
            >
              <div>
                <h2>{ui.virtualOrder}</h2>
                <p>{ui.orderDialogDescription}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={ui.closeDialog}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setIsOrderModalOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="order-mode-tabs" role="tablist" aria-label={ui.orderMethod}>
              <button className={orderMode === "normal" ? "active" : ""} type="button" onClick={() => setOrderMode("normal")}>
                {ui.normalOrder}
              </button>
              <button className={orderMode === "ifdoco" ? "active" : ""} type="button" onClick={() => setOrderMode("ifdoco")}>
                IFDOCO
              </button>
            </div>
            <div className="order-modal-status">
              <Metric label={ui.currentPrice} value={displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"} />
              <Metric label={ui.pendingIfdoco} value={formatCount(pendingOcoOrders.length, languageMode)} />
              <Metric label={ui.pendingStop} value={formatCount(pendingEntryOrders.length, languageMode)} />
            </div>

            {orderMode === "normal" ? (
              <div className="order-form-grid">
                <label>
                  {ui.tradeType}
                  <select value={tradeType} onChange={(event) => setTradeType(event.currentTarget.value as TradeType)}>
                    <option value="cash">{ui.cashTrade}</option>
                    <option value="marginOpen">{ui.marginOpen}</option>
                    <option value="marginClose">{ui.marginClose}</option>
                  </select>
                </label>
                <div className="segmented order-type-selector">
                  <button className={orderType === "market" ? "active" : ""} type="button" onClick={() => setOrderType("market")}>
                    {ui.market}
                  </button>
                  <button className={orderType === "limit" ? "active" : ""} type="button" onClick={() => setOrderType("limit")}>
                    {ui.limit}
                  </button>
                  <button className={orderType === "stop" ? "active" : ""} type="button" onClick={() => setOrderType("stop")}>
                    {ui.stop}
                  </button>
                </div>
                <label>
                  {ui.quantity}
                  <input
                    min={LOT_SIZE}
                    step={LOT_SIZE}
                    type="number"
                    value={quantity}
                    onBlur={() => setQuantity((value) => normalizeLotQuantity(value))}
                    onChange={(event) => setQuantity(Number(event.currentTarget.value))}
                  />
                </label>
                <label className="price-field">
                  <span>{orderType === "stop" ? ui.triggerPrice : ui.limitPrice}</span>
                  <div className="price-input-row">
                    <input
                      disabled={orderType === "market"}
                      inputMode="decimal"
                      placeholder={displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"}
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      disabled={orderType === "market" || !displayCurrentBar}
                      onClick={() => setPriceToCurrent(setLimitPrice)}
                    >
                      {ui.setCurrentPrice}
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(orderType === "stop" ? ui.triggerPrice : ui.limitPrice, -1, languageMode)}
                      disabled={orderType === "market" || !displayCurrentBar}
                      onClick={() => movePriceByTick(limitPrice, setLimitPrice, -1)}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(orderType === "stop" ? ui.triggerPrice : ui.limitPrice, 1, languageMode)}
                      disabled={orderType === "market" || !displayCurrentBar}
                      onClick={() => movePriceByTick(limitPrice, setLimitPrice, 1)}
                    >
                      +
                    </button>
                  </div>
                </label>
                <div className="order-actions">
                  <button type="button" className="buy-button" onClick={() => placeOrder("buy")}>
                    {ui.buyOrder}
                  </button>
                  <button type="button" className="sell-button" onClick={() => placeOrder("sell")}>
                    {ui.sellOrder}
                  </button>
                </div>
              </div>
            ) : (
              <div className="order-form-grid">
                <label>
                  {ui.entryType}
                  <select value={ifdTradeType} onChange={(event) => setIfdTradeType(event.currentTarget.value as IfdEntryTradeType)}>
                    <option value="marginOpen">{ui.marginOpen}</option>
                    <option value="cash">{ui.cashBuy}</option>
                  </select>
                </label>
                <div className="segmented">
                  <button className={ifdOrderType === "market" ? "active" : ""} type="button" onClick={() => setIfdOrderType("market")}>
                    {ui.market}
                  </button>
                  <button className={ifdOrderType === "limit" ? "active" : ""} type="button" onClick={() => setIfdOrderType("limit")}>
                    {ui.limit}
                  </button>
                </div>
                <label>
                  {ui.quantity}
                  <input
                    min={LOT_SIZE}
                    step={LOT_SIZE}
                    type="number"
                    value={ifdQuantity}
                    onBlur={() => setIfdQuantity((value) => normalizeLotQuantity(value))}
                    onChange={(event) => setIfdQuantity(Number(event.currentTarget.value))}
                  />
                </label>
                <label className="price-field">
                  <span>{ui.entryLimit}</span>
                  <div className="price-input-row">
                    <input
                      disabled={ifdOrderType === "market"}
                      inputMode="decimal"
                      placeholder={displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"}
                      value={ifdLimitPrice}
                      onChange={(event) => setIfdLimitPrice(event.currentTarget.value)}
                    />
                    <button
                      type="button"
                      disabled={ifdOrderType === "market" || !displayCurrentBar}
                      onClick={() => setPriceToCurrent(setIfdLimitPrice)}
                    >
                      {ui.setCurrentPrice}
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(ui.entryLimit, -1, languageMode)}
                      disabled={ifdOrderType === "market" || !displayCurrentBar}
                      onClick={() => movePriceByTick(ifdLimitPrice, setIfdLimitPrice, -1)}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(ui.entryLimit, 1, languageMode)}
                      disabled={ifdOrderType === "market" || !displayCurrentBar}
                      onClick={() => movePriceByTick(ifdLimitPrice, setIfdLimitPrice, 1)}
                    >
                      +
                    </button>
                  </div>
                </label>
                <label className="price-field">
                  <span>{ui.targetPrice}</span>
                  <div className="price-input-row">
                    <input
                      inputMode="decimal"
                      placeholder={displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"}
                      value={ifdTargetPrice}
                      onChange={(event) => {
                        setIfdTargetPriceSynced(false);
                        setIfdTargetPrice(event.currentTarget.value);
                      }}
                    />
                    <button
                      type="button"
                      disabled={!displayCurrentBar}
                      onClick={() => {
                        setIfdTargetPriceSynced(true);
                        setPriceToCurrent(setIfdTargetPrice);
                      }}
                    >
                      {ui.setCurrentPrice}
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(ui.targetPrice, -1, languageMode)}
                      disabled={!displayCurrentBar}
                      onClick={() => {
                        setIfdTargetPriceSynced(false);
                        movePriceByTick(ifdTargetPrice, setIfdTargetPrice, -1);
                      }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(ui.targetPrice, 1, languageMode)}
                      disabled={!displayCurrentBar}
                      onClick={() => {
                        setIfdTargetPriceSynced(false);
                        movePriceByTick(ifdTargetPrice, setIfdTargetPrice, 1);
                      }}
                    >
                      +
                    </button>
                  </div>
                </label>
                <label className="price-field">
                  <span>{ui.stopPrice}</span>
                  <div className="price-input-row">
                    <input
                      inputMode="decimal"
                      placeholder={displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"}
                      value={ifdStopPrice}
                      onChange={(event) => {
                        setIfdStopPriceSynced(false);
                        setIfdStopPrice(event.currentTarget.value);
                      }}
                    />
                    <button
                      type="button"
                      disabled={!displayCurrentBar}
                      onClick={() => {
                        setIfdStopPriceSynced(true);
                        setPriceToCurrent(setIfdStopPrice);
                      }}
                    >
                      {ui.setCurrentPrice}
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(ui.stopPrice, -1, languageMode)}
                      disabled={!displayCurrentBar}
                      onClick={() => {
                        setIfdStopPriceSynced(false);
                        movePriceByTick(ifdStopPrice, setIfdStopPrice, -1);
                      }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      aria-label={formatTickButtonLabel(ui.stopPrice, 1, languageMode)}
                      disabled={!displayCurrentBar}
                      onClick={() => {
                        setIfdStopPriceSynced(false);
                        movePriceByTick(ifdStopPrice, setIfdStopPrice, 1);
                      }}
                    >
                      +
                    </button>
                  </div>
                </label>
                <p className="notice compact-notice">{ui.ifdocoNote}</p>
                <div className="order-actions">
                  <button type="button" className="buy-button" onClick={() => placeIfdOco("buy")}>
                    {ui.buyIfdoco}
                  </button>
                  <button type="button" className="sell-button" disabled={ifdTradeType === "cash"} onClick={() => placeIfdOco("sell")}>
                    {ui.sellIfdoco}
                  </button>
                </div>
              </div>
            )}
        </section>
      ) : null}

      <footer className="app-footer">
        <span>{ui.footerData}</span>
        <span>{ui.footerAdvice}</span>
        <span>{ui.footerLimits}</span>
      </footer>
    </main>
  );
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="icon-button" type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={strong ? "signed" : ""}>{value}</strong>
    </div>
  );
}

function calculateOrderPanelPosition(anchor: HTMLElement | null): FloatingPanelPosition {
  const fallback = {
    x: window.innerWidth - ORDER_PANEL_WIDTH - ORDER_PANEL_MARGIN,
    y: 86,
  };
  if (!anchor) return clampOrderPanelPosition(fallback);

  const rect = anchor.getBoundingClientRect();
  return clampOrderPanelPosition({
    x: rect.right - ORDER_PANEL_WIDTH,
    y: rect.top,
  });
}

function clampOrderPanelPosition(position: FloatingPanelPosition): FloatingPanelPosition {
  const maxX = Math.max(ORDER_PANEL_MARGIN, window.innerWidth - ORDER_PANEL_WIDTH - ORDER_PANEL_MARGIN);
  const panelHeight = Math.min(ORDER_PANEL_MAX_HEIGHT, window.innerHeight - ORDER_PANEL_MARGIN * 2);
  const maxY = Math.max(ORDER_PANEL_MARGIN, window.innerHeight - panelHeight - ORDER_PANEL_MARGIN);

  return {
    x: clamp(position.x, ORDER_PANEL_MARGIN, maxX),
    y: clamp(position.y, ORDER_PANEL_MARGIN, maxY),
  };
}

function mergeSymbols(current: SymbolData[], incoming: SymbolData[]): SymbolData[] {
  const next = [...current];
  for (const symbol of incoming) {
    const matchingIndexes = next
      .map((item, index) => (item.fileName === symbol.fileName ? index : -1))
      .filter((index) => index >= 0);
    if (matchingIndexes.length > 0) {
      const keepIndex = matchingIndexes[0];
      const preservedId = next[keepIndex].id;
      next[keepIndex] = { ...symbol, id: preservedId };
      for (const duplicateIndex of matchingIndexes.slice(1).reverse()) {
        next.splice(duplicateIndex, 1);
      }
      continue;
    }

    let id = symbol.id;
    let suffix = 2;
    while (next.some((item) => item.id === id)) {
      id = `${symbol.id}_${suffix}`;
      suffix += 1;
    }
    next.push({ ...symbol, id });
  }
  return next;
}

function mergeHistoricalTrades(current: HistoricalTrade[], incoming: HistoricalTrade[]): HistoricalTrade[] {
  const next = new Map(current.map((trade) => [trade.id, trade]));
  for (const trade of incoming) next.set(trade.id, trade);
  return Array.from(next.values()).sort((first, second) => historicalTradeTimestamp(first) - historicalTradeTimestamp(second));
}

function historicalTradeTimestamp(trade: HistoricalTrade): number {
  const timestamp = Date.parse(trade.time.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function formatHistoricalTradeLabel(trade: HistoricalTrade, languageMode: LanguageMode): string {
  if (languageMode === "en") {
    const type = trade.tradeType === "marginOpen" ? "Margin open" : trade.tradeType === "marginClose" ? "Margin close" : "Cash";
    return `${type} ${trade.side === "buy" ? "Buy" : "Sell"}`;
  }
  const type = trade.tradeType === "marginOpen" ? "信用新規" : trade.tradeType === "marginClose" ? "信用返済" : "現物";
  return `${type}${trade.side === "buy" ? "買" : "売"}`;
}

function normalizeLotQuantity(value: number): number {
  if (!Number.isFinite(value)) return LOT_SIZE;
  return Math.max(LOT_SIZE, Math.round(value / LOT_SIZE) * LOT_SIZE);
}

function parseOrderPrice(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function formatOrderPriceInput(value: number): string {
  const rounded = roundToTseTick(value);
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(10)));
}

function formatPositionSide(product: PositionProduct, side: "long" | "short", languageMode: LanguageMode): string {
  if (languageMode === "en") {
    if (product === "cash") return "Holding";
    return side === "long" ? "Long" : "Short";
  }
  if (product === "cash") return "保有";
  return side === "long" ? "買建" : "売建";
}

function formatCurrency(value: number, languageMode: LanguageMode): string {
  const locale = languageMode === "ja" ? "ja-JP" : "en-US";
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value));
  return languageMode === "ja" ? `${amount} 円` : `¥${amount}`;
}

function formatSignedCurrency(value: number, languageMode: LanguageMode): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCurrency(value, languageMode)}`;
}

function formatCount(value: number, languageMode: LanguageMode): string {
  const locale = languageMode === "ja" ? "ja-JP" : "en-US";
  const count = value.toLocaleString(locale);
  return languageMode === "ja" ? `${count} 件` : `${count} orders`;
}

function formatDateNote(
  activeDate: string | undefined,
  requestedDate: string,
  exact: boolean,
  hasSelectedSymbol: boolean,
  languageMode: LanguageMode,
): string {
  if (!activeDate) {
    if (hasSelectedSymbol) return languageMode === "ja" ? "YYYY-MM-DD形式で入力してください。" : "Enter a date in YYYY-MM-DD format.";
    return languageMode === "ja" ? "CSV読込後に日付を選択できます。" : "You can choose a date after loading a CSV file.";
  }
  if (!requestedDate) {
    return languageMode === "ja"
      ? `未指定のため、今日に最も近い ${activeDate} を表示中`
      : `No date specified. Showing ${activeDate}, the closest date to today.`;
  }
  if (exact) {
    return languageMode === "ja" ? `指定日 ${activeDate} を表示中` : `Showing requested date ${activeDate}.`;
  }
  return languageMode === "ja"
    ? `指定日にデータがないため、最も近い ${activeDate} を表示中`
    : `No data exists for the requested date. Showing nearest date ${activeDate}.`;
}

function formatTickButtonLabel(label: string, direction: 1 | -1, languageMode: LanguageMode): string {
  if (languageMode === "ja") {
    return `${label}を1呼値${direction > 0 ? "上げる" : "下げる"}`;
  }
  return `${direction > 0 ? "Increase" : "Decrease"} ${label} by one tick`;
}

function translateCsvParseMessage(message: string, languageMode: LanguageMode): string {
  if (languageMode === "ja") return message;
  if (message === "CSVにデータ行がありません。") return "The CSV has no data rows.";
  if (message.startsWith("必須カラムが不足しています:")) return message.replace("必須カラムが不足しています:", "Missing required columns:");
  if (message === "有効なバーがありません。") return "No valid bars were found.";
  return message
    .replace(/(\d+)行目:/, "Line $1:")
    .replace("カラム数がヘッダと一致しません。", "Column count does not match the header.")
    .replace(" が空です。", " is empty.")
    .replace(" が数値ではありません。", " is not numeric.")
    .replace("Datetime は YYYY-MM-DD HH:mm:ss+0900 形式で指定してください。", "Datetime must be in YYYY-MM-DD HH:mm:ss+0900 format.")
    .replace("Datetime は実在する日時を指定してください。", "Datetime must be a valid date and time.")
    .replace("High が Open/Close/Low より小さいです。", "High is lower than Open/Close/Low.")
    .replace("Low が Open/Close/High より大きいです。", "Low is higher than Open/Close/High.");
}

function translateOrderMessage(message: string | undefined, languageMode: LanguageMode): string {
  if (languageMode === "ja") return message ?? "条件を確認してください。";
  if (!message) return "Check the order conditions.";
  const translations: Record<string, string> = {
    "数量は1以上の整数で指定してください。": "Quantity must be a positive integer.",
    "日跨ぎ建玉があるため新規注文はできません。信用返済で建玉を解消してください。":
      "New margin orders are blocked while positions are carried overnight. Close margin positions first.",
    "売却対象の現物保有がありません。": "There is no cash position to sell.",
    "現物保有数量を超えています。": "Order quantity exceeds the cash position quantity.",
    "返済対象の建玉がありません。": "There is no margin position to close.",
    "返済可能数量を超えています。": "Order quantity exceeds the closable margin quantity.",
    "指値が現在バーの高値/安値に到達していません。": "The limit price is outside the current candle range.",
    "現金残高を超える現物買い注文です。": "Cash buy order exceeds cash balance.",
    "信用建余力を超える新規注文です。": "Margin open order exceeds margin buying power.",
  };
  return translations[message] ?? message;
}

function calculateDailyMarketStats(
  dayBars: Bar[],
  currentIndex: number,
  displayCurrentBar: Bar | undefined,
  sourceBars: Bar[],
  activeDate: string | undefined,
): DailyMarketStats | null {
  if (dayBars.length === 0 || !displayCurrentBar) return null;
  const visibleDayBars = [...dayBars.slice(0, currentIndex), displayCurrentBar];
  const previousClose = findPreviousClose(sourceBars, activeDate);
  const change = previousClose == null ? null : displayCurrentBar.close - previousClose;
  const changePercent = previousClose == null || previousClose === 0 ? null : ((displayCurrentBar.close - previousClose) / previousClose) * 100;

  return {
    open: dayBars[0].open,
    high: Math.max(...visibleDayBars.map((bar) => bar.high)),
    low: Math.min(...visibleDayBars.map((bar) => bar.low)),
    change,
    changePercent,
  };
}

function calculateSymbolOpenChange(symbol: SymbolData, requestedDate: string): SymbolOpenChange {
  const activeDate = resolveRequestedDate(symbol.bars, requestedDate).activeDate;
  const dayOpen = activeDate ? filterBarsByDate(symbol.bars, activeDate)[0]?.open : undefined;
  const previousClose = findPreviousClose(symbol.bars, activeDate);
  if (dayOpen == null || previousClose == null || previousClose === 0) {
    return { change: null, changePercent: null };
  }

  const change = dayOpen - previousClose;
  return {
    change,
    changePercent: (change / previousClose) * 100,
  };
}

function getOpenChangeClassName(change: number | null): string {
  return getChangeClassName("symbol-open-change", change);
}

function getChangeClassName(baseClassName: string, change: number | null): string {
  if (change == null || change === 0) return baseClassName;
  return `${baseClassName} ${change > 0 ? "positive" : "negative"}`;
}

function findPreviousClose(sourceBars: Bar[], activeDate: string | undefined): number | null {
  if (!activeDate) return null;
  const activeStart = Date.parse(`${activeDate}T00:00:00+09:00`) / 1000;
  if (!Number.isFinite(activeStart)) return null;

  return sourceBars.filter((bar) => bar.time < activeStart).at(-1)?.close ?? null;
}

function resolveDisplayCurrentBar(bar: Bar, walkState: IntrabarWalkState | null, playing: boolean): Bar {
  if (walkState?.time === bar.time) {
    return buildWalkingBar(bar, walkState);
  }
  if (playing) {
    return buildWalkingBar(bar, createInitialWalkState(bar));
  }
  return bar;
}

function resolveDisplayDatetime(bar: Bar, walkState: IntrabarWalkState | null, playing: boolean): string {
  const activeWalkState = walkState?.time === bar.time ? walkState : playing ? createInitialWalkState(bar) : null;
  if (!activeWalkState) return bar.datetime;
  return addMillisecondsToJstDatetime(bar.datetime, activeWalkState.elapsedMs);
}

function createInitialWalkState(bar: Bar): IntrabarWalkState {
  const close = clampToTseTick(bar.open, bar.low, bar.high);
  return {
    time: bar.time,
    close,
    high: close,
    low: close,
    volume: 0,
    elapsedMs: 0,
    startedAtMs: Date.now(),
  };
}

function buildWalkingBar(bar: Bar, walkState: IntrabarWalkState): Bar {
  const boundedClose = clampToTseTick(walkState.close, bar.low, bar.high);
  const boundedHigh = clampToTseTick(Math.max(bar.open, walkState.high, boundedClose), Math.max(bar.open, boundedClose), bar.high);
  const boundedLow = clampToTseTick(Math.min(bar.open, walkState.low, boundedClose), bar.low, Math.min(bar.open, boundedClose));
  return {
    ...bar,
    high: boundedHigh,
    low: boundedLow,
    close: boundedClose,
    volume: Math.min(bar.volume, Math.max(0, Math.round(walkState.volume))),
  };
}

function nextWalkState(value: IntrabarWalkState | null, bar: Bar, timeframe: Timeframe, speed: number): IntrabarWalkState {
  const current = value?.time === bar.time ? value : createInitialWalkState(bar);
  const close = nextWalkClose(current.close, bar);
  const maxElapsedMs = Math.max(0, getTimeframeDurationMs(timeframe) - 1_000);
  const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const elapsedMs = Math.min(maxElapsedMs, Math.max(0, (Date.now() - current.startedAtMs) * normalizedSpeed));
  const volume = getIntrabarDisplayVolume(bar.volume, elapsedMs, timeframe);
  return {
    time: bar.time,
    close,
    high: Math.max(current.high, close),
    low: Math.min(current.low, close),
    volume,
    elapsedMs,
    startedAtMs: current.startedAtMs,
  };
}

function nextWalkClose(value: number, bar: Bar): number {
  const range = Math.max(1, bar.high - bar.low);
  const direction = Math.random() * 2 - 1;
  const step = range * 0.12 * direction;
  const current = clampToTseTick(value, bar.low, bar.high);
  const next = clampToTseTick(current + step, bar.low, bar.high);
  return next === current ? moveToAdjacentTseTick(current, direction, bar.low, bar.high) : next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSignedPrice(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPrice(value)}`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value)}`;
}

function addMillisecondsToJstDatetime(datetime: string, elapsedMs: number): string {
  const timestamp = Date.parse(datetime.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isFinite(timestamp)) return datetime;

  return formatJstOffsetDatetime(new Date(timestamp + elapsedMs));
}

function formatJstOffsetDatetime(date: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}+0900`;
}

export default App;

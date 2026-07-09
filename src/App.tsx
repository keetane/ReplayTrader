import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftToLine,
  BarChart3,
  CalendarDays,
  Database,
  FileUp,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sun,
} from "lucide-react";
import { ChartPanel } from "./components/ChartPanel";
import { filterBarsByDate, filterBarsFromDateLookback, prepareBarsForTimeframe, resolveRequestedDate } from "./lib/bars";
import { buildSyntheticCsv, CsvParseError, parseCsvText, summarizeSymbol } from "./lib/csv";
import { formatPercent, formatPrice, formatSignedYen, formatVolume, formatYen } from "./lib/format";
import { getReplayAdvanceIntervalMs, getTimeframeDurationMs } from "./lib/replay";
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
import type { Bar, PersistedSession, PositionProduct, Side, SymbolData, ThemeMode, Timeframe, TradingState, TradeType } from "./types";
import "./styles.css";

const SPEEDS = [1, 5, 10, 30, 60];
const MA_PERIODS: [number, number, number] = [5, 25, 60];
const LOT_SIZE = 100;
const WALK_INTERVAL_MS = 120;
const CHART_LOOKBACK_DAYS = 2;
const EMPTY_POSITION_PNL_SUMMARY = { buy: 0, sell: 0, total: 0 };

interface IntrabarWalkState {
  time: Bar["time"];
  close: number;
  high: number;
  low: number;
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

function App() {
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string>();
  const [requestedDate, setRequestedDate] = useState("");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [replayIndex, setReplayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [trading, setTrading] = useState<TradingState>(INITIAL_TRADING_STATE);
  const [parseMessage, setParseMessage] = useState<string>("CSVを選択するか、架空サンプルを生成してください。");
  const [tradeType, setTradeType] = useState<TradeType>("marginOpen");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState(100);
  const [limitPrice, setLimitPrice] = useState("");
  const [walkState, setWalkState] = useState<IntrabarWalkState | null>(null);
  const [isCsvDragging, setIsCsvDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedSymbol = symbols.find((symbol) => symbol.id === selectedSymbolId);
  const resolvedDate = useMemo(
    () => resolveRequestedDate(selectedSymbol?.bars ?? [], requestedDate),
    [requestedDate, selectedSymbol?.bars],
  );
  const timeframeBars = useMemo(
    () => prepareBarsForTimeframe(selectedSymbol?.bars ?? [], timeframe),
    [selectedSymbol?.bars, timeframe],
  );
  const bars = useMemo(() => filterBarsByDate(timeframeBars, resolvedDate.activeDate), [resolvedDate.activeDate, timeframeBars]);
  const chartBars = useMemo(
    () => filterBarsFromDateLookback(timeframeBars, resolvedDate.activeDate, CHART_LOOKBACK_DAYS),
    [resolvedDate.activeDate, timeframeBars],
  );
  const currentIndex = bars.length === 0 ? 0 : Math.min(replayIndex, bars.length - 1);
  const currentBar = bars[currentIndex];
  const displayCurrentBar = currentBar ? resolveDisplayCurrentBar(currentBar, walkState, playing) : currentBar;
  const displayDatetime = currentBar ? resolveDisplayDatetime(currentBar, walkState, playing) : undefined;
  const currentTime = currentBar?.time;
  const visibleBars = useMemo(() => {
    if (!displayCurrentBar) return [];
    return [...chartBars.filter((bar) => bar.time < displayCurrentBar.time), displayCurrentBar];
  }, [chartBars, displayCurrentBar]);
  const visibleMaSourceBars = useMemo(
    () => (currentTime === undefined ? [] : timeframeBars.filter((bar) => bar.time <= currentTime)),
    [currentTime, timeframeBars],
  );
  const dailyMarketStats = useMemo(
    () => calculateDailyMarketStats(bars, currentIndex, displayCurrentBar, timeframeBars, resolvedDate.activeDate),
    [bars, currentIndex, displayCurrentBar, timeframeBars, resolvedDate.activeDate],
  );
  const unrealizedPnl = currentBar ? evaluateUnrealizedPnl(trading.positions, currentBar.close) : 0;
  const positionPnlSummary = currentBar ? evaluatePositionPnlSummary(trading.positions, currentBar.close) : EMPTY_POSITION_PNL_SUMMARY;
  const marginUnrealizedPnl = currentBar ? evaluateMarginUnrealizedPnl(trading.positions, currentBar.close) : 0;
  const cashMarketValue = currentBar ? evaluateCashMarketValue(trading.positions, currentBar.close) : 0;
  const marginExposure = currentBar ? evaluateMarginExposure(trading.positions, currentBar.close) : 0;
  const accountValue = trading.cash + cashMarketValue + marginUnrealizedPnl;
  const totalPnl = trading.realizedPnl + unrealizedPnl;
  const maintenanceRatio = evaluateMaintenanceRatio(accountValue, marginExposure);
  const marginBuyingPower = evaluateMarginBuyingPower(trading.cash, marginExposure);
  const chartViewportKey = `${selectedSymbolId ?? "none"}:${resolvedDate.activeDate ?? "none"}:${timeframe}`;

  const selectedSummary = useMemo(() => (selectedSymbol ? summarizeSymbol(selectedSymbol) : "-"), [selectedSymbol]);

  useEffect(() => {
    if (!playing || !currentBar || bars.length === 0) {
      setWalkState(null);
      return;
    }

    setWalkState(createInitialWalkState(currentBar));
    const advanceIntervalMs = getReplayAdvanceIntervalMs(timeframe, speed);
    const walkTimer = window.setInterval(() => {
      setWalkState((value) => nextWalkState(value, currentBar, timeframe, speed));
    }, WALK_INTERVAL_MS);
    const advanceTimer = window.setInterval(() => {
      setReplayIndex((value) => {
        if (value >= bars.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, advanceIntervalMs);

    return () => {
      window.clearInterval(walkTimer);
      window.clearInterval(advanceTimer);
    };
  }, [bars.length, currentBar, playing, speed, timeframe]);

  useEffect(() => {
    if (bars.length > 0 && replayIndex > bars.length - 1) {
      setReplayIndex(bars.length - 1);
    }
  }, [bars.length, replayIndex]);

  useEffect(() => {
    setPlaying(false);
    setReplayIndex(0);
    setWalkState(null);
  }, [selectedSymbolId, requestedDate, timeframe]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const loaded: SymbolData[] = [];
    const messages: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const result = parseCsvText(text, file.name);
        loaded.push(result.symbol);
        messages.push(`${file.name}: ${result.symbol.bars.length.toLocaleString("ja-JP")} 本を読み込みました。`);
      } catch (error) {
        const message = error instanceof CsvParseError ? error.message : "CSVの読み込みに失敗しました。";
        messages.push(`${file.name}: ${message}`);
      }
    }

    if (loaded.length > 0) {
      setSymbols((current) => mergeSymbols(current, loaded));
      setSelectedSymbolId((current) => current ?? loaded[0]?.id);
      setRequestedDate("");
      setReplayIndex(0);
      setPlaying(false);
    }

    setParseMessage(messages.join("\n"));
    if (inputRef.current) inputRef.current.value = "";
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
    const result = parseCsvText(buildSyntheticCsv(), "DEMO_架空銘柄_1m.csv");
    setSymbols((current) => mergeSymbols(current, [result.symbol]));
    setSelectedSymbolId(result.symbol.id);
    setRequestedDate("");
    setReplayIndex(0);
    setPlaying(false);
    setParseMessage("架空サンプルを生成しました。実在相場データではありません。");
  }

  async function persistSession() {
    const session: PersistedSession = {
      version: 1,
      selectedSymbolId,
      replayIndex: currentIndex,
      speed,
      timeframe,
      requestedDate,
      themeMode,
      trading,
      symbols,
      savedAt: new Date().toISOString(),
    };
    await saveSession(session);
    setParseMessage("IndexedDBにローカル保存しました。外部送信はしていません。");
  }

  async function restoreSession() {
    const session = await loadSession();
    if (!session) {
      setParseMessage("保存済みセッションがありません。");
      return;
    }
    setSymbols(session.symbols);
    setSelectedSymbolId(session.selectedSymbolId ?? session.symbols[0]?.id);
    setReplayIndex(session.replayIndex);
    setSpeed(session.speed);
    setTimeframe(session.timeframe ?? "1m");
    setRequestedDate(session.requestedDate ?? "");
    setThemeMode(session.themeMode ?? "dark");
    setTrading(normalizeTradingState(session.trading));
    setPlaying(false);
    setParseMessage(`セッションを復元しました: ${new Date(session.savedAt).toLocaleString("ja-JP")}`);
  }

  async function resetAll() {
    setPlaying(false);
    setReplayIndex(0);
    setTrading({ ...INITIAL_TRADING_STATE, orders: [], executions: [], positions: [] });
    await clearSession();
    setParseMessage("仮想取引と保存セッションをクリアしました。読み込み済みCSVは画面上に残しています。");
  }

  function placeOrder(orderSide: Side) {
    if (!selectedSymbol || !currentBar) {
      setParseMessage("注文前にCSVを読み込んでリプレイ位置を選択してください。");
      return;
    }

    const normalizedQuantity = normalizeLotQuantity(quantity);
    setQuantity(normalizedQuantity);

    setTrading((current) => {
      const next = submitVirtualOrder(current, {
        symbol: selectedSymbol.id,
        side: orderSide,
        tradeType,
        orderType,
        quantity: normalizedQuantity,
        limitPrice: orderType === "limit" ? Number(limitPrice) : undefined,
        bar: {
          ...displayCurrentBar,
          datetime: displayDatetime ?? displayCurrentBar.datetime,
        },
        replayIndex: currentIndex,
      });
      const latestOrder = next.orders[0];
      if (latestOrder?.status === "rejected") {
        setParseMessage(`注文を拒否しました: ${latestOrder.message ?? "条件を確認してください。"}`);
      } else {
        setParseMessage("仮想注文を約定しました。実注文ではありません。");
      }
      return next;
    });
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
            <p>ローカルCSV専用・サーバー送信なし・すべて仮想取引</p>
          </div>
        </div>
        <div className="top-status">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setThemeMode((value) => (value === "light" ? "dark" : "light"))}
          >
            {themeMode === "light" ? <Moon size={16} /> : <Sun size={16} />}
            {themeMode === "light" ? "ダーク" : "ライト"}
          </button>
          <span>
            <ShieldCheck size={16} />
            投資助言なし
          </span>
          <span>
            <Database size={16} />
            ブラウザ内処理
          </span>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-panel panel">
          <section className="panel-section">
            <h2>CSV読込</h2>
            <button
              className={`file-drop ${isCsvDragging ? "dragging" : ""}`}
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={handleCsvDragOver}
              onDragOver={handleCsvDragOver}
              onDragLeave={() => setIsCsvDragging(false)}
              onDrop={handleCsvDrop}
            >
              <FileUp size={28} />
              <strong>CSVファイルを選択</strong>
              <span>1分足 OHLCV / 複数選択可 / ドラッグ&ドロップ可</span>
            </button>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={(event) => void handleFiles(event.currentTarget.files)}
            />
            <button className="secondary-button" type="button" onClick={addSyntheticSample}>
              架空サンプルを生成
            </button>
            <pre className="message-box">{parseMessage}</pre>
          </section>

          <section className="panel-section">
            <h2>銘柄一覧</h2>
            <div className="symbol-list">
              {symbols.length === 0 ? <p className="empty-text">読み込み済みCSVはありません。</p> : null}
              {symbols.map((symbol) => (
                <button
                  className={`symbol-row ${symbol.id === selectedSymbolId ? "selected" : ""}`}
                  key={symbol.id}
                  type="button"
                  onClick={() => {
                    setSelectedSymbolId(symbol.id);
                    setReplayIndex(0);
                    setPlaying(false);
                  }}
                >
                  <span>
                    <strong>{symbol.id}</strong>
                    <small>{symbol.fileName}</small>
                  </span>
                  <b>{symbol.bars.length.toLocaleString("ja-JP")} 行</b>
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <h2>日付指定</h2>
            <label className="date-field">
              <span>
                <CalendarDays size={15} />
                リプレイ日
              </span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={requestedDate}
                onChange={(event) => setRequestedDate(event.currentTarget.value)}
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => setRequestedDate("")}>
              未指定に戻す
            </button>
            <p className="date-note">
              {resolvedDate.activeDate
                ? requestedDate
                  ? resolvedDate.exact
                    ? `指定日 ${resolvedDate.activeDate} を表示中`
                    : `指定日にデータがないため、最も近い ${resolvedDate.activeDate} を表示中`
                  : `未指定のため、今日に最も近い ${resolvedDate.activeDate} を表示中`
                : selectedSymbol
                  ? "YYYY-MM-DD形式で入力してください。"
                  : "CSV読込後に日付を選択できます。"}
            </p>
          </section>

          <section className="panel-section data-card">
            <h2>データ情報</h2>
            <dl>
              <div>
                <dt>期間</dt>
                <dd>{selectedSummary}</dd>
              </div>
              <div>
                <dt>足種</dt>
                <dd>{timeframe === "1m" ? "1分足" : "5分足"}</dd>
              </div>
              <div>
                <dt>表示日</dt>
                <dd>{resolvedDate.activeDate ?? "-"}</dd>
              </div>
              <div>
                <dt>保存</dt>
                <dd>IndexedDB ローカル</dd>
              </div>
            </dl>
          </section>
        </aside>

        <section className="center-panel">
          <div className="chart-header panel">
            <div>
              <h2>{selectedSymbol?.id ?? "CSV未選択"}</h2>
              <span>{displayDatetime ?? "CSVをブラウザ内で読み込んでください"}</span>
            </div>
            <div className="chart-tools">
              <div className="daily-strip">
                <span>当日始 {dailyMarketStats ? formatPrice(dailyMarketStats.open) : "-"}</span>
                <span>
                  前日比{" "}
                  {dailyMarketStats?.change == null || dailyMarketStats.changePercent == null
                    ? "-"
                    : `${formatSignedPrice(dailyMarketStats.change)} (${formatSignedPercent(dailyMarketStats.changePercent)})`}
                </span>
                <span>当日高 {dailyMarketStats ? formatPrice(dailyMarketStats.high) : "-"}</span>
                <span>当日安 {dailyMarketStats ? formatPrice(dailyMarketStats.low) : "-"}</span>
              </div>
              <div className="ohlc-strip">
                <span>始 {displayCurrentBar ? formatPrice(displayCurrentBar.open) : "-"}</span>
                <span>高 {displayCurrentBar ? formatPrice(displayCurrentBar.high) : "-"}</span>
                <span>安 {displayCurrentBar ? formatPrice(displayCurrentBar.low) : "-"}</span>
                <span>終 {displayCurrentBar ? formatPrice(displayCurrentBar.close) : "-"}</span>
                <span>出来高 {displayCurrentBar ? formatVolume(displayCurrentBar.volume) : "-"}</span>
              </div>
              <label className="timeframe-picker">
                <span>時間足</span>
                <select value={timeframe} onChange={(event) => setTimeframe(event.currentTarget.value as Timeframe)}>
                  <option value="1m">1分</option>
                  <option value="5m">5分</option>
                </select>
              </label>
            </div>
          </div>

          <ChartPanel
            bars={visibleBars}
            maSourceBars={visibleMaSourceBars}
            executions={trading.executions.filter((item) => item.symbol === selectedSymbolId)}
            maPeriods={MA_PERIODS}
            themeMode={themeMode}
            timeframe={timeframe}
            viewportKey={chartViewportKey}
          />

          <div className="replay-panel panel">
            <div className="timeline-row">
              <div>
                <strong>{displayDatetime?.split(" ")[0] ?? "----/--/--"}</strong>
                <span>{displayDatetime?.split(" ")[1]?.slice(0, 8) ?? "--:--:--"}</span>
              </div>
              <input
                aria-label="リプレイ位置"
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
            <div className="control-row">
              <button type="button" className="primary-button" disabled={bars.length === 0} onClick={() => setPlaying((value) => !value)}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
                {playing ? "一時停止" : "再生"}
              </button>
              <IconButton
                label="先頭へ"
                onClick={() => {
                  setWalkState(null);
                  setReplayIndex(0);
                }}
                disabled={bars.length === 0}
              >
                <ArrowLeftToLine size={16} />
              </IconButton>
              <IconButton
                label="前へ"
                onClick={() => {
                  setWalkState(null);
                  setReplayIndex((value) => Math.max(0, value - 1));
                }}
                disabled={bars.length === 0}
              >
                <SkipBack size={16} />
              </IconButton>
              <IconButton
                label="次へ"
                onClick={() => {
                  setWalkState(null);
                  setReplayIndex((value) => Math.min(bars.length - 1, value + 1));
                }}
                disabled={bars.length === 0}
              >
                <SkipForward size={16} />
              </IconButton>
              <div className="speed-group" aria-label="再生速度">
                {SPEEDS.map((value) => (
                  <button className={speed === value ? "active" : ""} key={value} type="button" onClick={() => setSpeed(value)}>
                    {value}x
                  </button>
                ))}
              </div>
              <button type="button" className="secondary-button compact" onClick={() => void persistSession()} disabled={symbols.length === 0}>
                <Save size={15} />
                保存
              </button>
              <button type="button" className="secondary-button compact" onClick={() => void restoreSession()}>
                復元
              </button>
              <button type="button" className="secondary-button compact danger" onClick={() => void resetAll()}>
                <RotateCcw size={15} />
                クリア
              </button>
            </div>
          </div>
        </section>

        <aside className="right-panel panel">
          <section className="panel-section">
            <h2>仮想注文</h2>
            <p className="notice">トレーニング用の紙トレードです。実際の注文は発注されません。</p>
            <label>
              取引区分
              <select value={tradeType} onChange={(event) => setTradeType(event.currentTarget.value as TradeType)}>
                <option value="cash">現物</option>
                <option value="marginOpen">信用新規</option>
                <option value="marginClose">信用返済</option>
              </select>
            </label>
            <div className="segmented">
              <button className={orderType === "market" ? "active" : ""} type="button" onClick={() => setOrderType("market")}>
                成行
              </button>
              <button className={orderType === "limit" ? "active" : ""} type="button" onClick={() => setOrderType("limit")}>
                指値
              </button>
            </div>
            <label>
              数量
              <input
                min={LOT_SIZE}
                step={LOT_SIZE}
                type="number"
                value={quantity}
                onBlur={() => setQuantity((value) => normalizeLotQuantity(value))}
                onChange={(event) => setQuantity(Number(event.currentTarget.value))}
              />
            </label>
            <label>
              指値価格
              <input
                disabled={orderType === "market"}
                inputMode="decimal"
                placeholder={currentBar ? formatPrice(currentBar.close) : "-"}
                value={limitPrice}
                onChange={(event) => setLimitPrice(event.currentTarget.value)}
              />
            </label>
            <div className="order-actions">
              <button type="button" className="buy-button" onClick={() => placeOrder("buy")}>
                買い注文
              </button>
              <button type="button" className="sell-button" onClick={() => placeOrder("sell")}>
                売り注文
              </button>
            </div>
          </section>

          <section className="panel-section summary-card">
            <h2>口座サマリー</h2>
            <label className="capital-field">
              初期資金
              <input
                min={0}
                step={100000}
                type="number"
                value={trading.initialCash}
                onChange={(event) => {
                  const nextInitialCash = Number(event.currentTarget.value);
                  setTrading((current) => updateInitialCash(current, nextInitialCash));
                }}
              />
            </label>
            <Metric label="仮想資金" value={formatYen(trading.initialCash)} />
            <Metric label="現金残高" value={formatYen(trading.cash)} />
            <Metric label="現物評価額" value={formatYen(cashMarketValue)} />
            <Metric label="買い建玉損益" value={formatSignedYen(positionPnlSummary.buy)} strong={positionPnlSummary.buy !== 0} />
            <Metric label="売り建玉損益" value={formatSignedYen(positionPnlSummary.sell)} strong={positionPnlSummary.sell !== 0} />
            <Metric label="建玉損益合計" value={formatSignedYen(positionPnlSummary.total)} strong={positionPnlSummary.total !== 0} />
            <Metric label="確定損益" value={formatSignedYen(trading.realizedPnl)} strong={trading.realizedPnl !== 0} />
            <Metric label="トータル損益" value={formatSignedYen(totalPnl)} strong={totalPnl !== 0} />
            <Metric label="信用建玉評価額" value={formatYen(marginExposure)} />
            <Metric label="信用建余力" value={formatYen(marginBuyingPower)} />
            <Metric
              label="信用維持率"
              value={maintenanceRatio == null ? "-" : formatPercent(maintenanceRatio)}
              strong={maintenanceRatio != null && maintenanceRatio < 30}
            />
            <Metric label="評価額" value={formatYen(accountValue)} />
            <p className="notice compact-notice">
              信用建余力は現金残高を保証金、委託保証金率30%として簡易計算します。手数料・金利は計算対象外です。
            </p>
          </section>

          <section className="panel-section table-section">
            <h2>建玉</h2>
            <table>
              <thead>
                <tr>
                  <th>銘柄</th>
                  <th>種別</th>
                  <th>区分</th>
                  <th>数量</th>
                  <th>建値</th>
                  <th>損益</th>
                  <th>建日</th>
                </tr>
              </thead>
              <tbody>
                {trading.positions.length === 0 ? (
                  <tr>
                    <td colSpan={7}>建玉はありません。</td>
                  </tr>
                ) : (
                  trading.positions.map((position) => (
                    <tr key={position.id}>
                      <td>{position.symbol}</td>
                      <td>{position.product === "cash" ? "現物" : "信用"}</td>
                      <td>{formatPositionSide(position.product, position.side)}</td>
                      <td>{position.quantity}</td>
                      <td>{formatPrice(position.entryPrice)}</td>
                      <td className={currentBar ? "signed" : ""}>
                        {currentBar ? formatSignedYen(evaluatePositionUnrealizedPnl(position, currentBar.close)) : "-"}
                      </td>
                      <td>{position.openedDate}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="panel-section table-section">
            <h2>約定履歴</h2>
            <table>
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>売買</th>
                  <th>数量</th>
                  <th>価格</th>
                </tr>
              </thead>
              <tbody>
                {trading.executions.length === 0 ? (
                  <tr>
                    <td colSpan={4}>履歴はありません。</td>
                  </tr>
                ) : (
                  trading.executions.slice(0, 7).map((execution) => (
                    <tr key={execution.id}>
                      <td>{execution.time.split(" ")[1]?.slice(0, 5)}</td>
                      <td className={execution.side}>{execution.side === "buy" ? "買" : "売"}</td>
                      <td>{execution.quantity}</td>
                      <td>{formatPrice(execution.price)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </aside>
      </section>

      <footer className="app-footer">
        <span>データソース: ユーザー選択CSVのみ</span>
        <span>投資判断は提供しません</span>
        <span>約定・手数料・税金・信用規制を保証しません</span>
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

function mergeSymbols(current: SymbolData[], incoming: SymbolData[]): SymbolData[] {
  const next = [...current];
  for (const symbol of incoming) {
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

function normalizeLotQuantity(value: number): number {
  if (!Number.isFinite(value)) return LOT_SIZE;
  return Math.max(LOT_SIZE, Math.round(value / LOT_SIZE) * LOT_SIZE);
}

function formatPositionSide(product: PositionProduct, side: "long" | "short"): string {
  if (product === "cash") return "保有";
  return side === "long" ? "買建" : "売建";
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
  return {
    time: bar.time,
    close: bar.open,
    high: bar.open,
    low: bar.open,
    elapsedMs: 0,
    startedAtMs: Date.now(),
  };
}

function buildWalkingBar(bar: Bar, walkState: IntrabarWalkState): Bar {
  const boundedClose = clamp(walkState.close, bar.low, bar.high);
  const boundedHigh = clamp(Math.max(bar.open, walkState.high, boundedClose), bar.low, bar.high);
  const boundedLow = clamp(Math.min(bar.open, walkState.low, boundedClose), bar.low, bar.high);
  return {
    ...bar,
    high: boundedHigh,
    low: boundedLow,
    close: boundedClose,
  };
}

function nextWalkState(value: IntrabarWalkState | null, bar: Bar, timeframe: Timeframe, speed: number): IntrabarWalkState {
  const current = value?.time === bar.time ? value : createInitialWalkState(bar);
  const close = nextWalkClose(current.close, bar);
  const maxElapsedMs = Math.max(0, getTimeframeDurationMs(timeframe) - 1_000);
  const normalizedSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const elapsedMs = Math.min(maxElapsedMs, Math.max(0, (Date.now() - current.startedAtMs) * normalizedSpeed));
  return {
    time: bar.time,
    close,
    high: Math.max(current.high, close),
    low: Math.min(current.low, close),
    elapsedMs,
    startedAtMs: current.startedAtMs,
  };
}

function nextWalkClose(value: number, bar: Bar): number {
  const range = Math.max(1, bar.high - bar.low);
  const step = range * 0.12 * (Math.random() * 2 - 1);
  return clamp(value + step, bar.low, bar.high);
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

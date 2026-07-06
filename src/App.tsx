import { useEffect, useMemo, useRef, useState } from "react";
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
import { filterBarsByDate, prepareBarsForTimeframe, resolveRequestedDate } from "./lib/bars";
import { buildSyntheticCsv, CsvParseError, parseCsvText, summarizeSymbol } from "./lib/csv";
import { formatPercent, formatPrice, formatSignedYen, formatVolume, formatYen } from "./lib/format";
import { clearSession, loadSession, saveSession } from "./lib/storage";
import {
  evaluateMaintenanceRatio,
  evaluateMarginExposure,
  evaluateUnrealizedPnl,
  INITIAL_TRADING_STATE,
  normalizeTradingState,
  submitVirtualOrder,
  updateInitialCash,
} from "./lib/trading";
import type { PersistedSession, Side, SymbolData, ThemeMode, Timeframe, TradingState, TradeType } from "./types";
import "./styles.css";

const SPEEDS = [1, 5, 10, 30, 60];
const MA_PERIODS: [number, number, number] = [5, 25, 60];

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
  const [side, setSide] = useState<Side>("buy");
  const [tradeType, setTradeType] = useState<TradeType>("marginOpen");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState(100);
  const [limitPrice, setLimitPrice] = useState("");
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
  const currentIndex = bars.length === 0 ? 0 : Math.min(replayIndex, bars.length - 1);
  const currentBar = bars[currentIndex];
  const currentTime = currentBar?.time;
  const visibleBars = bars.slice(0, currentIndex + 1);
  const visibleMaSourceBars = useMemo(
    () => (currentTime === undefined ? [] : timeframeBars.filter((bar) => bar.time <= currentTime)),
    [currentTime, timeframeBars],
  );
  const unrealizedPnl = currentBar ? evaluateUnrealizedPnl(trading.positions, currentBar.close) : 0;
  const marginExposure = currentBar ? evaluateMarginExposure(trading.positions, currentBar.close) : 0;
  const accountValue = trading.cash + unrealizedPnl;
  const maintenanceRatio = evaluateMaintenanceRatio(accountValue, marginExposure);

  const selectedSummary = useMemo(() => (selectedSymbol ? summarizeSymbol(selectedSymbol) : "-"), [selectedSymbol]);

  useEffect(() => {
    if (!playing || bars.length === 0) return;
    const intervalMs = Math.max(50, 1000 / speed);
    const timer = window.setInterval(() => {
      setReplayIndex((value) => {
        if (value >= bars.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [bars.length, playing, speed]);

  useEffect(() => {
    if (bars.length > 0 && replayIndex > bars.length - 1) {
      setReplayIndex(bars.length - 1);
    }
  }, [bars.length, replayIndex]);

  useEffect(() => {
    setPlaying(false);
    setReplayIndex(0);
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

    setTrading((current) => {
      const next = submitVirtualOrder(current, {
        symbol: selectedSymbol.id,
        side: orderSide,
        tradeType,
        orderType,
        quantity,
        limitPrice: orderType === "limit" ? Number(limitPrice) : undefined,
        bar: currentBar,
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
            <button className="file-drop" type="button" onClick={() => inputRef.current?.click()}>
              <FileUp size={28} />
              <strong>CSVファイルを選択</strong>
              <span>1分足 OHLCV / 複数選択可</span>
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
              <span>{currentBar?.datetime ?? "CSVをブラウザ内で読み込んでください"}</span>
            </div>
            <div className="chart-tools">
              <div className="ohlc-strip">
                <span>始 {currentBar ? formatPrice(currentBar.open) : "-"}</span>
                <span>高 {currentBar ? formatPrice(currentBar.high) : "-"}</span>
                <span>安 {currentBar ? formatPrice(currentBar.low) : "-"}</span>
                <span>終 {currentBar ? formatPrice(currentBar.close) : "-"}</span>
                <span>出来高 {currentBar ? formatVolume(currentBar.volume) : "-"}</span>
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
          />

          <div className="replay-panel panel">
            <div className="timeline-row">
              <div>
                <strong>{currentBar?.datetime.split(" ")[0] ?? "----/--/--"}</strong>
                <span>{currentBar?.datetime.split(" ")[1]?.slice(0, 8) ?? "--:--:--"}</span>
              </div>
              <input
                aria-label="リプレイ位置"
                type="range"
                min={0}
                max={Math.max(0, bars.length - 1)}
                value={currentIndex}
                onChange={(event) => {
                  setPlaying(false);
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
              <IconButton label="先頭へ" onClick={() => setReplayIndex(0)} disabled={bars.length === 0}>
                <ArrowLeftToLine size={16} />
              </IconButton>
              <IconButton label="前へ" onClick={() => setReplayIndex((value) => Math.max(0, value - 1))} disabled={bars.length === 0}>
                <SkipBack size={16} />
              </IconButton>
              <IconButton
                label="次へ"
                onClick={() => setReplayIndex((value) => Math.min(bars.length - 1, value + 1))}
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
              <button className={side === "buy" ? "active buy" : ""} type="button" onClick={() => setSide("buy")}>
                買い
              </button>
              <button className={side === "sell" ? "active sell" : ""} type="button" onClick={() => setSide("sell")}>
                売り
              </button>
            </div>
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
              <input min={1} step={100} type="number" value={quantity} onChange={(event) => setQuantity(Number(event.currentTarget.value))} />
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
            <Metric label="評価損益" value={formatSignedYen(unrealizedPnl)} strong={unrealizedPnl !== 0} />
            <Metric label="確定損益" value={formatSignedYen(trading.realizedPnl)} strong={trading.realizedPnl !== 0} />
            <Metric label="建玉評価額" value={formatYen(marginExposure)} />
            <Metric
              label="信用維持率"
              value={maintenanceRatio == null ? "-" : formatPercent(maintenanceRatio)}
              strong={maintenanceRatio != null && maintenanceRatio < 30}
            />
            <Metric label="評価額" value={formatYen(accountValue)} />
            <p className="notice compact-notice">手数料・金利は計算対象外です。日跨ぎ建玉がある場合、新規注文は拒否されます。</p>
          </section>

          <section className="panel-section table-section">
            <h2>建玉</h2>
            <table>
              <thead>
                <tr>
                  <th>銘柄</th>
                  <th>区分</th>
                  <th>数量</th>
                  <th>平均</th>
                  <th>建日</th>
                </tr>
              </thead>
              <tbody>
                {trading.positions.length === 0 ? (
                  <tr>
                    <td colSpan={5}>建玉はありません。</td>
                  </tr>
                ) : (
                  trading.positions.map((position) => (
                    <tr key={`${position.symbol}-${position.side}`}>
                      <td>{position.symbol}</td>
                      <td>{position.side === "long" ? "買建" : "売建"}</td>
                      <td>{position.quantity}</td>
                      <td>{formatPrice(position.averagePrice)}</td>
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
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
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

export default App;

import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import { calculateVisibleBollingerBands, calculateVisibleMovingAverage } from "../lib/bars";
import { buildExecutionMarkerLabels, buildExecutionMarkers, type ExecutionMarkerLabel } from "../lib/chartMarkers";
import { formatTseTickPrice } from "../lib/format";
import type { Bar, Execution, IndicatorMode, ThemeMode, Timeframe } from "../types";

interface ChartPanelProps {
  bars: Bar[];
  maSourceBars: Bar[];
  executions: Execution[];
  maPeriods: [number, number, number];
  indicatorMode: IndicatorMode;
  bollingerPeriod: number;
  themeMode: ThemeMode;
  timeframe: Timeframe;
  viewportKey: string;
  canTogglePlayback: boolean;
  onTogglePlayback: () => void;
}

const INDICATOR_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#2563eb", "#22c55e", "#14b8a6", "#7c3aed"] as const;
const DISPLAY_TIME_ORIGIN = Math.floor(Date.UTC(2000, 0, 3, 0, 0, 0) / 1000);
const VOLUME_PANE_RATIO = 0.24;
const VOLUME_PANE_MIN_HEIGHT = 92;
const VOLUME_PANE_MAX_HEIGHT = 170;
const EXECUTION_LABEL_EDGE_PADDING = 10;
const EXECUTION_LABEL_HEIGHT = 26;
const EXECUTION_LABEL_GAP = 7;
const TSE_PRICE_FORMAT = {
  type: "custom" as const,
  minMove: 0.1,
  formatter: formatTseTickPrice,
  tickmarksFormatter: (prices: number[]) => prices.map(formatTseTickPrice),
};

interface PositionedExecutionLabel {
  id: string;
  text: string;
  color: string;
  markerX: number;
  markerY: number;
  labelX: number;
  labelY: number;
  anchorX: number;
  anchorY: number;
  labelWidth: number;
  labelHeight: number;
}

interface PositionedExecutionMarkerOutline {
  id: string;
  shape: string;
  markerX: number;
  markerY: number;
  radius: number;
}

interface IndicatorLegendItem {
  label: string;
  color: string;
  value?: number;
}

interface ChartTimeMapping {
  displayBars: Bar[];
  originalToDisplay: Map<number, UTCTimestamp>;
  displayToOriginal: Map<number, Bar>;
}

export function ChartPanel({
  bars,
  maSourceBars,
  executions,
  maPeriods,
  indicatorMode,
  bollingerPeriod,
  themeMode,
  timeframe,
  viewportKey,
  canTogglePlayback,
  onTogglePlayback,
}: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRefs = useRef<ISeriesApi<"Line">[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const appliedViewportKeyRef = useRef<string>("");
  const displayTimeLabelsRef = useRef<Map<number, string>>(new Map());
  const isPointerOverChartRef = useRef(false);
  const [executionLabels, setExecutionLabels] = useState<PositionedExecutionLabel[]>([]);
  const [executionMarkerOutlines, setExecutionMarkerOutlines] = useState<PositionedExecutionMarkerOutline[]>([]);
  const [hoveredIndicatorTime, setHoveredIndicatorTime] = useState<Bar["time"] | null>(null);

  const timeMapping = useMemo(() => buildChartTimeMapping(bars, timeframe), [bars, timeframe]);
  const executionTimes = useMemo(() => new Set(executions.map((execution) => execution.time)), [executions]);
  const barTimes = useMemo(() => new Set(bars.map((bar) => bar.time)), [bars]);
  const indicatorSeries = useMemo(
    () => buildIndicatorSeries(indicatorMode, maPeriods, bollingerPeriod, maSourceBars, bars),
    [bars, bollingerPeriod, indicatorMode, maPeriods, maSourceBars],
  );
  const indicatorLegendItems = useMemo(
    () => buildIndicatorLegendItems(indicatorSeries, hoveredIndicatorTime ?? bars.at(-1)?.time ?? null),
    [bars, hoveredIndicatorTime, indicatorSeries],
  );
  const isDark = themeMode === "dark";

  useEffect(() => {
    displayTimeLabelsRef.current = new Map(
      timeMapping.displayBars.map((bar) => [Number(bar.time), bar.datetime]),
    );
  }, [timeMapping]);

  function handleChartKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== " " && event.code !== "Space") return;
    if (!canTogglePlayback) return;
    event.preventDefault();
    event.stopPropagation();
    onTogglePlayback();
  }

  function handleChartPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.focus({ preventScroll: true });
  }

  function handleChartPointerEnter() {
    isPointerOverChartRef.current = true;
  }

  function handleChartPointerLeave() {
    isPointerOverChartRef.current = false;
    setHoveredIndicatorTime(null);
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        attributionLogo: false,
        background: { type: ColorType.Solid, color: isDark ? "#0f172a" : "#ffffff" },
        textColor: isDark ? "#cbd5e1" : "#334155",
        fontFamily:
          '"Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        panes: {
          separatorColor: isDark ? "#334155" : "#dbe3ee",
          separatorHoverColor: isDark ? "rgba(96, 165, 250, 0.28)" : "rgba(37, 99, 235, 0.16)",
          enableResize: false,
        },
      },
      localization: {
        locale: "ja-JP",
        timeFormatter: (time: unknown) => formatDisplayCrosshairTime(time, displayTimeLabelsRef.current),
      },
      grid: {
        vertLines: { color: isDark ? "#1e293b" : "#e2e8f0" },
        horzLines: { color: isDark ? "#1e293b" : "#e2e8f0" },
      },
      rightPriceScale: {
        borderColor: isDark ? "#334155" : "#cbd5e1",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: isDark ? "#334155" : "#cbd5e1",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => formatDisplayAxisTime(time, displayTimeLabelsRef.current),
      },
      crosshair: {
        mode: 1,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      priceFormat: TSE_PRICE_FORMAT,
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#15803d",
      wickDownColor: "#b91c1c",
    });
    const executionMarkers = createSeriesMarkers(candleSeries, [], {
      autoScale: true,
      zOrder: "top",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "right",
      color: "#94a3b8",
      title: "出来高",
      lastValueVisible: true,
      priceLineVisible: false,
    }, 1);
    const indicatorLabels = getIndicatorSeriesLabels(indicatorMode, maPeriods, bollingerPeriod);
    const maSeries = indicatorLabels.map((label, index) =>
      chart.addSeries(LineSeries, {
        priceFormat: TSE_PRICE_FORMAT,
        color: INDICATOR_COLORS[index],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "",
      }),
    );

    volumeSeries.priceScale().applyOptions({
      borderColor: isDark ? "#334155" : "#cbd5e1",
      scaleMargins: { top: 0.1, bottom: 0.05 },
    });
    applyChartPaneHeights(chart, containerRef.current);

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    markersRef.current = executionMarkers;
    maRefs.current = maSeries;
    appliedViewportKeyRef.current = "";

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      maRefs.current = [];
    };
  }, [bollingerPeriod, indicatorMode, isDark, maPeriods]);

  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== " " && event.code !== "Space") return;
      if (!canTogglePlayback || !isPointerOverChartRef.current) return;
      if (isEditableEventTarget(event.target)) return;
      event.preventDefault();
      onTogglePlayback();
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [canTogglePlayback, onTogglePlayback]);

  useEffect(() => {
    const chart = chartRef.current;
    const timeScale = chart?.timeScale();
    const priceScale = candleRef.current?.priceScale();
    const shouldResetViewport = viewportKey !== appliedViewportKeyRef.current;
    const preservedTimeRange = shouldResetViewport ? null : timeScale?.getVisibleLogicalRange();
    const preservedPriceRange = shouldResetViewport ? null : priceScale?.getVisibleRange();
    const trailingWhitespace = buildTrailingWhitespace(timeMapping.displayBars, timeframe);
    candleRef.current?.setData(
      [
        ...timeMapping.displayBars.map((bar) => ({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })),
        ...trailingWhitespace,
      ],
    );
    volumeRef.current?.setData(
      [
        ...timeMapping.displayBars.map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(22, 163, 74, 0.38)" : "rgba(220, 38, 38, 0.34)",
        })),
        ...trailingWhitespace,
      ],
    );
    maRefs.current.forEach((series, index) => {
      series.setData(toDisplayIndicatorPoints(indicatorSeries[index]?.points ?? [], timeMapping.originalToDisplay));
    });
    if (bars.length > 0) {
      if (shouldResetViewport) {
        timeScale?.setVisibleLogicalRange({
          from: Math.max(-42, bars.length - 108),
          to: Math.max(72, bars.length + 8),
        });
        priceScale?.setAutoScale(true);
        appliedViewportKeyRef.current = viewportKey;
      } else {
        if (preservedTimeRange) {
          timeScale?.setVisibleLogicalRange(preservedTimeRange);
        }
        if (preservedPriceRange) {
          priceScale?.setVisibleRange(preservedPriceRange);
        }
      }
    } else {
      timeScale?.fitContent();
      appliedViewportKeyRef.current = viewportKey;
    }
  }, [bars.length, indicatorSeries, timeframe, timeMapping, viewportKey]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const time = resolveChartTime(param.time);
      const originalBar = time === null ? undefined : timeMapping.displayToOriginal.get(Number(time));
      setHoveredIndicatorTime(originalBar && barTimes.has(originalBar.time) ? originalBar.time : null);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [barTimes, timeMapping]);

  useEffect(() => {
    markersRef.current?.setMarkers(toDisplayMarkers(buildExecutionMarkers(executions, timeframe), timeMapping.originalToDisplay));
  }, [executions, timeframe, timeMapping]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleRef.current;
    const container = containerRef.current;
    if (!chart || !candleSeries || !container) {
      setExecutionLabels([]);
      setExecutionMarkerOutlines([]);
      return;
    }

    const updateOverlays = () => {
      const bounds = container.getBoundingClientRect();
      const pricePaneHeight = chart.panes()[0]?.getHeight() ?? bounds.height;
      const labels = arrangeExecutionLabels(
        toDisplayMarkerLabels(buildExecutionMarkerLabels(executions, timeframe), timeMapping.originalToDisplay)
        .map((label, index): PositionedExecutionLabel | null => {
          const markerX = chart.timeScale().timeToCoordinate(label.time);
          const markerY = candleSeries.priceToCoordinate(label.price);
          if (markerX == null || markerY == null) return null;

          const estimatedWidth = Math.min(176, Math.max(78, label.text.length * 9 + 24));
          const labelX = Math.max(
            EXECUTION_LABEL_EDGE_PADDING,
            Math.min(bounds.width - estimatedWidth - EXECUTION_LABEL_EDGE_PADDING, markerX - estimatedWidth - 24),
          );
          const preferredY = label.verticalPreference === "above" ? markerY - 42 : markerY + 22;
          const staggerY = (index % 3) * 7;
          const labelY = Math.min(
            pricePaneHeight - EXECUTION_LABEL_HEIGHT - EXECUTION_LABEL_EDGE_PADDING,
            Math.max(EXECUTION_LABEL_EDGE_PADDING, preferredY + staggerY),
          );
          return {
            id: label.id,
            text: label.text,
            color: label.color,
            markerX,
            markerY,
            labelX,
            labelY,
            anchorX: labelX + estimatedWidth,
            anchorY: labelY + 13,
            labelWidth: estimatedWidth,
            labelHeight: EXECUTION_LABEL_HEIGHT,
          };
        })
        .filter((label): label is PositionedExecutionLabel => label != null),
        pricePaneHeight,
      );
      const outlines = toDisplayMarkers(buildExecutionMarkers(executions, timeframe), timeMapping.originalToDisplay)
        .map((marker): PositionedExecutionMarkerOutline | null => {
          const markerX = chart.timeScale().timeToCoordinate(marker.time);
          const markerY = "price" in marker && marker.price != null ? candleSeries.priceToCoordinate(marker.price) : null;
          if (markerX == null || markerY == null) return null;

          const size = typeof marker.size === "number" && Number.isFinite(marker.size) ? marker.size : 1;
          return {
            id: String(marker.id ?? `${marker.time}:${marker.shape}:${marker.price ?? ""}`),
            shape: String(marker.shape),
            markerX,
            markerY,
            radius: 5.5 + size * 3,
          };
        })
        .filter((outline): outline is PositionedExecutionMarkerOutline => outline != null);
      setExecutionLabels(labels);
      setExecutionMarkerOutlines(outlines);
    };

    const scheduleUpdate = () => window.requestAnimationFrame(updateOverlays);
    const timeScale = chart.timeScale();
    const resizeObserver = new ResizeObserver(() => {
      applyChartPaneHeights(chart, container);
      scheduleUpdate();
    });
    timeScale.subscribeVisibleLogicalRangeChange(scheduleUpdate);
    resizeObserver.observe(container);
    container.addEventListener("pointerup", scheduleUpdate);
    const handleWheel = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        zoomPriceScaleByWheel(chart, candleSeries, container, bars, event);
      }
      scheduleUpdate();
    };
    container.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    scheduleUpdate();

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(scheduleUpdate);
      resizeObserver.disconnect();
      container.removeEventListener("pointerup", scheduleUpdate);
      container.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [bars, executions, timeframe, timeMapping]);

  return (
    <div
      className="chart-shell"
      role="group"
      aria-label="リプレイチャート"
      tabIndex={0}
      onKeyDown={handleChartKeyDown}
      onPointerDown={handleChartPointerDown}
      onPointerEnter={handleChartPointerEnter}
      onPointerLeave={handleChartPointerLeave}
    >
      <div ref={containerRef} className="chart-canvas" />
      {executionMarkerOutlines.length > 0 ? (
        <svg className="execution-marker-outlines" aria-hidden="true">
          {executionMarkerOutlines.map((outline) => (
            <ExecutionMarkerOutline key={outline.id} outline={outline} />
          ))}
        </svg>
      ) : null}
      {executionLabels.length > 0 ? (
        <svg className="execution-label-lines" aria-hidden="true">
          {executionLabels.map((label) => (
            <line
              key={label.id}
              x1={label.markerX}
              y1={label.markerY}
              x2={label.anchorX}
              y2={label.anchorY}
              stroke={label.color}
            />
          ))}
        </svg>
      ) : null}
      {executionLabels.map((label) => (
        <span
          className="execution-label"
          key={label.id}
          style={{
            color: label.color,
            left: label.labelX,
            top: label.labelY,
            ["--execution-label-color" as string]: label.color,
          }}
        >
          {label.text}
        </span>
      ))}
      {bars.length > 0 ? (
        <div className="ma-legend">
          {indicatorLegendItems.map((item) => (
            <span key={item.label} style={{ color: item.color }}>
              <span>{item.label}</span>
              <strong>{item.value == null ? "-" : formatTseTickPrice(item.value)}</strong>
            </span>
          ))}
        </div>
      ) : null}
      {bars.length === 0 ? (
        <div className="chart-empty">
          <strong>CSVを読み込んでください</strong>
          <span>データはブラウザ内だけで処理され、サーバーへ送信されません。</span>
        </div>
      ) : null}
      {executionTimes.size > 0 ? (
        <div className="chart-execution-note">約定履歴は右ペインに記録されます</div>
      ) : null}
    </div>
  );
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "select" || tagName === "textarea" || target.isContentEditable;
}

function buildChartTimeMapping(bars: Bar[], timeframe: Timeframe): ChartTimeMapping {
  const stepSeconds = timeframe === "5m" ? 300 : 60;
  const originalToDisplay = new Map<number, UTCTimestamp>();
  const displayToOriginal = new Map<number, Bar>();
  const displayBars = bars.map((bar, index) => {
    const displayTime = (DISPLAY_TIME_ORIGIN + index * stepSeconds) as UTCTimestamp;
    const displayBar = { ...bar, time: displayTime };
    originalToDisplay.set(Number(bar.time), displayTime);
    displayToOriginal.set(Number(displayTime), bar);
    return displayBar;
  });

  return { displayBars, originalToDisplay, displayToOriginal };
}

function toDisplayIndicatorPoints(
  points: { time: Bar["time"]; value: number }[],
  originalToDisplay: Map<number, UTCTimestamp>,
): { time: Bar["time"]; value: number }[] {
  return points
    .map((point) => {
      const displayTime = originalToDisplay.get(Number(point.time));
      return displayTime == null ? null : { time: displayTime as Bar["time"], value: point.value };
    })
    .filter((point): point is { time: Bar["time"]; value: number } => point != null);
}

function toDisplayMarkers(markers: SeriesMarker<Time>[], originalToDisplay: Map<number, UTCTimestamp>): SeriesMarker<Time>[] {
  return markers.reduce<SeriesMarker<Time>[]>((next, marker) => {
    const displayTime = originalToDisplay.get(Number(marker.time));
    if (displayTime != null) {
      next.push({ ...marker, time: displayTime } as SeriesMarker<Time>);
    }
    return next;
  }, []);
}

function toDisplayMarkerLabels(
  labels: ExecutionMarkerLabel[],
  originalToDisplay: Map<number, UTCTimestamp>,
): ExecutionMarkerLabel[] {
  return labels.reduce<ExecutionMarkerLabel[]>((next, label) => {
    const displayTime = originalToDisplay.get(Number(label.time));
    if (displayTime != null) {
      next.push({ ...label, time: displayTime });
    }
    return next;
  }, []);
}

function buildIndicatorSeries(
  mode: IndicatorMode,
  maPeriods: [number, number, number],
  bollingerPeriod: number,
  sourceBars: Bar[],
  displayedBars: Bar[],
): Array<{ label: string; points: { time: Bar["time"]; value: number }[] }> {
  if (mode === "bb") {
    const period = normalizeBollingerPeriod(bollingerPeriod);
    const oneSigmaBands = calculateVisibleBollingerBands(sourceBars, displayedBars, period, 1);
    const twoSigmaBands = calculateVisibleBollingerBands(sourceBars, displayedBars, period, 2);
    const threeSigmaBands = calculateVisibleBollingerBands(sourceBars, displayedBars, period, 3);
    return [
      { label: `BB${period} +3σ`, points: threeSigmaBands.map((point) => ({ time: point.time, value: point.upper })) },
      { label: `BB${period} +2σ`, points: twoSigmaBands.map((point) => ({ time: point.time, value: point.upper })) },
      { label: `BB${period} +1σ`, points: oneSigmaBands.map((point) => ({ time: point.time, value: point.upper })) },
      { label: `BB${period}`, points: oneSigmaBands.map((point) => ({ time: point.time, value: point.middle })) },
      { label: `BB${period} -1σ`, points: oneSigmaBands.map((point) => ({ time: point.time, value: point.lower })) },
      { label: `BB${period} -2σ`, points: twoSigmaBands.map((point) => ({ time: point.time, value: point.lower })) },
      { label: `BB${period} -3σ`, points: threeSigmaBands.map((point) => ({ time: point.time, value: point.lower })) },
    ];
  }

  return maPeriods.map((period) => ({
    label: `MA${period}`,
    points: calculateVisibleMovingAverage(sourceBars, displayedBars, period),
  }));
}

function buildIndicatorLegendItems(
  series: Array<{ label: string; points: { time: Bar["time"]; value: number }[] }>,
  targetTime: Bar["time"] | null,
): IndicatorLegendItem[] {
  return series.map((item, index) => ({
    label: item.label,
    color: INDICATOR_COLORS[index],
    value: targetTime === null ? undefined : item.points.find((point) => point.time === targetTime)?.value,
  }));
}

function getIndicatorSeriesLabels(mode: IndicatorMode, maPeriods: [number, number, number], bollingerPeriod: number): string[] {
  if (mode === "bb") {
    const period = normalizeBollingerPeriod(bollingerPeriod);
    return [
      `BB${period} +3σ`,
      `BB${period} +2σ`,
      `BB${period} +1σ`,
      `BB${period}`,
      `BB${period} -1σ`,
      `BB${period} -2σ`,
      `BB${period} -3σ`,
    ];
  }
  return [`MA${maPeriods[0]}`, `MA${maPeriods[1]}`, `MA${maPeriods[2]}`];
}

function normalizeBollingerPeriod(period: number): number {
  return Number.isFinite(period) && period > 0 ? Math.round(period) : 25;
}

function zoomPriceScaleByWheel(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  container: HTMLDivElement,
  bars: Bar[],
  event: globalThis.WheelEvent,
) {
  const pricePaneHeight = chart.panes()[0]?.getHeight() ?? container.getBoundingClientRect().height;
  const localY = event.clientY - container.getBoundingClientRect().top;
  if (localY < 0 || localY > pricePaneHeight) return;

  const priceScale = series.priceScale();
  const currentRange = priceScale.getVisibleRange() ?? getFallbackPriceRange(bars);
  if (!currentRange) return;

  const span = currentRange.to - currentRange.from;
  if (!Number.isFinite(span) || span <= 0) return;

  const pointerPrice = Number(series.coordinateToPrice(localY));
  const anchor = Number.isFinite(pointerPrice) ? pointerPrice : (currentRange.from + currentRange.to) / 2;
  const clampedDelta = Math.max(-240, Math.min(240, event.deltaY));
  const factor = Math.exp(clampedDelta * 0.0018);
  const minSpan = Math.max(0.1, span * 0.02);
  const nextSpan = Math.max(minSpan, span * factor);
  const anchorRatio = span === 0 ? 0.5 : (anchor - currentRange.from) / span;
  const normalizedAnchorRatio = Math.min(0.95, Math.max(0.05, anchorRatio));

  priceScale.setAutoScale(false);
  priceScale.setVisibleRange({
    from: anchor - nextSpan * normalizedAnchorRatio,
    to: anchor + nextSpan * (1 - normalizedAnchorRatio),
  });
}

function getFallbackPriceRange(bars: Bar[]): { from: number; to: number } | null {
  if (bars.length === 0) return null;
  const low = Math.min(...bars.map((bar) => bar.low));
  const high = Math.max(...bars.map((bar) => bar.high));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const padding = Math.max(0.1, (high - low) * 0.08);
  return { from: low - padding, to: high + padding };
}

function resolveChartTime(time: Time | undefined): Bar["time"] | null {
  return typeof time === "number" && Number.isFinite(time) ? (time as Bar["time"]) : null;
}

function applyChartPaneHeights(chart: IChartApi, container: HTMLDivElement | null) {
  if (!container) return;
  const panes = chart.panes();
  if (panes.length < 2) return;

  const availableHeight = container.getBoundingClientRect().height;
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return;

  const volumeHeight = Math.min(
    VOLUME_PANE_MAX_HEIGHT,
    Math.max(VOLUME_PANE_MIN_HEIGHT, Math.round(availableHeight * VOLUME_PANE_RATIO)),
  );
  const priceHeight = Math.max(180, availableHeight - volumeHeight);
  panes[0]?.setHeight(priceHeight);
  panes[1]?.setHeight(volumeHeight);
}

function arrangeExecutionLabels(labels: PositionedExecutionLabel[], boundsHeight: number): PositionedExecutionLabel[] {
  if (labels.length <= 1) return labels;

  const minY = EXECUTION_LABEL_EDGE_PADDING;
  const maxY = Math.max(minY, boundsHeight - EXECUTION_LABEL_HEIGHT - EXECUTION_LABEL_EDGE_PADDING);
  const sorted = [...labels].sort((first, second) => first.labelY - second.labelY || first.markerY - second.markerY);
  const placed: PositionedExecutionLabel[] = [];

  for (const label of sorted) {
    let labelY = Math.min(maxY, Math.max(minY, label.labelY));
    for (const previous of placed) {
      if (labelsOverlapHorizontally(label, previous) && labelY < previous.labelY + previous.labelHeight + EXECUTION_LABEL_GAP) {
        labelY = previous.labelY + previous.labelHeight + EXECUTION_LABEL_GAP;
      }
    }
    placed.push({
      ...label,
      labelY,
      anchorY: labelY + label.labelHeight / 2,
    });
  }

  const bottomOverflow = Math.max(0, Math.max(...placed.map((label) => label.labelY + label.labelHeight)) - (boundsHeight - minY));
  if (bottomOverflow > 0) {
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const label = placed[index];
      const next = placed[index + 1];
      const maxShiftedY = next && labelsOverlapHorizontally(label, next)
        ? next.labelY - label.labelHeight - EXECUTION_LABEL_GAP
        : label.labelY - bottomOverflow;
      const labelY = Math.max(minY, Math.min(label.labelY - bottomOverflow, maxShiftedY));
      placed[index] = {
        ...label,
        labelY,
        anchorY: labelY + label.labelHeight / 2,
      };
    }
  }

  return placed.sort((first, second) => Number(first.id > second.id) - Number(first.id < second.id));
}

function labelsOverlapHorizontally(first: PositionedExecutionLabel, second: PositionedExecutionLabel): boolean {
  return first.labelX < second.labelX + second.labelWidth && second.labelX < first.labelX + first.labelWidth;
}

function ExecutionMarkerOutline({ outline }: { outline: PositionedExecutionMarkerOutline }) {
  const { markerX, markerY, radius } = outline;
  if (outline.shape === "circle") {
    return <circle className="execution-marker-outline" cx={markerX} cy={markerY} r={radius * 0.78} />;
  }
  if (outline.shape === "square") {
    const size = radius * 1.35;
    return <rect className="execution-marker-outline" x={markerX - size / 2} y={markerY - size / 2} width={size} height={size} rx={2} />;
  }

  const direction = outline.shape === "arrowDown" ? 1 : -1;
  const points = [
    `${markerX},${markerY + direction * radius}`,
    `${markerX - radius * 0.75},${markerY}`,
    `${markerX - radius * 0.3},${markerY}`,
    `${markerX - radius * 0.3},${markerY - direction * radius * 0.9}`,
    `${markerX + radius * 0.3},${markerY - direction * radius * 0.9}`,
    `${markerX + radius * 0.3},${markerY}`,
    `${markerX + radius * 0.75},${markerY}`,
  ].join(" ");
  return <polygon className="execution-marker-outline" points={points} />;
}

function formatDisplayAxisTime(time: unknown, labels: Map<number, string>): string {
  if (typeof time !== "number") return String(time);
  const datetime = labels.get(time);
  if (!datetime) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parseJstDate(datetime));
}

function formatDisplayCrosshairTime(time: unknown, labels: Map<number, string>): string {
  if (typeof time !== "number") return String(time);
  const datetime = labels.get(time);
  if (!datetime) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parseJstDate(datetime));
}

function parseJstDate(datetime: string): Date {
  return new Date(datetime.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function buildTrailingWhitespace(bars: Bar[], timeframe: Timeframe): WhitespaceData[] {
  const last = bars.at(-1);
  if (!last) return [];
  const stepSeconds = timeframe === "5m" ? 300 : 60;

  return Array.from({ length: 80 }, (_, index) => ({
    time: (last.time + (index + 1) * stepSeconds) as UTCTimestamp,
  }));
}

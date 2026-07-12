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
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import { calculateVisibleMovingAverage } from "../lib/bars";
import { buildExecutionMarkerLabels, buildExecutionMarkers } from "../lib/chartMarkers";
import type { Bar, Execution, ThemeMode, Timeframe } from "../types";

interface ChartPanelProps {
  bars: Bar[];
  maSourceBars: Bar[];
  executions: Execution[];
  maPeriods: [number, number, number];
  themeMode: ThemeMode;
  timeframe: Timeframe;
  viewportKey: string;
  canTogglePlayback: boolean;
  onTogglePlayback: () => void;
}

const MA_COLORS = ["#f59e0b", "#2563eb", "#7c3aed"] as const;
const VOLUME_PANE_RATIO = 0.24;
const VOLUME_PANE_MIN_HEIGHT = 92;
const VOLUME_PANE_MAX_HEIGHT = 170;
const EXECUTION_LABEL_EDGE_PADDING = 10;
const EXECUTION_LABEL_HEIGHT = 26;
const EXECUTION_LABEL_GAP = 7;

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

export function ChartPanel({
  bars,
  maSourceBars,
  executions,
  maPeriods,
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
  const isPointerOverChartRef = useRef(false);
  const [executionLabels, setExecutionLabels] = useState<PositionedExecutionLabel[]>([]);
  const [executionMarkerOutlines, setExecutionMarkerOutlines] = useState<PositionedExecutionMarkerOutline[]>([]);

  const executionTimes = useMemo(() => new Set(executions.map((execution) => execution.time)), [executions]);
  const isDark = themeMode === "dark";

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
        timeFormatter: formatCrosshairTime,
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
        tickMarkFormatter: formatAxisTime,
      },
      crosshair: {
        mode: 1,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
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
    const maSeries = maPeriods.map((period, index) =>
      chart.addSeries(LineSeries, {
        color: MA_COLORS[index],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        title: `MA${period}`,
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
  }, [isDark, maPeriods]);

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
    const trailingWhitespace = buildTrailingWhitespace(bars, timeframe);
    candleRef.current?.setData(
      [
        ...bars.map((bar) => ({
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
        ...bars.map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(22, 163, 74, 0.38)" : "rgba(220, 38, 38, 0.34)",
        })),
        ...trailingWhitespace,
      ],
    );
    maRefs.current.forEach((series, index) => {
      series.setData(calculateVisibleMovingAverage(maSourceBars, bars, maPeriods[index]));
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
  }, [bars, maSourceBars, maPeriods, timeframe, viewportKey]);

  useEffect(() => {
    markersRef.current?.setMarkers(buildExecutionMarkers(executions, timeframe));
  }, [executions, timeframe]);

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
        buildExecutionMarkerLabels(executions, timeframe)
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
      const outlines = buildExecutionMarkers(executions, timeframe)
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
    container.addEventListener("wheel", scheduleUpdate, { passive: true });
    scheduleUpdate();

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(scheduleUpdate);
      resizeObserver.disconnect();
      container.removeEventListener("pointerup", scheduleUpdate);
      container.removeEventListener("wheel", scheduleUpdate);
    };
  }, [bars, executions, timeframe]);

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
          {maPeriods.map((period, index) => (
            <span key={period} style={{ color: MA_COLORS[index] }}>
              MA{period}
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

function formatAxisTime(time: unknown): string {
  if (typeof time !== "number") return String(time);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time * 1000));
}

function formatCrosshairTime(time: unknown): string {
  if (typeof time !== "number") return String(time);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time * 1000));
}

function buildTrailingWhitespace(bars: Bar[], timeframe: Timeframe): WhitespaceData[] {
  const last = bars.at(-1);
  if (!last) return [];
  const stepSeconds = timeframe === "5m" ? 300 : 60;

  return Array.from({ length: 80 }, (_, index) => ({
    time: (last.time + (index + 1) * stepSeconds) as UTCTimestamp,
  }));
}

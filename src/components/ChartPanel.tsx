import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";
import { calculateVisibleMovingAverage } from "../lib/bars";
import type { Bar, Execution, ThemeMode, Timeframe } from "../types";

interface ChartPanelProps {
  bars: Bar[];
  maSourceBars: Bar[];
  executions: Execution[];
  maPeriods: [number, number, number];
  themeMode: ThemeMode;
  timeframe: Timeframe;
}

const MA_COLORS = ["#f59e0b", "#2563eb", "#7c3aed"] as const;

export function ChartPanel({ bars, maSourceBars, executions, maPeriods, themeMode, timeframe }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRefs = useRef<ISeriesApi<"Line">[]>([]);

  const executionTimes = useMemo(() => new Set(executions.map((execution) => execution.time)), [executions]);
  const isDark = themeMode === "dark";

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
      },
      grid: {
        vertLines: { color: isDark ? "#1e293b" : "#e2e8f0" },
        horzLines: { color: isDark ? "#1e293b" : "#e2e8f0" },
      },
      rightPriceScale: {
        borderColor: isDark ? "#334155" : "#cbd5e1",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: isDark ? "#334155" : "#cbd5e1",
        timeVisible: true,
        secondsVisible: false,
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
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: "#94a3b8",
    });
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
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;
    maRefs.current = maSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      maRefs.current = [];
    };
  }, [isDark, maPeriods]);

  useEffect(() => {
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
    const timeScale = chartRef.current?.timeScale();
    if (bars.length > 0) {
      timeScale?.setVisibleLogicalRange({
        from: Math.max(-8, bars.length - 90),
        to: Math.max(72, bars.length + 8),
      });
    } else {
      timeScale?.fitContent();
    }
  }, [bars, maSourceBars, maPeriods, timeframe]);

  return (
    <div className="chart-shell">
      <div ref={containerRef} className="chart-canvas" />
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

function buildTrailingWhitespace(bars: Bar[], timeframe: Timeframe): WhitespaceData[] {
  const last = bars.at(-1);
  if (!last) return [];
  const stepSeconds = timeframe === "5m" ? 300 : 60;

  return Array.from({ length: 80 }, (_, index) => ({
    time: (last.time + (index + 1) * stepSeconds) as UTCTimestamp,
  }));
}

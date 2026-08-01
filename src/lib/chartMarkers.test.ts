import { describe, expect, it } from "vitest";
import { alignHistoricalExecutionToBar, buildExecutionMarkerLabels, buildExecutionMarkers } from "./chartMarkers";
import type { Bar, Execution } from "../types";

const baseExecution: Execution = {
  id: "execution-1",
  orderId: "order-1",
  symbol: "TEST",
  side: "buy",
  tradeType: "marginOpen",
  quantity: 100,
  price: 1_000,
  time: "2024-01-04T09:01:30+09:00",
  realizedPnl: 0,
  note: "",
};

describe("buildExecutionMarkers", () => {
  it("moves an execution to the nearest bar that contains its actual price", () => {
    const aligned = alignHistoricalExecutionToBar(
      {
        ...baseExecution,
        time: "2026-07-31 09:27:43+0900",
        price: 5_312,
      },
      [
        makeBar("2026-07-31 09:27:00+0900", 5_295, 5_299, 5_260, 5_295),
        makeBar("2026-07-31 09:28:00+0900", 5_287, 5_314, 5_285, 5_287),
      ],
      "1m",
    );

    expect(aligned).toMatchObject({
      time: "2026-07-31 09:27:43+0900",
      price: 5_312,
      displayTime: "2026-07-31 09:28:00+0900",
      displayPrice: 5_312,
      displayAdjustment: "matched-bar",
    });
  });

  it("clamps a price to the primary bar when no nearby bar contains it", () => {
    const aligned = alignHistoricalExecutionToBar(
      { ...baseExecution, time: "2026-07-31 09:27:43+0900", price: 5_500 },
      [makeBar("2026-07-31 09:27:00+0900", 5_295, 5_299, 5_260, 5_295)],
      "1m",
    );

    expect(aligned).toMatchObject({ displayTime: "2026-07-31 09:27:00+0900", displayPrice: 5_299, displayAdjustment: "clamped-to-bar" });
  });

  it("keeps entry executions as side arrows", () => {
    const markers = buildExecutionMarkers(
      [
        baseExecution,
        { ...baseExecution, id: "execution-2", side: "sell", tradeType: "marginOpen" },
      ],
      "1m",
    );

    expect(markers[0]).toMatchObject({
      shape: "arrowUp",
      color: "#166534",
    });
    expect(markers[1]).toMatchObject({
      shape: "arrowDown",
      color: "#ec4899",
    });
    expect(markers[0]).not.toHaveProperty("text");
    expect(markers[1]).not.toHaveProperty("text");
  });

  it("uses a green circle for profitable closes", () => {
    const [marker] = buildExecutionMarkers(
      [
        {
          ...baseExecution,
          tradeType: "marginClose",
          side: "sell",
          realizedPnl: 12_000,
        },
      ],
      "1m",
    );

    expect(marker).toMatchObject({
      shape: "circle",
      color: "#22c55e",
    });
    expect(marker).not.toHaveProperty("text");
  });

  it("uses a red x-labeled marker for losing closes", () => {
    const [marker] = buildExecutionMarkers(
      [
        {
          ...baseExecution,
          tradeType: "marginClose",
          side: "sell",
          realizedPnl: -8_000,
        },
      ],
      "1m",
    );

    expect(marker).toMatchObject({
      shape: "square",
      color: "#ef4444",
    });
    expect(marker).not.toHaveProperty("text");
  });

  it("treats cash sells as close markers", () => {
    const [marker] = buildExecutionMarkers(
      [
        {
          ...baseExecution,
          tradeType: "cash",
          side: "sell",
          realizedPnl: 1_500,
        },
      ],
      "1m",
    );

    expect(marker).toMatchObject({
      shape: "circle",
      color: "#22c55e",
    });
  });

  it("scales marker size by quantity", () => {
    const markers = buildExecutionMarkers(
      [
        baseExecution,
        { ...baseExecution, id: "execution-2", quantity: 900 },
      ],
      "1m",
    );

    expect(markers[1].size).toBeGreaterThan(markers[0].size ?? 0);
  });

  it("builds detached labels for marker text", () => {
    const labels = buildExecutionMarkerLabels(
      [
        baseExecution,
        {
          ...baseExecution,
          id: "execution-2",
          side: "sell",
          tradeType: "marginClose",
          realizedPnl: 12_000,
        },
      ],
      "1m",
    );

    expect(labels[0]).toMatchObject({ text: "買 100", color: "#166534", verticalPreference: "below" });
    expect(labels[1]).toMatchObject({ text: "利確 +12,000円 100", color: "#22c55e", verticalPreference: "above" });
  });
});

function makeBar(datetime: string, open: number, high: number, low: number, close: number): Bar {
  return {
    time: Math.floor(Date.parse(datetime.replace(" ", "T").replace("+0900", "+09:00")) / 1000) as Bar["time"],
    datetime,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

import { describe, expect, it } from "vitest";
import { buildExecutionMarkerLabels, buildExecutionMarkers } from "./chartMarkers";
import type { Execution } from "../types";

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
      color: "#16a34a",
    });
    expect(markers[1]).toMatchObject({
      shape: "arrowDown",
      color: "#dc2626",
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

    expect(labels[0]).toMatchObject({ text: "買 100", color: "#16a34a", verticalPreference: "below" });
    expect(labels[1]).toMatchObject({ text: "利確 +12,000円 100", color: "#22c55e", verticalPreference: "above" });
  });
});

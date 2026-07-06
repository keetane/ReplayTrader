import { describe, expect, it } from "vitest";
import type { Bar } from "../types";
import {
  DEFAULT_MARGIN_REQUIREMENT_RATE,
  evaluateMaintenanceRatio,
  evaluateMarginBuyingPower,
  evaluateMarginExposure,
  INITIAL_TRADING_STATE,
  submitVirtualOrder,
  updateInitialCash,
} from "./trading";

const bar: Bar = {
  time: 1 as Bar["time"],
  datetime: "2026-02-19 09:05:00+0900",
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 1000,
};

describe("submitVirtualOrder", () => {
  it("starts with five million yen and allows changing initial capital", () => {
    const next = updateInitialCash(INITIAL_TRADING_STATE, 6_000_000);

    expect(INITIAL_TRADING_STATE.initialCash).toBe(5_000_000);
    expect(next.initialCash).toBe(6_000_000);
    expect(next.cash).toBe(6_000_000);
  });

  it("fills market orders at the current close and opens a virtual long position", () => {
    const next = submitVirtualOrder(INITIAL_TRADING_STATE, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "market",
      quantity: 100,
      bar,
      replayIndex: 0,
    });

    expect(next.orders[0].status).toBe("filled");
    expect(next.executions[0].price).toBe(105);
    expect(next.positions[0]).toMatchObject({
      symbol: "7203",
      side: "long",
      quantity: 100,
      averagePrice: 105,
      openedDate: "2026-02-19",
    });
  });

  it("rejects limit orders that are not inside the current bar range", () => {
    const next = submitVirtualOrder(INITIAL_TRADING_STATE, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "limit",
      quantity: 100,
      limitPrice: 120,
      bar,
      replayIndex: 0,
    });

    expect(next.orders[0].status).toBe("rejected");
    expect(next.positions).toHaveLength(0);
  });

  it("closes an existing long position and records realized PnL", () => {
    const opened = submitVirtualOrder(INITIAL_TRADING_STATE, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "market",
      quantity: 100,
      bar,
      replayIndex: 0,
    });
    const closed = submitVirtualOrder(opened, {
      symbol: "7203",
      side: "sell",
      tradeType: "marginClose",
      orderType: "limit",
      quantity: 100,
      limitPrice: 108,
      bar,
      replayIndex: 1,
    });

    expect(closed.positions).toHaveLength(0);
    expect(closed.realizedPnl).toBe(300);
  });

  it("rejects margin close orders above the closable quantity", () => {
    const opened = submitVirtualOrder(INITIAL_TRADING_STATE, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "market",
      quantity: 100,
      bar,
      replayIndex: 0,
    });
    const rejected = submitVirtualOrder(opened, {
      symbol: "7203",
      side: "sell",
      tradeType: "marginClose",
      orderType: "market",
      quantity: 200,
      bar,
      replayIndex: 1,
    });

    expect(rejected.orders[0].status).toBe("rejected");
    expect(rejected.positions[0].quantity).toBe(100);
  });

  it("rejects new orders when carried positions exist", () => {
    const opened = submitVirtualOrder(INITIAL_TRADING_STATE, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "market",
      quantity: 100,
      bar,
      replayIndex: 0,
    });
    const nextDayBar = { ...bar, datetime: "2026-02-20 09:05:00+0900" };
    const rejected = submitVirtualOrder(opened, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "market",
      quantity: 100,
      bar: nextDayBar,
      replayIndex: 1,
    });

    expect(rejected.orders[0].status).toBe("rejected");
    expect(rejected.positions).toHaveLength(1);
  });

  it("calculates margin exposure and maintenance ratio", () => {
    const opened = submitVirtualOrder(INITIAL_TRADING_STATE, {
      symbol: "7203",
      side: "buy",
      tradeType: "marginOpen",
      orderType: "market",
      quantity: 100,
      bar,
      replayIndex: 0,
    });
    const exposure = evaluateMarginExposure(opened.positions, 110);

    expect(exposure).toBe(11_000);
    expect(evaluateMaintenanceRatio(5_000_000, exposure)).toBeCloseTo(45454.5454);
  });

  it("calculates margin buying power from cash and current exposure", () => {
    expect(DEFAULT_MARGIN_REQUIREMENT_RATE).toBe(0.3);
    expect(evaluateMarginBuyingPower(5_000_000, 2_000_000)).toBeCloseTo(14_666_666.6667);
    expect(evaluateMarginBuyingPower(300_000, 1_500_000)).toBe(0);
  });
});

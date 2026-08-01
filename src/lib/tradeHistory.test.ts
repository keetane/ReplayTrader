import { describe, expect, it } from "vitest";
import type { SymbolData } from "../types";
import { historicalTradeMatchesSymbol, parseTradeHistoryText } from "./tradeHistory";

describe("parseTradeHistoryText", () => {
  it("keeps only confirmed fills and maps margin directions", () => {
    const result = parseTradeHistoryText(
      [
        "注文番号,アルゴ注文番号,状況,注文日時,注文期限,銘柄,銘柄コード・市場,取引,売買,注文方法,注文数量[株/口],約定数量[株/口],約定単価[円],約定代金[円]",
        "2,1-2,約定,07/23 09:02:06,2026/07/23,太陽誘電,6976 東証(SOR),信用返済,買埋,通常注文,100,100,12680.0,1268000",
        "1,1-1,約定,07/23 09:02:00,2026/07/23,太陽誘電,6976 東証(SOR),信用新規,売建,通常注文,100,100,12720.0,1272000",
        "3,3-1,取消済（出来無）,07/23 09:10:00,2026/07/23,太陽誘電,6976 東証(SOR),信用新規,買建,通常注文,100,0,-,0",
      ].join("\n"),
      "stockorder.csv",
    );

    expect(result.totalRows).toBe(3);
    expect(result.excludedRows).toBe(1);
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({
      ticker: "6976",
      companyName: "太陽誘電",
      tradeType: "marginOpen",
      side: "sell",
      product: "margin",
      quantity: 100,
      price: 12720,
      time: "2026-07-23 09:02:00+0900",
    });
    expect(result.trades[1]).toMatchObject({ tradeType: "marginClose", side: "buy", realizedPnl: 4000 });
  });

  it("rejects a history file without confirmed fills", () => {
    expect(() =>
      parseTradeHistoryText(
        [
          "状況,注文日時,注文期限,銘柄,銘柄コード・市場,取引,売買,注文方法,注文数量[株/口],約定数量[株/口],約定単価[円],約定代金[円]",
          "出来ず,07/23 09:02:00,2026/07/23,太陽誘電,6976 東証(SOR),信用新規,売建,通常注文,100,0,-,0",
        ].join("\n"),
      ),
    ).toThrow("約定済みの取引が見つかりませんでした");
  });

  it("matches broker names and tickers to user-facing symbol filenames", () => {
    const result = parseTradeHistoryText(
      [
        "状況,注文日時,注文期限,銘柄,銘柄コード・市場,取引,売買,注文方法,注文数量[株/口],約定数量[株/口],約定単価[円],約定代金[円]",
        "約定,07/23 09:02:00,2026/07/23,SCREEN,7735 東証(SOR),信用新規,売建,通常注文,100,100,12720.0,1272000",
      ].join("\n"),
    );
    const taiyo = makeSymbol("太陽誘電", "太陽誘電.csv");
    const screen = makeSymbol("SCREEN", "SCREEN.csv");
    const screenDownloaded = makeSymbol("SCREENホールディングス", "SCREENホールディングス.csv");
    const staleSymbolIdTrade = { ...result.trades[0], symbolId: "太陽誘電" };

    expect(historicalTradeMatchesSymbol(result.trades[0], screen)).toBe(true);
    expect(historicalTradeMatchesSymbol(result.trades[0], screenDownloaded)).toBe(true);
    expect(historicalTradeMatchesSymbol(result.trades[0], taiyo)).toBe(false);
    expect(historicalTradeMatchesSymbol(staleSymbolIdTrade, screen)).toBe(true);
    expect(historicalTradeMatchesSymbol(staleSymbolIdTrade, taiyo)).toBe(false);
    expect(historicalTradeMatchesSymbol({ ...result.trades[0], companyName: "ＳＣＲＥＥＮホールディングス" }, screen)).toBe(true);
    expect(historicalTradeMatchesSymbol({ ...result.trades[0], companyName: "SCREEN Materials" }, screen)).toBe(false);
    expect(historicalTradeMatchesSymbol(result.trades[0], screen, "2026-07-23")).toBe(true);
    expect(historicalTradeMatchesSymbol(result.trades[0], screen, "2026-07-24")).toBe(false);
    expect(historicalTradeMatchesSymbol({ ...result.trades[0], ticker: "9984", companyName: "ソフトバンクグループ" }, makeSymbol("SBG", "SBG.csv"))).toBe(true);
    expect(historicalTradeMatchesSymbol({ ...result.trades[0], ticker: "6525", companyName: "ＫＯＫＵＳＡＩＥＬＥＣＴＲＩＣ" }, makeSymbol("KOKUSAI", "KOKUSAI.csv"))).toBe(true);
    expect(historicalTradeMatchesSymbol({ ...result.trades[0], ticker: "5801", companyName: "古河電工" }, makeSymbol("古河電気", "古河電気.csv"))).toBe(true);
  });
});

function makeSymbol(id: string, fileName: string): SymbolData {
  return { id, fileName, bars: [], warnings: [], loadedAt: "" };
}

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

  it("maps settled trade history rows without execution times", () => {
    const result = parseTradeHistoryText(
      [
        "約定日,受渡日,銘柄コード,銘柄名,市場名称,口座区分,取引区分,売買区分,信用区分,弁済期限,数量［株］,単価［円］,手数料［円］,税金等［円］,諸費用［円］,税区分,受渡金額［円］,建約定日,建単価［円］",
        '"2026/7/22","2026/7/24","6976","太陽誘電","東証","特定","信用新規","売建","制度","6ヶ月","100","12,600.0","0","0","0","-","-","-","0.0"',
        '"2026/7/22","2026/7/24","6976","太陽誘電","東証","特定","信用返済","買埋","制度","6ヶ月","100","12,500.0","0","0","38","源徴あり","9,962","2026/7/22","12,600.0"',
      ].join("\n"),
      "tradehistory(JP).csv",
    );

    expect(result.totalRows).toBe(2);
    expect(result.excludedRows).toBe(0);
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0]).toMatchObject({
      ticker: "6976",
      companyName: "太陽誘電",
      exchange: "東証",
      tradeType: "marginOpen",
      side: "sell",
      quantity: 100,
      price: 12600,
      time: "2026-07-22 09:00:00+0900",
      status: "約定",
    });
    expect(result.trades[1]).toMatchObject({
      tradeType: "marginClose",
      side: "buy",
      realizedPnl: 9962,
    });
  });

  it("calculates unsettled same-day closes from matching opening lots instead of notional", () => {
    const result = parseTradeHistoryText(
      [
        "約定日,受渡日,銘柄コード,銘柄名,市場名称,口座区分,取引区分,売買区分,信用区分,弁済期限,数量［株］,単価［円］,手数料［円］,税金等［円］,諸費用［円］,税区分,受渡金額［円］,建約定日,建単価［円］",
        '"2026/9/14","2026/9/16","5801","古河電工","東証","特定","信用新規","買建","制度","6ヶ月","100","3,730.0","0","0","0","-","-","-","0.0"',
        '"2026/9/14","2026/9/16","5801","古河電工","東証","特定","信用返済","売埋","制度","6ヶ月","100","3,869.0","0","0","0","源徴あり","-","-","0.0"',
      ].join("\n"),
      "tradehistory-current.csv",
    );

    expect(result.trades[1]).toMatchObject({
      tradeType: "marginClose",
      side: "sell",
      notional: 386900,
      realizedPnl: 13900,
    });
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

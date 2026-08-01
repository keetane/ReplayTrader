import type { HistoricalTrade, PositionProduct, Side, SymbolData, TradeType } from "../types";

export interface TradeHistoryParseResult {
  trades: HistoricalTrade[];
  totalRows: number;
  excludedRows: number;
  warnings: string[];
}

export function historicalTradeMatchesSymbol(trade: HistoricalTrade, symbol: SymbolData, activeDate?: string): boolean {
  if (activeDate != null && trade.date !== activeDate) return false;
  const tradeTokens = [trade.ticker, trade.companyName]
    .flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)])
    .filter((value) => value.length >= 3);
  const symbolTokens = [symbol.id, symbol.fileName]
    .flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)])
    .filter((value) => value.length >= 3);
  const symbolStem = normalizeSymbolToken(symbol.fileName);
  const knownAliases = SYMBOL_FILE_ALIASES[symbolStem] ?? [];

  return [...symbolTokens, ...knownAliases].some((candidate) => tradeTokens.includes(candidate));
}

export class TradeHistoryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeHistoryParseError";
  }
}

const REQUIRED_COLUMNS = [
  "状況",
  "注文日時",
  "注文期限",
  "銘柄",
  "銘柄コード・市場",
  "取引",
  "売買",
  "注文方法",
  "注文数量[株/口]",
  "約定数量[株/口]",
  "約定単価[円]",
  "約定代金[円]",
] as const;

export function decodeTradeHistory(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes).replace(/^\uFEFF/, "");
    } catch {
      throw new TradeHistoryParseError("取引履歴CSVの文字コードを読み取れませんでした。");
    }
  }
}

export function parseTradeHistoryText(text: string, sourceName = "trade-history.csv"): TradeHistoryParseResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new TradeHistoryParseError("取引履歴CSVにデータ行がありません。");
  }

  const header = splitCsvLine(lines[0]).map((value) => value.trim());
  const columnIndex = new Map(header.map((name, index) => [name, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));
  if (missing.length > 0) {
    throw new TradeHistoryParseError(`取引履歴CSVの必須カラムが不足しています: ${missing.join(", ")}`);
  }

  const trades: HistoricalTrade[] = [];
  const warnings: string[] = [];
  const sourceId = normalizeSourceName(sourceName);
  let excludedRows = 0;

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cells = splitCsvLine(lines[rowIndex]);
    const lineNumber = rowIndex + 1;
    if (cells.length !== header.length) {
      throw new TradeHistoryParseError(`${lineNumber}行目: カラム数がヘッダと一致しません。`);
    }

    const status = cell(cells, columnIndex, "状況").trim();
    const quantity = parseNumber(cell(cells, columnIndex, "約定数量[株/口]"));
    const price = parseNumber(cell(cells, columnIndex, "約定単価[円]"));
    const notional = parseNumber(cell(cells, columnIndex, "約定代金[円]"));
    if (status !== "約定" || quantity == null || quantity <= 0 || price == null || notional == null || notional <= 0) {
      excludedRows += 1;
      continue;
    }

    const tickerAndExchange = cell(cells, columnIndex, "銘柄コード・市場").trim();
    const [ticker = "", ...exchangeParts] = tickerAndExchange.split(/\s+/);
    const companyName = cell(cells, columnIndex, "銘柄").trim();
    const orderDate = parseOrderDate(cell(cells, columnIndex, "注文期限"));
    const orderTime = parseOrderTime(cell(cells, columnIndex, "注文日時"));
    if (orderDate == null || orderTime == null || ticker.length === 0 || companyName.length === 0) {
      warnings.push(`${sourceName}: ${lineNumber}行目は日時または銘柄情報を解釈できないため除外しました。`);
      excludedRows += 1;
      continue;
    }

    const transaction = cell(cells, columnIndex, "取引").trim();
    const sideText = cell(cells, columnIndex, "売買").trim();
    const mapping = mapTrade(transaction, sideText);
    if (mapping == null) {
      warnings.push(`${sourceName}: ${lineNumber}行目の取引区分「${transaction}/${sideText}」は未対応のため除外しました。`);
      excludedRows += 1;
      continue;
    }

    const orderNumber = cell(cells, columnIndex, "注文番号").trim();
    const algoOrderNumber = cell(cells, columnIndex, "アルゴ注文番号").trim();
    const dateTime = `${orderDate} ${orderTime}+0900`;
    trades.push({
      id: `historical-${sourceId}-${ticker}-${dateTime}-${rowIndex}`,
      ticker,
      companyName,
      exchange: exchangeParts.join(" "),
      orderNumber: orderNumber || undefined,
      algoOrderNumber: algoOrderNumber || undefined,
      transaction,
      side: mapping.side,
      tradeType: mapping.tradeType,
      product: mapping.product,
      quantity: Math.trunc(quantity),
      price,
      notional,
      time: dateTime,
      date: orderDate,
      orderType: cell(cells, columnIndex, "注文方法").trim(),
      status,
    });
  }

  if (trades.length === 0) {
    throw new TradeHistoryParseError("約定済みの取引が見つかりませんでした。");
  }

  trades.sort((first, second) => Date.parse(toIsoDate(first.time)) - Date.parse(toIsoDate(second.time)));
  return { trades: assignHistoricalTradePnl(trades), totalRows: lines.length - 1, excludedRows, warnings };
}

interface HistoricalLot {
  symbolKey: string;
  side: "long" | "short";
  quantity: number;
  price: number;
}

function assignHistoricalTradePnl(trades: HistoricalTrade[]): HistoricalTrade[] {
  const lots: HistoricalLot[] = [];

  return trades.map((trade) => {
    const symbolKey = `${trade.ticker}:${trade.product}`;
    const isOpen = trade.tradeType === "marginOpen" || (trade.product === "cash" && trade.side === "buy");
    if (isOpen) {
      lots.push({
        symbolKey,
        side: trade.side === "buy" ? "long" : "short",
        quantity: trade.quantity,
        price: trade.price,
      });
      return trade;
    }

    const closingSide = trade.side === "buy" ? "short" : "long";
    let remaining = trade.quantity;
    let realizedPnl = 0;
    for (const lot of lots) {
      if (remaining <= 0) break;
      if (lot.symbolKey !== symbolKey || lot.side !== closingSide || lot.quantity <= 0) continue;
      const matchedQuantity = Math.min(remaining, lot.quantity);
      realizedPnl += closingSide === "long"
        ? (trade.price - lot.price) * matchedQuantity
        : (lot.price - trade.price) * matchedQuantity;
      lot.quantity -= matchedQuantity;
      remaining -= matchedQuantity;
    }

    return { ...trade, realizedPnl };
  });
}

function mapTrade(transaction: string, sideText: string): { side: Side; tradeType: TradeType; product: PositionProduct } | null {
  const side: Side | null = sideText.startsWith("買") ? "buy" : sideText.startsWith("売") ? "sell" : null;
  if (side == null) return null;

  const isMargin = transaction.includes("信用");
  const isClose = transaction.includes("返済") || sideText.includes("埋") || transaction.includes("売却");
  if (isMargin) {
    return { side, tradeType: isClose ? "marginClose" : "marginOpen", product: "margin" };
  }
  return { side, tradeType: isClose ? "cash" : "cash", product: "cash" };
}

function parseNumber(value: string): number | null {
  const normalized = value.trim().replace(/,/g, "");
  if (normalized === "" || normalized === "-") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseOrderDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseOrderTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, month, day, hour, minute, second] = match;
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31 || hourNumber > 23 || minuteNumber > 59 || secondNumber > 59) return null;
  return `${hour.padStart(2, "0")}:${minute}:${second}`;
}

function toIsoDate(value: string): string {
  return value.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function normalizeSourceName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase("ja-JP") || "trade-history";
}

function normalizeSymbolToken(value: string): string {
  return value
    .replace(/\.csv$/i, "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s_\-()（）]/g, "");
}

function normalizeCompanyAlias(value: string): string {
  return normalizeSymbolToken(value).replace(/(ホールディングス|ホールディング|holdings|holding|hd|グループ|group|株式会社|corporation|corp)$/i, "");
}

// The downloaded filenames are user-facing company names, while broker exports
// may use an abbreviation or a different legal company name for the same ticker.
const SYMBOL_FILE_ALIASES: Record<string, string[]> = {
  sbg: ["ソフトバンクグループ", "9984"].flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)]),
  kokusai: ["kokusai electric", "kokusai electric corporation", "6525"].flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)]),
  古河電気: ["古河電工", "5801"].flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)]),
  screenホールディングス: ["screen", "screenホールディングス", "7735"].flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)]),
  terradrone: ["テラドローン", "278a"].flatMap((value) => [normalizeSymbolToken(value), normalizeCompanyAlias(value)]),
};

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function cell(cells: string[], columnIndex: Map<string, number>, column: string): string {
  const index = columnIndex.get(column);
  return index == null ? "" : cells[index] ?? "";
}

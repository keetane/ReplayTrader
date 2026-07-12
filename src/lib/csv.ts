import type { Bar, ParseResult, SymbolData } from "../types";

const REQUIRED_COLUMNS = ["Datetime", "Close", "High", "Low", "Open", "Volume"] as const;

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export function symbolIdFromFileName(fileName: string): string {
  return fileName.replace(/\.csv$/i, "") || "UNKNOWN";
}

export function parseCsvText(text: string, fileName = "uploaded.csv"): ParseResult {
  const warnings: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new CsvParseError("CSVにデータ行がありません。");
  }

  const header = splitCsvLine(lines[0]).map((value) => value.trim());
  const columnIndex = new Map(header.map((name, index) => [name, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));

  if (missing.length > 0) {
    throw new CsvParseError(`必須カラムが不足しています: ${missing.join(", ")}`);
  }

  const barsByTime = new Map<number, Bar>();

  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const cells = splitCsvLine(lines[rowIndex]);
    const lineNumber = rowIndex + 1;
    if (cells.length !== header.length) {
      throw new CsvParseError(`${lineNumber}行目: カラム数がヘッダと一致しません。`);
    }
    const datetime = cell(cells, columnIndex, "Datetime").trim();
    const time = parseJstOffsetDate(datetime, lineNumber);
    const open = parseFiniteNumber(cell(cells, columnIndex, "Open"), "Open", lineNumber);
    const high = parseFiniteNumber(cell(cells, columnIndex, "High"), "High", lineNumber);
    const low = parseFiniteNumber(cell(cells, columnIndex, "Low"), "Low", lineNumber);
    const close = parseFiniteNumber(cell(cells, columnIndex, "Close"), "Close", lineNumber);
    const volume = parseFiniteNumber(cell(cells, columnIndex, "Volume"), "Volume", lineNumber);

    validateOhlc({ open, high, low, close }, lineNumber);

    if (barsByTime.has(time)) {
      warnings.push(`${lineNumber}行目: 同一Datetimeの重複を検出したため、後の行を採用しました。`);
    }

    barsByTime.set(time, {
      time: time as Bar["time"],
      datetime,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  const bars = Array.from(barsByTime.values()).sort((a, b) => a.time - b.time);
  if (bars.length === 0) {
    throw new CsvParseError("有効なバーがありません。");
  }

  return {
    symbol: {
      id: symbolIdFromFileName(fileName),
      fileName,
      bars,
      warnings,
      loadedAt: new Date().toISOString(),
    },
  };
}

export function buildSyntheticCsv(): string {
  const rows = ["Datetime,Close,High,Low,Open,Volume"];
  let price = 2800;
  const startUtc = Date.UTC(2024, 4, 17, 0, 0, 0);

  for (let i = 0; i < 220; i += 1) {
    const minute = i < 120 ? i : i + 90;
    const date = new Date(startUtc + minute * 60_000);
    const trend = Math.sin(i / 16) * 10 + Math.sin(i / 43) * 18;
    const open = price;
    const close = Math.max(50, open + trend * 0.08 + Math.sin(i * 1.7) * 2.4);
    const high = Math.max(open, close) + 3 + Math.abs(Math.sin(i / 7) * 4);
    const low = Math.min(open, close) - 3 - Math.abs(Math.cos(i / 9) * 3);
    const volume = Math.round(20_000 + Math.abs(Math.sin(i / 11)) * 110_000);
    price = close;
    rows.push(
      `${formatAsJstCsvDate(date)},${close.toFixed(1)},${high.toFixed(1)},${low.toFixed(1)},${open.toFixed(
        1,
      )},${volume}`,
    );
  }

  return rows.join("\n");
}

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

function cell(cells: string[], columnIndex: Map<string, number>, column: (typeof REQUIRED_COLUMNS)[number]): string {
  const index = columnIndex.get(column);
  return index === undefined ? "" : cells[index] ?? "";
}

function parseFiniteNumber(value: string, column: string, lineNumber: number): number {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new CsvParseError(`${lineNumber}行目: ${column} が空です。`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new CsvParseError(`${lineNumber}行目: ${column} が数値ではありません。`);
  }
  return parsed;
}

function parseJstOffsetDate(value: string, lineNumber: number): number {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})$/,
  );
  if (!match) {
    throw new CsvParseError(`${lineNumber}行目: Datetime は YYYY-MM-DD HH:mm:ss+0900 形式で指定してください。`);
  }

  const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);
  const localTime = Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber);
  const localDate = new Date(localTime);
  const validLocalDate =
    localDate.getUTCFullYear() === yearNumber &&
    localDate.getUTCMonth() === monthNumber - 1 &&
    localDate.getUTCDate() === dayNumber &&
    localDate.getUTCHours() === hourNumber &&
    localDate.getUTCMinutes() === minuteNumber &&
    localDate.getUTCSeconds() === secondNumber;
  if (!validLocalDate) {
    throw new CsvParseError(`${lineNumber}行目: Datetime は実在する日時を指定してください。`);
  }

  const offsetMs = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60_000 * (sign === "+" ? 1 : -1);
  return Math.floor((localTime - offsetMs) / 1000);
}

function validateOhlc(values: Pick<Bar, "open" | "high" | "low" | "close">, lineNumber: number): void {
  const max = Math.max(values.open, values.close, values.low);
  const min = Math.min(values.open, values.close, values.high);
  if (values.high < max) {
    throw new CsvParseError(`${lineNumber}行目: High が Open/Close/Low より小さいです。`);
  }
  if (values.low > min) {
    throw new CsvParseError(`${lineNumber}行目: Low が Open/Close/High より大きいです。`);
  }
}

function formatAsJstCsvDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${formatter.format(date).replace("T", " ")}+0900`;
}

export function summarizeSymbol(symbol: SymbolData): string {
  const first = symbol.bars[0]?.datetime ?? "-";
  const last = symbol.bars.at(-1)?.datetime ?? "-";
  return `${first} - ${last}`;
}

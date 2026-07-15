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
  let price = 9020;
  const startUtc = Date.UTC(2024, 4, 17, 0, 0, 0);

  for (let i = 0; i < 300; i += 1) {
    const minute = i < 150 ? i : i + 60;
    const date = new Date(startUtc + minute * 60_000);
    const open = price;
    const target = syntheticSemiconductorTargetPrice(i);
    const noise = deterministicNoise(i) - 0.5;
    const rawChange = (target - open) * 0.18 + noise * 34 + Math.sin(i * 1.9) * 7;
    const close = Math.max(50, Math.round(open + clamp(rawChange, -78, 78)));
    const eventVolatility = gaussian(i, 52, 14) * 18 + gaussian(i, 198, 24) * 24 + gaussian(i, 282, 18) * 14;
    const high = Math.round(Math.max(open, close) + 9 + Math.abs(Math.sin(i / 5.5) * 18) + eventVolatility);
    const low = Math.round(Math.min(open, close) - 9 - Math.abs(Math.cos(i / 6.5) * 16) - eventVolatility * 0.75);
    const volume = Math.round(syntheticSemiconductorVolume(i) / 100) * 100;
    price = close;
    rows.push(
      `${formatAsJstCsvDate(date)},${close},${high},${low},${open},${volume}`,
    );
  }

  return rows.join("\n");
}

function syntheticSemiconductorTargetPrice(index: number): number {
  const stage =
    index < 50
      ? -260 * (index / 50)
      : index < 120
        ? -260 + 170 * ((index - 50) / 70)
        : index < 190
          ? -90 + 330 * ((index - 120) / 70)
          : index < 250
            ? 240 + 190 * ((index - 190) / 60)
            : 430 - 150 * ((index - 250) / 50);
  const cycle = Math.sin(index / 7.2) * 48 + Math.sin(index / 19) * 72 + Math.sin(index / 2.9) * 18;
  const event = -110 * gaussian(index, 55, 11) + 170 * gaussian(index, 202, 20) - 80 * gaussian(index, 274, 15);
  return 9020 + stage + cycle + event;
}

function syntheticSemiconductorVolume(index: number): number {
  const base = 110_000;
  const openingRush = 1_150_000 * gaussian(index, 5, 13);
  const morningSelloff = 520_000 * gaussian(index, 55, 18);
  const lunchReopen = 420_000 * gaussian(index, 152, 12);
  const afternoonBreakout = 980_000 * gaussian(index, 204, 23);
  const closingFlow = 640_000 * gaussian(index, 288, 18);
  const pulse = Math.abs(Math.sin(index / 3.7)) * 95_000 + Math.abs(Math.sin(index / 17)) * 70_000;
  return base + openingRush + morningSelloff + lunchReopen + afternoonBreakout + closingFlow + pulse;
}

function gaussian(value: number, center: number, width: number): number {
  return Math.exp(-((value - center) ** 2) / (2 * width ** 2));
}

function deterministicNoise(seed: number): number {
  return fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

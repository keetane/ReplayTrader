import { expect, test, type Page } from "@playwright/test";

const SAMPLE_DATE = "2024-05-17";

async function openApp(page: Page) {
  await page.goto("/");
}

async function loadSyntheticSample(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: "架空サンプルを生成" }).click();

  await expect(page.getByText("架空サンプルを生成しました。実在相場データではありません。")).toBeVisible();
  await expect(page.getByRole("button", { name: /DEMO_架空銘柄_1m/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DEMO_架空銘柄_1m" })).toBeVisible();
}

function chartHeader(page: Page) {
  return page.locator(".chart-header");
}

function dataCard(page: Page) {
  return page.locator(".data-card");
}

function summaryCard(page: Page) {
  return page.locator(".summary-card");
}

test.describe("Replay Trader major flows", () => {
  test("初期表示ではCSV未選択の案内と基本操作が表示される", async ({ page }) => {
    await openApp(page);

    await expect(page).toHaveTitle("Replay Trader");
    await expect(page.getByRole("heading", { name: "Replay Trader" })).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "CSVファイルを選択 1分足 OHLCV / 複数選択可" })).toBeVisible();
    await expect(page.getByRole("button", { name: "架空サンプルを生成" })).toBeVisible();
    await expect(page.getByText("CSVを選択するか、架空サンプルを生成してください。")).toBeVisible();
    await expect(page.getByText("読み込み済みCSVはありません。")).toBeVisible();
    await expect(page.getByText("CSV読込後に日付を選択できます。")).toBeVisible();
    await expect(page.getByText("CSVを読み込んでください").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "再生" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "保存" })).toBeDisabled();
    await expect(page.getByText("建玉はありません。")).toBeVisible();
    await expect(page.getByText("履歴はありません。")).toBeVisible();
  });

  test("架空サンプル生成で銘柄、チャート、口座サマリーが有効になる", async ({ page }) => {
    await loadSyntheticSample(page);

    await expect(page.getByText(`未指定のため、今日に最も近い ${SAMPLE_DATE} を表示中`)).toBeVisible();
    await expect(chartHeader(page).getByText(`${SAMPLE_DATE} 09:00:00+0900`, { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 220")).toBeVisible();
    await expect(page.getByText("MA5")).toBeVisible();
    await expect(page.getByText("MA25")).toBeVisible();
    await expect(page.getByText("MA60")).toBeVisible();
    await expect(page.getByRole("button", { name: "再生" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "保存" })).toBeEnabled();
    await expect(summaryCard(page).getByText("仮想資金")).toBeVisible();
    await expect(summaryCard(page).getByText("5,000,000 円")).toHaveCount(3);
    await expect(summaryCard(page).getByText("信用建余力", { exact: true })).toBeVisible();
    await expect(summaryCard(page).getByText("16,666,667 円")).toBeVisible();
    await expect(summaryCard(page).getByText("信用維持率")).toBeVisible();
  });

  test("初期資金を変更できる", async ({ page }) => {
    await loadSyntheticSample(page);
    const initialCashInput = page.locator(".capital-field input");

    await expect(initialCashInput).toBeVisible();
    await initialCashInput.fill("7000000");

    await expect(initialCashInput).toHaveValue("7000000");
    await expect(summaryCard(page).getByText("7,000,000 円")).toHaveCount(3);
    await expect(summaryCard(page).getByText("23,333,333 円")).toBeVisible();
  });

  test("日付未指定ではサンプルデータの最近傍日を表示する", async ({ page }) => {
    await loadSyntheticSample(page);

    await expect(page.getByLabel("リプレイ日")).toHaveValue("");
    await expect(page.getByText(`未指定のため、今日に最も近い ${SAMPLE_DATE} を表示中`)).toBeVisible();
    await expect(dataCard(page).getByText(SAMPLE_DATE, { exact: true })).toBeVisible();
  });

  test("存在しない日付を指定すると最も近い日付へフォールバックする", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.getByLabel("リプレイ日").fill("2024-05-19");

    await expect(page.getByText(`指定日にデータがないため、最も近い ${SAMPLE_DATE} を表示中`)).toBeVisible();
    await expect(chartHeader(page).getByText(`${SAMPLE_DATE} 09:00:00+0900`, { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 220")).toBeVisible();
  });

  test("1分足と5分足を切り替えられる", async ({ page }) => {
    await loadSyntheticSample(page);

    const timeframe = page.getByLabel("時間足");
    await expect(timeframe).toHaveValue("1m");
    await expect(dataCard(page).getByText("1分足", { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 220")).toBeVisible();

    await timeframe.selectOption("5m");

    await expect(timeframe).toHaveValue("5m");
    await expect(dataCard(page).getByText("5分足", { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 44")).toBeVisible();

    await timeframe.selectOption("1m");

    await expect(timeframe).toHaveValue("1m");
    await expect(dataCard(page).getByText("1分足", { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 220")).toBeVisible();
  });

  test("テーマは初期表示でダーク、操作でライトへ切り替わる", async ({ page }) => {
    await openApp(page);

    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "ライト" })).toBeVisible();

    await page.getByRole("button", { name: "ライト" }).click();

    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "ダーク" })).toBeVisible();
  });
});

import { expect, test, type Locator, type Page } from "@playwright/test";

const SAMPLE_DATE = "2024-05-17";

async function openApp(page: Page) {
  await page.goto("/");
}

async function loadSyntheticSample(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
  await page.getByRole("button", { name: "架空サンプルを生成" }).click();

  await expect(page.getByRole("button", { name: /DEMO_半導体風_1m/ })).toBeVisible();
  await page.getByRole("button", { name: /DEMO_半導体風_1m/ }).click();
  await expect(page.getByRole("heading", { name: "DEMO_半導体風_1m" })).toBeVisible();
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

function summaryMetric(page: Page, label: string) {
  return summaryCard(page).locator(".metric").filter({ has: page.getByText(label, { exact: true }) }).locator("strong");
}

function positionsSection(page: Page) {
  return page.locator(".table-section").filter({ has: page.getByRole("heading", { name: "建玉" }) });
}

function executionsSection(page: Page) {
  return page.locator(".table-section").filter({ has: page.getByRole("heading", { name: "約定履歴" }) });
}

async function expectTimeline(page: Page, date: string, time: string) {
  const timestamp = page.locator(".timeline-row > div").first();
  await expect(timestamp.locator("strong")).toHaveText(date);
  await expect(timestamp.locator("span")).toHaveText(time);
}

async function pricesMatchCurrent(targetInput: Locator, stopInput: Locator, currentValue: Locator) {
  const current = (await currentValue.innerText()).replace(/,/g, "");
  return (await targetInput.inputValue()) === current && (await stopInput.inputValue()) === current;
}

async function openOrderModal(page: Page) {
  await page.getByRole("button", { name: "注文パネル" }).click();
  const dialog = page.getByRole("dialog", { name: "仮想注文" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("Replay Trader major flows", () => {
  test("初期表示ではCSV未選択の案内と基本操作が表示される", async ({ page }) => {
    await openApp(page);

    await expect(page).toHaveTitle("Replay Trader");
    await expect(page.getByRole("heading", { name: "Replay Trader" })).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "分足CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "約定・取引履歴CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "実約定を非表示" })).toBeVisible();
    await page.getByRole("button", { name: "実約定を非表示" }).click();
    await expect(page.getByRole("button", { name: "実約定を表示" })).toBeVisible();
    await page.getByRole("button", { name: "実約定を表示" }).click();
    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await expect(page.getByRole("button", { name: "架空サンプルを生成" })).toBeVisible();
    await expect(page.getByText("CSV読込後に日付を選択できます。")).toBeVisible();
    await expect(page.getByText("読み込み済みCSVはありません。")).toBeVisible();
    await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
    await expect(page.getByText("CSVを読み込んでください").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "再生" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "買い", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "売り", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "注文パネル" })).toBeVisible();
    await expect(page.getByRole("button", { name: "チャートをスクショ保存" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "買い注文" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "売り注文" })).toHaveCount(0);
    await expect(page.getByText("建玉はありません。")).toBeVisible();
    await expect(executionsSection(page).getByText("履歴はありません。", { exact: true })).toBeVisible();
  });

  test("言語ボタンで主要UIを英語表記に切り替えられる", async ({ page }) => {
    await openApp(page);

    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await page.getByRole("button", { name: "English" }).click();

    await expect(page.getByRole("button", { name: "日本語" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bar CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Orders / trades CSV" })).toBeVisible();
    await expect(page.getByText("You can choose a date after loading a CSV file.")).toBeVisible();
    await expect(page.getByText("No CSV files loaded.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate sample" })).toBeVisible();
    await expect(page.getByText("No investment advice")).toHaveCount(0);
    await expect(page.getByText("Browser-only processing")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();

    await page.getByRole("button", { name: "Generate sample" }).click();

    await expect(page.getByRole("button", { name: "Order panel" })).toBeVisible();
    await expect(page.getByText("Account Summary")).toBeVisible();
    await expect(page.getByText("Margin buying power", { exact: true })).toBeVisible();
  });

  test("CSVファイルをドラッグアンドドロップで読み込める", async ({ page }) => {
    await openApp(page);
    const csvText = [
      "Datetime,Close,High,Low,Open,Volume",
      "2024-05-16 14:59:00+0900,90,91,89,90,800",
      "2024-05-17 09:00:00+0900,101,103,99,100,1000",
      "2024-05-17 09:01:00+0900,102,104,100,101,1200",
    ].join("\n");
    const dataTransfer = await page.evaluateHandle((csv) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([csv], "DND_TEST.csv", { type: "text/csv" }));
      return transfer;
    }, csvText);
    const dropZone = page.locator(".bars-upload-button");

    await dropZone.dispatchEvent("dragover", { dataTransfer });
    await expect(dropZone).toHaveClass(/dragging/);
    await dropZone.dispatchEvent("drop", { dataTransfer });

    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await expect(page.getByRole("button", { name: /DND_TEST/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "DND_TEST" })).toBeVisible();
    await expect(chartHeader(page).getByText("2024-05-17 09:00:00+0900", { exact: true })).toBeVisible();
    await expect(page.getByText("当日始 100")).toBeVisible();
    await expect(page.getByText("前日比 +11 (+12.2%)")).toBeVisible();
    await expect(page.getByText("当日高 103")).toBeVisible();
    await expect(page.getByText("当日安 99")).toBeVisible();
    const symbolRow = page.getByRole("button", { name: /DND_TEST/ });
    await expect(symbolRow.getByText("前日比 +10 (+11.1%)")).toBeVisible();
    await expect(symbolRow.getByText("3 行")).toBeVisible();
    await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
  });

  test("最新日と同じ解決日・同じ入力値を指定した場合と同一CSV再読込時にも日付へジャンプする", async ({ page }) => {
    await openApp(page);
    const csvText = [
      "Datetime,Close,High,Low,Open,Volume",
      "2026-09-11 09:00:00+0900,100,101,99,100,1000",
      "2026-09-11 09:01:00+0900,101,102,100,100,1200",
      "2026-09-15 09:00:00+0900,110,111,109,110,1400",
      "2026-09-15 09:01:00+0900,111,112,110,110,1600",
    ].join("\n");
    const fileInput = page.locator('input[type="file"]').nth(0);
    const replayDate = page.getByLabel("ジャンプ先の日付");

    await fileInput.setInputFiles({ name: "LATEST_DATE.csv", mimeType: "text/csv", buffer: Buffer.from(csvText) });
    await expectTimeline(page, "2026-09-15", "09:00:00");

    await page.getByRole("button", { name: "先頭へ" }).click();
    await expectTimeline(page, "2026-09-11", "09:00:00");
    const firstDateChart = await page.locator(".chart-canvas").screenshot();
    await replayDate.fill("2026-09-15");
    await expectTimeline(page, "2026-09-15", "09:00:00");

    await page.getByRole("button", { name: "先頭へ" }).click();
    await replayDate.click();
    await expectTimeline(page, "2026-09-15", "09:00:00");
    await expect.poll(async () => page.locator(".chart-canvas").screenshot()).not.toEqual(firstDateChart);

    await replayDate.fill("");
    await page.getByRole("button", { name: "先頭へ" }).click();
    await fileInput.setInputFiles({ name: "LATEST_DATE.csv", mimeType: "text/csv", buffer: Buffer.from(csvText) });
    await expectTimeline(page, "2026-09-15", "09:00:00");
  });

  test("約定済みの取引履歴だけを該当銘柄のリプレイへ表示する", async ({ page }) => {
    await openApp(page);
    const barCsv = [
      "Datetime,Close,High,Low,Open,Volume",
      "2026-07-23 09:00:00+0900,12720,12730,12700,12710,1000",
      "2026-07-23 09:01:00+0900,12690,12720,12680,12720,1000",
      "2026-07-23 09:02:00+0900,12680,12690,12670,12690,1000",
    ].join("\n");
    const historyCsv = [
      "注文番号,アルゴ注文番号,状況,注文日時,注文期限,銘柄,銘柄コード・市場,取引,売買,注文方法,注文数量[株/口],約定数量[株/口],約定単価[円],約定代金[円]",
      "2,1-2,約定,07/23 09:02:06,2026/07/23,太陽誘電,6976 東証(SOR),信用返済,買埋,通常注文,100,100,12680.0,1268000",
      "1,1-1,約定,07/23 09:02:00,2026/07/23,太陽誘電,6976 東証(SOR),信用新規,売建,通常注文,100,100,12720.0,1272000",
      "3,3-1,取消済（出来無）,07/23 09:10:00,2026/07/23,太陽誘電,6976 東証(SOR),信用新規,買建,通常注文,100,0,-,0",
    ].join("\n");

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles({ name: "太陽誘電.csv", mimeType: "text/csv", buffer: Buffer.from(barCsv) });
    await fileInputs.nth(1).setInputFiles({ name: "stockorder.csv", mimeType: "text/csv", buffer: Buffer.from(historyCsv) });

    const historicalSection = page.locator(".historical-trades-section");
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(historicalSection.getByRole("cell", { name: "信用新規売" })).toBeVisible();
    await expect(historicalSection.getByRole("cell", { name: "信用返済買" })).toBeVisible();
    await expect(page.locator(".execution-label")).toHaveCount(2);
  });

  test("tradehistory形式の取引履歴を価格に対応する足へ表示する", async ({ page }) => {
    await openApp(page);
    const barCsv = [
      "Datetime,Close,High,Low,Open,Volume",
      "2026-07-22 09:00:00+0900,12600,12610,12590,12600,1000",
      "2026-07-22 09:01:00+0900,12690,12710,12680,12690,1000",
    ].join("\n");
    const historyCsv = [
      "約定日,受渡日,銘柄コード,銘柄名,市場名称,口座区分,取引区分,売買区分,信用区分,弁済期限,数量［株］,単価［円］,手数料［円］,税金等［円］,諸費用［円］,税区分,受渡金額［円］,建約定日,建単価［円］",
      '"2026/7/22","2026/7/24","6976","太陽誘電","東証","特定","信用新規","売建","制度","6ヶ月","100","12,600.0","0","0","0","-","-","-","0.0"',
      '"2026/7/22","2026/7/24","6976","太陽誘電","東証","特定","信用返済","買埋","制度","6ヶ月","100","12,690.0","0","0","0","源徴あり","-","-","0.0"',
    ].join("\n");

    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(0).setInputFiles({ name: "太陽誘電.csv", mimeType: "text/csv", buffer: Buffer.from(barCsv) });
    await fileInputs.nth(1).setInputFiles({ name: "tradehistory(JP).csv", mimeType: "text/csv", buffer: Buffer.from(historyCsv) });

    await expect(page.locator(".execution-label")).toHaveCount(1);
    await page.getByRole("button", { name: "次へ" }).click();
    await expect(page.locator(".execution-label")).toHaveCount(2);
    await expect(page.locator(".execution-label").filter({ hasText: "損失 -9,000円" })).toBeVisible();
    await expect(page.locator(".historical-trades-section").getByRole("cell", { name: "信用新規売" })).toBeVisible();
    await expect(page.locator(".historical-trades-section").getByRole("cell", { name: "信用返済買" })).toBeVisible();
  });

  test("架空サンプル生成で銘柄、チャート、口座サマリーが有効になる", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await expect(page.getByText(`未指定のため、今日に最も近い ${SAMPLE_DATE} を表示中`)).toBeVisible();
    await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
    await expect(chartHeader(page).getByText(new RegExp(`${SAMPLE_DATE} 09:00:[0-5][0-9]\\+0900`))).toBeVisible();
    await expect(page.getByText("1 / 300")).toBeVisible();
    await expect(page.getByText("MA5")).toBeVisible();
    await expect(page.getByText("MA25")).toBeVisible();
    await expect(page.getByText("MA60")).toBeVisible();
    await expect(page.getByText("当日始")).toBeVisible();
    await expect(chartHeader(page).getByText("前日比")).toBeVisible();
    await expect(page.getByText("当日高")).toBeVisible();
    await expect(page.getByText("当日安")).toBeVisible();
    await expect(page.getByRole("button", { name: "再生" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
    const screenshotDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "チャートをスクショ保存" }).click();
    await expect((await screenshotDownload).suggestedFilename()).toMatch(/\.png$/);
    await expect(summaryCard(page).getByText("仮想資金")).toBeVisible();
    await expect(summaryCard(page).getByText("買い建玉損益")).toBeVisible();
    await expect(summaryCard(page).getByText("売り建玉損益")).toBeVisible();
    await expect(summaryCard(page).getByText("建玉損益合計")).toBeVisible();
    await expect(summaryCard(page).getByText("トータル損益")).toBeVisible();
    await expect(summaryMetric(page, "仮想資金")).toHaveText("5,000,000 円");
    await expect(summaryMetric(page, "現金残高")).toHaveText("5,000,000 円");
    await expect(summaryMetric(page, "評価額")).toHaveText("5,000,000 円");
    await expect(summaryCard(page).getByText("信用建余力", { exact: true })).toBeVisible();
    await expect(summaryCard(page).getByText("16,666,667 円")).toBeVisible();
    await expect(summaryCard(page).getByText("信用維持率")).toBeVisible();
  });

  test("初期資金を変更できる", async ({ page }) => {
    await loadSyntheticSample(page);
    const initialCashSelect = page.getByLabel("初期資金");

    await expect(initialCashSelect).toBeVisible();
    await expect(initialCashSelect).toHaveValue("5000000");
    await initialCashSelect.selectOption("1000000");

    await expect(initialCashSelect).toHaveValue("1000000");
    await expect(summaryMetric(page, "仮想資金")).toHaveText("1,000,000 円");
    await expect(summaryMetric(page, "現金残高")).toHaveText("1,000,000 円");
    await expect(summaryMetric(page, "評価額")).toHaveText("1,000,000 円");
    await expect(summaryCard(page).getByText("3,333,333 円")).toBeVisible();
  });

  test("注文数量は100株単位で増減する", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);
    const quantityInput = dialog.locator("label").filter({ hasText: "数量" }).locator("input");

    await expect(quantityInput).toHaveValue("100");
    await quantityInput.focus();
    await page.keyboard.press("ArrowUp");

    await expect(quantityInput).toHaveValue("200");
  });

  test("指値価格に現在値を反映し、呼値単位で上下できる", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);
    const priceField = dialog.locator(".price-field").filter({ hasText: "指値価格" });
    const priceInput = priceField.locator("input");

    await dialog.getByRole("button", { name: "指値", exact: true }).click();
    await priceField.getByRole("button", { name: "現在値" }).click();

    await expect(priceInput).toHaveValue("9009");

    await priceField.getByRole("button", { name: "指値価格を1呼値上げる" }).click();
    await expect(priceInput).toHaveValue("9010");

    await priceField.getByRole("button", { name: "指値価格を1呼値下げる" }).click();
    await expect(priceInput).toHaveValue("9009");
  });

  test("現物保有と信用建玉を別行で表示する", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);
    const tradeType = dialog.getByLabel("取引区分");

    await tradeType.selectOption("cash");
    await dialog.getByRole("button", { name: "買い注文" }).click();
    await tradeType.selectOption("marginOpen");
    await dialog.getByRole("button", { name: "買い注文" }).click();

    const positions = positionsSection(page);
    await expect(positions.getByRole("cell", { name: "現物" })).toBeVisible();
    await expect(positions.getByRole("cell", { name: "信用" })).toBeVisible();
    await expect(positions.getByRole("cell", { name: "保有" })).toBeVisible();
    await expect(positions.getByRole("cell", { name: "買建" })).toBeVisible();
    await expect(positions.getByRole("columnheader", { name: "損益" })).toBeVisible();
    await expect(summaryCard(page).getByText("現物評価額")).toBeVisible();
    await expect(summaryCard(page).getByText("信用建玉評価額")).toBeVisible();
    await expect(page.getByText("約定履歴は右ペインに記録されます")).toBeVisible();
  });

  test("チャート上の約定ラベルをドラッグで移動できる", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);
    await dialog.getByRole("button", { name: "買い注文" }).click();
    await dialog.getByRole("button", { name: "閉じる" }).click();

    const label = page.locator(".execution-label").first();
    await expect(label).toBeVisible();
    const before = await label.boundingBox();
    expect(before).not.toBeNull();

    await page.mouse.move((before?.x ?? 0) + 12, (before?.y ?? 0) + 12);
    await page.mouse.down();
    await page.mouse.move((before?.x ?? 0) + 92, (before?.y ?? 0) + 44, { steps: 8 });
    await page.mouse.up();

    const after = await label.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(20);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeGreaterThan(10);
  });

  test("IFDOCOの利確価格と損切価格は現在値に同期する", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);

    await dialog.getByRole("button", { name: "IFDOCO" }).click();
    const targetInput = dialog.locator(".price-field").filter({ hasText: "利確価格" }).locator("input");
    const stopInput = dialog.locator(".price-field").filter({ hasText: "損切価格" }).locator("input");
    const currentValue = dialog.locator(".order-modal-status .metric").filter({ hasText: "現在値" }).locator("strong");

    await expect.poll(async () => pricesMatchCurrent(targetInput, stopInput, currentValue)).toBe(true);

    await page.getByRole("button", { name: "次へ" }).click();

    await expect.poll(async () => pricesMatchCurrent(targetInput, stopInput, currentValue)).toBe(true);
  });

  test("注文モーダルでIFDOCOを入力できる", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);

    await dialog.getByRole("button", { name: "IFDOCO" }).click();
    await dialog.getByLabel("新規区分").selectOption("marginOpen");
    await dialog.locator("label").filter({ hasText: "利確価格" }).locator("input").fill("9100");
    await dialog.locator("label").filter({ hasText: "損切価格" }).locator("input").fill("8900");
    await dialog.getByRole("button", { name: "買いIFDOCO" }).click();

    await expect(dialog.getByText("IFDOCO待機")).toBeVisible();
    await expect(dialog.getByText("1 件")).toBeVisible();
  });

  test("注文パネルはボタン近くに開き、ドラッグで移動できる", async ({ page }) => {
    await loadSyntheticSample(page);
    const openButton = page.getByRole("button", { name: "注文パネル" });
    const buttonBox = await openButton.boundingBox();
    const dialog = await openOrderModal(page);
    const initialBox = await dialog.boundingBox();

    expect(buttonBox).not.toBeNull();
    expect(initialBox).not.toBeNull();
    const buttonRight = (buttonBox?.x ?? 0) + (buttonBox?.width ?? 0);
    const dialogRight = (initialBox?.x ?? 0) + (initialBox?.width ?? 0);
    expect(Math.abs(dialogRight - buttonRight)).toBeLessThan(8);
    expect(initialBox?.y ?? 0).toBeGreaterThanOrEqual(0);
    expect(Math.abs((initialBox?.y ?? 0) - (buttonBox?.y ?? 0))).toBeLessThan(28);

    await page.mouse.move((initialBox?.x ?? 0) + 90, (initialBox?.y ?? 0) + 22);
    await page.mouse.down();
    await page.mouse.move(420, 130, { steps: 10 });
    await page.mouse.up();
    const movedBox = await dialog.boundingBox();

    expect(movedBox).not.toBeNull();
    expect(movedBox?.x ?? 0).toBeLessThan((initialBox?.x ?? 0) - 80);
  });

  test("日付未指定ではサンプルデータの最近傍日を表示する", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await expect(page.getByLabel("ジャンプ先の日付")).toHaveValue("");
    await expect(page.getByText(`未指定のため、今日に最も近い ${SAMPLE_DATE} を表示中`)).toBeVisible();
    await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
  });

  test("存在しない日付を指定すると最も近い日付へフォールバックする", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await page.getByLabel("ジャンプ先の日付").fill("2024-05-19");

    await expect(page.getByText(`指定日にデータがないため、最も近い ${SAMPLE_DATE} を表示中`)).toBeVisible();
    await expect(chartHeader(page).getByText(new RegExp(`${SAMPLE_DATE} 09:00:[0-5][0-9]\\+0900`))).toBeVisible();
    await expect(page.getByText("1 / 300")).toBeVisible();
    await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
  });

  test("1分足と5分足を切り替えられる", async ({ page }) => {
    await loadSyntheticSample(page);

    const tickMode = page.getByLabel("Tick");
    await expect(tickMode).toHaveValue("mobile");
    await tickMode.selectOption("desktop");
    await expect(tickMode).toHaveValue("desktop");
    await tickMode.selectOption("mobile");
    await expect(tickMode).toHaveValue("mobile");

    const timeframe = page.getByLabel("時間足");
    await expect(timeframe).toHaveValue("1m");
    await expect(page.getByText("1 / 300")).toBeVisible();

    await timeframe.selectOption("5m");

    await expect(timeframe).toHaveValue("5m");
    await expect(page.getByText("1 / 60")).toBeVisible();

    await timeframe.selectOption("1m");

    await expect(timeframe).toHaveValue("1m");
    await expect(page.getByText("1 / 300")).toBeVisible();
  });

  test("再生中の時刻と再生状態を保って時間足を切り替えられる", async ({ page }) => {
    await openApp(page);
    const barCsv = [
      "Datetime,Close,High,Low,Open,Volume",
      "2024-05-16 09:00:00+0900,90,91,89,90,1000",
      ...Array.from({ length: 10 }, (_, index) => {
        const minute = String(index).padStart(2, "0");
        return `2024-05-17 09:${minute}:00+0900,${101 + index},${102 + index},${99 + index},${100 + index},12000`;
      }),
    ].join("\n");
    await page.locator('input[type="file"]').nth(0).setInputFiles({
      name: "TIMEFRAME_TEST.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(barCsv),
    });

    await page.getByRole("button", { name: "60x", exact: true }).click();
    await page.getByRole("button", { name: "再生", exact: true }).click();
    await expect(chartHeader(page).getByText(/2024-05-17 09:01:[0-5][0-9]\+0900/)).toBeVisible({ timeout: 2_500 });

    const timeframe = page.getByLabel("時間足");
    await timeframe.selectOption("5m");
    await expect(page.getByRole("button", { name: "一時停止", exact: true })).toBeVisible();
    await expect(chartHeader(page).getByText(/2024-05-17 09:01:[0-5][0-9]\+0900/)).toBeVisible();

    await timeframe.selectOption("1m");
    await expect(page.getByRole("button", { name: "一時停止", exact: true })).toBeVisible();
    await expect(chartHeader(page).getByText(/2024-05-17 09:01:[0-5][0-9]\+0900/)).toBeVisible();
  });

  test("インジケーターを移動平均とボリンジャーバンドで切り替えられる", async ({ page }) => {
    await loadSyntheticSample(page);
    const indicator = page.getByLabel("指標");

    await expect(indicator).toHaveValue("ma");
    await expect(page.getByText("MA5")).toBeVisible();
    await expect(page.getByText("MA25")).toBeVisible();
    await expect(page.getByText("MA60")).toBeVisible();

    await indicator.selectOption("bb");

    await expect(indicator).toHaveValue("bb");
    await expect(page.getByLabel("期間")).toHaveValue("25");
    await expect(page.getByText("BB25 +3σ")).toBeVisible();
    await expect(page.getByText("BB25 +2σ")).toBeVisible();
    await expect(page.getByText("BB25 +1σ")).toBeVisible();
    await expect(page.getByText("BB25", { exact: true })).toBeVisible();
    await expect(page.getByText("BB25 -1σ")).toBeVisible();
    await expect(page.getByText("BB25 -2σ")).toBeVisible();
    await expect(page.getByText("BB25 -3σ")).toBeVisible();

    await page.getByLabel("期間").selectOption("20");

    await expect(page.getByText("BB20 +3σ")).toBeVisible();
    await expect(page.getByText("BB20 -3σ")).toBeVisible();

    await indicator.selectOption("ma");

    await expect(page.getByText("MA5")).toBeVisible();
    await expect(page.getByText("MA25")).toBeVisible();
    await expect(page.getByText("MA60")).toBeVisible();
  });

  test("再生速度は時間足の実時間を基準に進む", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.getByRole("button", { name: "60x" }).click();
    await page.getByRole("button", { name: "再生" }).click();

    await expect(page.getByText("2 / 300")).toBeVisible({ timeout: 1_800 });
    await page.getByRole("button", { name: "一時停止" }).click();

    await page.getByLabel("時間足").selectOption("5m");
    await page.getByRole("button", { name: "60x" }).click();
    await page.getByRole("button", { name: "再生" }).click();
    await page.waitForTimeout(2_000);

    await expect(page.getByText("1 / 60")).toBeVisible();
  });

  test("チャート上でSpaceキーを押すと再生と一時停止を切り替えられる", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.locator(".chart-shell").hover({ position: { x: 240, y: 240 } });
    await page.keyboard.press("Space");

    await expect(page.getByRole("button", { name: "一時停止" })).toBeVisible();

    await page.keyboard.press("Space");

    await expect(page.getByRole("button", { name: "再生" })).toBeVisible();
  });

  test("再生中はローソク足内の時刻秒を更新する", async ({ page }) => {
    await loadSyntheticSample(page);

    await page.getByRole("button", { name: "60x" }).click();
    await page.getByRole("button", { name: "再生" }).click();
    await expect(page.getByText("1 / 300")).toBeVisible();

    await expect(chartHeader(page).getByText(new RegExp(`${SAMPLE_DATE} 09:00:[0-5][0-9]\\+0900`))).toBeVisible();
    await page.waitForTimeout(300);

    await expect(page.getByText("1 / 300")).toBeVisible();
    await expect(chartHeader(page).getByText(new RegExp(`${SAMPLE_DATE} 09:00:(0[1-9]|[1-5][0-9])\\+0900`))).toBeVisible();
  });

  test("再生中は同じローソク足内でヒゲを更新する", async ({ page }) => {
    await loadSyntheticSample(page);
    await page.evaluate(() => {
      Math.random = () => 1;
    });

    await page.getByRole("button", { name: "60x" }).click();
    await page.getByRole("button", { name: "再生" }).click();
    await expect(page.getByText("1 / 300")).toBeVisible();

    const firstOhlc = await page.locator(".ohlc-strip").innerText();
    await page.waitForTimeout(300);
    await expect(page.getByText("1 / 300")).toBeVisible();
    const updatedOhlc = await page.locator(".ohlc-strip").innerText();

    expect(updatedOhlc).not.toBe(firstOhlc);
  });

  test("再生中はティックごとに口座サマリーの建玉損益を更新する", async ({ page }) => {
    await loadSyntheticSample(page);
    const dialog = await openOrderModal(page);
    await dialog.getByRole("button", { name: "買い注文" }).click();
    await dialog.getByRole("button", { name: "閉じる" }).click();
    await expect(summaryMetric(page, "買い建玉損益")).toHaveText("0 円");

    await page.evaluate(() => {
      Math.random = () => 1;
    });
    await page.getByRole("button", { name: "60x" }).click();
    await page.getByRole("button", { name: "再生" }).click();

    await expect(summaryMetric(page, "買い建玉損益")).not.toHaveText("0 円", { timeout: 1_000 });
    await expect(summaryMetric(page, "建玉損益合計")).not.toHaveText("0 円");
    await expect(summaryMetric(page, "トータル損益")).not.toHaveText("0 円");
  });

  test("テーマは初期表示でダーク、操作でライトへ切り替わる", async ({ page }) => {
    await openApp(page);

    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
    await expect(page.getByRole("button", { name: "ライト" })).toBeVisible();

    await page.getByRole("button", { name: "ライト" }).click();

    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "ダーク" })).toBeVisible();
    await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
  });
});


test("日付ジャンプ後は再生位置までの足と約定マークだけを表示する", async ({ page }) => {
  await openApp(page);
  const dates = ["2026-07-01", "2026-07-15", "2026-07-31"];
  const barCsv = ["Datetime,Close,High,Low,Open,Volume", ...dates.flatMap((date) => [
    `${date} 09:00:00+0900,100,110,90,100,1000`,
    `${date} 09:01:00+0900,100,110,90,100,1000`,
  ])].join("\n");
  const historyCsv = [
    "注文番号,アルゴ注文番号,状況,注文日時,注文期限,銘柄,銘柄コード・市場,取引,売買,注文方法,注文数量[株/口],約定数量[株/口],約定単価[円],約定代金[円]",
    ...["2026-06-30", ...dates, "2026-08-01"].map((date, i) =>
      `${i},,約定,${date.slice(5).replace("-", "/")} 09:01:30,${date.replaceAll("-", "/")},太陽誘電,6976 東証(SOR),信用新規,買建,通常注文,100,100,100,10000`),
    "9,,約定,07/15 09:00:00,2026/07/15,別銘柄,9999 東証,信用新規,買建,通常注文,100,100,100,10000",
  ].join("\n");
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles({ name: "太陽誘電.csv", mimeType: "text/csv", buffer: Buffer.from(barCsv) });
  await inputs.nth(1).setInputFiles({ name: "history.csv", mimeType: "text/csv", buffer: Buffer.from(historyCsv) });
  await expect(page.locator(".execution-label")).toHaveCount(2);
  await expect(page.locator(".historical-trades-section tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "銘柄メニューを開く" }).click();
  await page.getByLabel("ジャンプ先の日付").fill(dates[0]);
  await page.getByRole("button", { name: "銘柄メニューを閉じる" }).click();
  await expect(chartHeader(page)).toContainText(`${dates[0]} 09:00:00+0900`);
  await expect(page.getByText("1 / 6", { exact: true })).toBeVisible();
  await expect(page.locator(".execution-label")).toHaveCount(0);
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.locator(".execution-label")).toHaveCount(1);
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(chartHeader(page)).toContainText(`${dates[1]} 09:00:00+0900`);
  await expect(page.locator(".execution-label")).toHaveCount(1);
  await page.getByLabel("時間足").selectOption("5m");
  await expect(page.locator(".execution-label")).toHaveCount(2);
  await page.getByRole("button", { name: "実約定を非表示" }).click();
  await expect(page.locator(".execution-label")).toHaveCount(0);
});

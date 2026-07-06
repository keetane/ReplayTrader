# Replay Trader

CSVをブラウザ内で読み込む、実注文なしのトレードリプレイトレーニングアプリです。

## 特徴

- GitHub Pages で配信できる静的 React/Vite アプリ
- CSV は File API でブラウザ内だけで処理
- サーバーアップロードなし
- 日付指定付きの1分足 OHLCV リプレイ
- 指定日がない場合は最も近い日付のデータを自動選択
- チャート右上のピッカーで1分足/5分足を切り替え
- 5、25、60期間の移動平均線を表示。選択日の先頭では前日以前のデータも使って計算
- ダークモードをデフォルト表示。ライト/ダークモード切り替え
- 成行/指値の仮想注文
- 初期資金はデフォルト500万円で、画面から変更可能
- 信用維持率を表示
- 信用建余力を表示。現金残高を保証金、委託保証金率30%として簡易計算
- 手数料・金利は計算対象外
- 日跨ぎ建玉がある場合、新規注文を拒否
- 建玉、約定履歴、損益のローカル表示
- IndexedDB へのローカル保存/復元

## CSV 形式

```csv
Datetime,Close,High,Low,Open,Volume
2026-02-19 09:05:00+0900,4145.0,4170.0,4130.0,4170.0,0
```

必須カラムは `Datetime,Close,High,Low,Open,Volume` です。`Datetime` は `+0900` のようなオフセット付き日時として解釈します。

## 開発

```bash
npm install
npm run dev
npm run test
npm run build
npx playwright test
```

## 公開時の注意

- 実在の相場 CSV を repository、`public/`、`dist/` に入れないでください。
- 本番公開ビルドには架空サンプル生成機能だけを含めます。
- このアプリは投資判断、売買推奨、実注文機能を提供しません。
- 表示される損益、信用維持率、信用建余力は過去データに基づく仮想計算で、実際の約定・手数料・金利・税金・信用規制を再現するものではありません。

## 公開用ドキュメント

- [免責事項](docs/disclaimer.md)
- [利用規約](docs/terms.md)
- [プライバシーポリシー](docs/privacy-policy.md)
- [データ取扱方針](docs/data-handling-policy.md)
- [公開前チェックリスト](docs/pre-release-checklist.md)

## ライセンス表示

チャート描画には `lightweight-charts` を利用しています。`lightweight-charts` は Apache License 2.0 の OSS として提供されています。

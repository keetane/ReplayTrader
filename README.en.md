# Replay Trader

Japanese documentation: [README.md](README.md)

Replay Trader is a static React/Vite trade replay training app that loads user-selected CSV files in the browser. It does not place real orders.

## Features

- Static app deployable on GitHub Pages
- CSV files are processed only with the browser File API
- No server upload
- 1-minute OHLCV replay with date selection
- If the requested date has no data, the nearest available date is selected automatically
- The chart shows the selected date plus the previous two trading days, excluding non-trading gaps from the X-axis
- Top-right chart pickers for Tick mode, 1m/5m timeframe, and MA/BB indicator
- Default replay speed is 1x. 1x advances candles using real elapsed time
- During playback, the current candle moves with a random walk inside that candle range, updating wicks, seconds, and volume
- Random-walk prices are rounded to TOPIX 500 tick sizes
- Default Tick mode is Mobile. Desktop mode uses 60-2400 ticks, and Mobile mode uses shares traded / 100 capped at 120 ticks
- Moving averages for 5, 25, and 60 periods. The first bar of a selected date uses previous-day data for calculation
- Bollinger Bands can be shown instead of moving averages. The period can be selected from 10, 20, 25, 50, and 75
- Daily open, change from previous close, daily high, and daily low are shown above the chart. Positive change is green and negative change is red
- Dark mode by default, with light/dark switching
- Japanese/English UI switching
- Display only confirmed fills from a trade history CSV for the matching symbol
- Normal and IFDOCO paper orders
- Floating draggable order panel
- Initial cash defaults to 5,000,000 yen and can be selected from 500,000, 1,000,000, 3,000,000, 5,000,000, and 10,000,000 yen
- Maintenance ratio and margin buying power display
- Margin buying power is estimated from cash as collateral with a 30% margin requirement
- New margin orders above available margin buying power are rejected
- Fees and interest are not calculated
- New orders are blocked while margin positions are carried across days
- Cash positions and margin positions are managed separately. Margin positions are managed per entry price and can be partially closed
- Local display of positions, executions, and P/L
- Trade markers are shown on the chart. Profitable exits are circles and losing exits are crosses
- Local save/restore with IndexedDB

## CSV Format

```csv
Datetime,Close,High,Low,Open,Volume
2026-02-19 09:05:00+0900,4145.0,4170.0,4130.0,4170.0,0
```

Required columns are `Datetime,Close,High,Low,Open,Volume`. `Datetime` is parsed as an offset datetime such as `+0900`.

`Volume` is treated as shares traded, not trading value. For 5-minute bars, the `Volume` values of the five source 1-minute bars are summed.

## Development

```bash
npm install
npm run dev
npm run test
npm run build
npx playwright test
```

## Publication Notes

- Do not commit real market CSV files to the repository, `public/`, or `dist/`.
- The public production build includes only the synthetic sample generator.
- This app does not provide investment advice, trading recommendations, or real order functionality.
- Displayed P/L, maintenance ratio, and margin buying power are simplified paper-trading calculations and do not reproduce actual executions, fees, interest, taxes, or margin regulations.

## Public Documents

- [Disclaimer](docs/disclaimer.md)
- [Terms](docs/terms.md)
- [Privacy Policy](docs/privacy-policy.md)
- [Data Handling Policy](docs/data-handling-policy.md)
- [Pre-release Checklist](docs/pre-release-checklist.md)

## License

The application source code is released under the [MIT License](LICENSE).

Third-party license notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The chart is rendered with `lightweight-charts`, which is provided as open source software under the Apache License 2.0.

This repository does not include market data. Users are responsible for confirming the rights, contract terms, and permitted use of any CSV data they load.

This app is a trade replay and training tool. It does not provide investment advice, trading recommendations, financial instruments business, order routing, or real-money trading.

## Tutorial

Replay Trader loads a user-provided 1-minute CSV in the browser and lets users practice paper trading while replaying historical candles. CSV files are not sent to a server.

The tutorial screenshots use data created by the app's synthetic sample generator. It is not real market data.

### 1. Open the App

The initial screen shows CSV and order controls in the top bar, the chart in the center, and the account summary on the right. Dark mode is the default. Open the symbol list from the menu button at the top right.

![Initial screen](docs/assets/user-tutorial/01-initial-screen.png)

### 2. Load a CSV

Choose a CSV from the top-right "Bar CSV" button. You can also drag and drop a file onto the button.

For testing and practice, open the top-right menu and press "Generate sample" to create a synthetic semiconductor-style sample with volatile prices and volume. It is not real market data.

![Sample loaded](docs/assets/user-tutorial/02-sample-loaded.png)

The CSV must contain these columns:

```csv
Datetime,Close,High,Low,Open,Volume
2026-02-19 09:05:00+0900,4145.0,4170.0,4130.0,4170.0,0
```

### 3. Select Date and Timeframe

Open the top-right menu and use "Replay date" in the drawer to show that trading day. If the requested date does not exist, the nearest available date is selected automatically. The drawer also contains theme, language, synthetic sample, symbol switching, and historical-fill visibility controls.

The chart top-right controls switch Tick mode, timeframe, and indicator.

- Tick: `Desktop` / `Mobile`
- Timeframe: `1m` / `5m`
- Indicator: `MA` / `BB`

When a date is selected, the chart shows that date plus the previous two trading days. Non-trading dates that do not exist in the CSV are removed from the X-axis, so the chart remains continuous across weekends.

The chart header shows daily open, change from previous close, daily high, and daily low. Positive change is green and negative change is red.

![Date and timeframe controls](docs/assets/user-tutorial/03-date-timeframe-picker.png)

### 4. Display Historical Fills

Use the top-right "Trade history CSV" button to load a broker-exported trade history file. The adjacent eye icon toggles historical fills. UTF-8 and Shift-JIS are supported.

Only rows with `status=約定`, a positive executed quantity, a numeric executed price, and a positive executed value are displayed. Unfilled, canceled, and zero-quantity rows are excluded. Matching fills appear in the selected symbol's chart and right-side history table as the replay reaches their candle.

Historical fills are read-only. They do not change paper cash, positions, or P/L. When the trade history file does not contain a separate execution timestamp, the CSV order time is used as the display time.

### 5. Control Replay

Use the slider, Play button, and previous/next controls below the chart to move the replay position.

The default speed is `1x`. Replay speed follows real elapsed time: at 1x, a 1-minute chart advances one candle every minute, and a 5-minute chart advances one candle every five minutes. 5x, 10x, 30x, and 60x advance at those multiples.

During playback, the current candle price moves with a random walk inside the candle range. Wicks, seconds, and volume are updated while the candle is forming. The random-walk price is rounded to TOPIX 500 tick sizes.

Tick counts by mode:

- Desktop: 60-2400 ticks based on the volume rank in the CSV
- Mobile: shares traded / 100, capped at 120 ticks when shares traded are 12,000 or more

Volume means shares traded, not trading value.

### 6. Place Paper Orders

Press the top-right "Order panel" button to open the floating order panel. The panel can be dragged to another position.

Press the camera icon next to it to download a PNG containing the chart, candles, execution markers, guide lines, and execution labels.

Normal orders let you set trade type, order type, quantity, and limit price.

- Cash: buy cash shares or sell held cash shares
- Margin open: open long or short margin positions
- Margin close: close margin positions
- Quantity: 100-share lots
- Market: fills at the current replay price
- Limit: fills only when the current candle range reaches the limit price

IFDOCO registers an entry order together with take-profit and stop-loss exit conditions. No real order is sent; everything is handled as browser-local paper trading.

In this example, a margin buy entry has filled and is reflected in positions and executions.

![Opened margin position](docs/assets/user-tutorial/04-open-margin-position.png)

### 7. Check Positions and P/L

The account summary shows virtual capital, cash balance, cash market value, long position P/L, short position P/L, realized P/L, total P/L, margin buying power, and maintenance ratio.

The Positions table separates cash and margin positions. Margin positions are managed per entry price and can be partially closed.

### 8. Close Margin Positions

To close a margin position, set the trade type to "Margin close". To close a long position, press "Sell order"; to close a short position, press "Buy order".

After closing, realized P/L is updated and trade markers appear on the chart. Profitable exits are green circles and losing exits are red crosses.

![Closed position and marker](docs/assets/user-tutorial/05-close-position-and-marker.png)

### 9. Switch Theme and Language

Open the top-right menu and use the drawer's "Light" / "Dark" button to switch the theme.

Use the drawer's "English" / "日本語" button to switch the main UI language. Japanese is the default.

![Light mode](docs/assets/user-tutorial/06-light-mode.png)

### 10. Save and Restore

Use the top-right menu button to switch uploaded symbols. Press "Save" to store loaded data, replay position, and paper trading state in browser-local IndexedDB. Nothing is sent to an external server.

Press "Restore" to load the saved session in the same browser. Press "Clear" to remove paper trades and the saved session.

### Notes

- This app is a paper-trading training tool.
- It does not place real orders, route orders, provide investment advice, or recommend trades.
- Displayed P/L, margin buying power, and maintenance ratio are simplified calculations.
- Fees, interest, taxes, and actual margin regulations are not calculated.
- Users are responsible for confirming the rights, contract terms, and permitted use of their CSV data.

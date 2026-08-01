# Replay Trader User Tutorial

This English tutorial is also included in [README.en.md](../README.en.md#tutorial).

Replay Trader loads user-selected 1-minute CSV files in the browser and lets users practice paper trading while replaying historical candles. CSV files are not sent to a server.

The screenshots use the app's synthetic semiconductor-style sample. It is not real market data.

## 1. Open the App

The initial screen shows CSV and order controls in the top bar, the chart, paper trading, and the account summary. Dark mode is the default. The uploaded symbol list is in the top-right menu drawer.

![Initial screen](assets/user-tutorial/01-initial-screen.png)

## 2. Load a CSV

Use "Bar CSV" in the top bar or drag and drop a CSV onto the button. For practice, open the menu and use "Generate sample" to create synthetic volatile data.

![Sample loaded](assets/user-tutorial/02-sample-loaded.png)

CSV format:

```csv
Datetime,Close,High,Low,Open,Volume
2026-02-19 09:05:00+0900,4145.0,4170.0,4130.0,4170.0,0
```

`Volume` means shares traded, not trading value.

## 3. Select Date, Timeframe, and Indicator

Open the top-right menu and use "Replay date" in the drawer to choose the target day. If the date is missing, the nearest available date is selected. The same drawer contains theme, language, synthetic sample, symbol switching, and historical-fill visibility controls.

Use the chart controls for Tick mode, timeframe, and indicator:

- Tick: `Desktop` / `Mobile`
- Timeframe: `1m` / `5m`
- Indicator: `MA` / `BB`

The chart shows the selected date plus the previous two trading days and removes non-trading gaps from the X-axis.

![Date and timeframe controls](assets/user-tutorial/03-date-timeframe-picker.png)

## 4. Display Historical Fills

Use the top-bar "Trade history CSV" button. The adjacent eye icon toggles historical fills. The app supports UTF-8 and Shift-JIS broker exports.

The app keeps only confirmed fills: `status=約定`, executed quantity greater than zero, numeric executed price, and executed value greater than zero. Unfilled and canceled orders are excluded. Matching fills are shown on the selected symbol's chart and in the historical fills table as the replay reaches the relevant candle.

Historical fills are reference data only. They are not added to paper positions or paper account calculations. If the source file has no execution timestamp, its order time is used as the display time.

## 5. Replay Candles

At 1x, candles advance using real time: one minute per 1-minute candle or five minutes per 5-minute candle. Faster modes advance at their multiplier.

During playback, the active candle uses a random walk inside its candle range. Price, wicks, seconds, and volume update while the candle forms. Prices are rounded to TOPIX 500 tick sizes.

## 6. Place Paper Orders

Open the floating order panel with the top-bar "Order panel" button. The panel can be dragged.

Use the camera icon next to the order button to download the chart as a PNG. The image includes execution markers, guide lines, and draggable execution labels.

Normal orders support cash, margin open, and margin close. IFDOCO supports an entry with take-profit and stop-loss exit conditions. No real orders are sent.

![Opened margin position](assets/user-tutorial/04-open-margin-position.png)

## 7. Check Positions and P/L

The account summary shows virtual capital, cash balance, position P/L, realized P/L, total P/L, margin buying power, and maintenance ratio.

Cash and margin positions are separate. Margin positions are managed per entry price and can be partially closed.

## 8. Close Positions

Use "Margin close" to close margin positions. Closing updates realized P/L and adds chart markers. Profitable exits are circles, and losing exits are crosses.

![Closed position and marker](assets/user-tutorial/05-close-position-and-marker.png)

## 9. Switch Theme and Language

Open the top-right menu and use "Light" / "Dark" to change the theme. Use the same drawer's "English" / "日本語" control to switch the main UI language.

![Light mode](assets/user-tutorial/06-light-mode.png)

## 10. Save and Restore

Use the top-right menu button to switch uploaded symbols. "Save" stores the session in browser-local IndexedDB. "Restore" loads the saved session in the same browser. "Clear" removes paper trades and the saved session.

## Notes

- This is a paper-trading training tool.
- It does not provide investment advice, trading recommendations, order routing, or real trading.
- P/L, margin buying power, and maintenance ratio are simplified calculations.
- Users must confirm the rights and permitted use of their CSV data.

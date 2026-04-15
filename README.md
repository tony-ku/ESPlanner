# ESPlanner

**ESPlanner** is a small local web app that gives you a single dashboard for trading ES futures:

- A live **candlestick chart** built from a one-minute OHLCV file that your data feed overwrites each minute.
- **Price levels** (VAH, VAL, POC, IB, prior day / week, etc.) pulled from a Sierra Chart notification CSV, drawn as horizontal lines on the chart and listed in grouped tables.
- Your **dated markdown trading plans**, rendered side-by-side with the chart so you can glance at your game plan without tabbing away.
- A row of summary **tiles** up top: last price, session O/H/L, range, session volume, nearest level, and value area.

Everything runs locally — no cloud, no account, no data leaves your machine. A tiny Node server reads your files and pushes updates to a browser tab over Server-Sent Events.

---

## Screenshot layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ESPLANNER — ESM6                                          live       │
├──────────────────────────────────────────────────────────────────────┤
│ Last Price │ Session O/H/L │ Top Prob @Price │ Nearest Level │ VA    │
├──────────────────────────────────────────────┬───────────────────────┤
│                                              │                       │
│              Candlestick chart               │    Trading Plan       │
│           (with horizontal levels)           │    (today's .md)      │
│                                              │                       │
├─────────────────────┬─────────────┬──────────┴──────┬────────────────┤
│  Top Probabilities  │  Intraday   │   Reference     │ Prior Day/Week │
│   (from plan .md)   │             │                 │                │
└─────────────────────┴─────────────┴─────────────────┴────────────────┘
```

---

## Requirements

| | |
|---|---|
| **OS** | Windows 10/11 (tested). Linux should work with `npm start`. |
| **Node.js** | 18 or newer. Download from [nodejs.org](https://nodejs.org) (pick the **LTS** installer). |
| **Browser** | Any modern Chromium-based browser (Chrome, Edge, Brave). |

After installing Node, open a **new** terminal and confirm:

```bash
node --version
npm --version
```

Both should print a version number.

---

## Quick start (Windows — easiest)

1. Open the `ESPlanner` folder in File Explorer.
2. Copy `.env.example` to `.env` and edit the paths inside to point at your own data files (see [Configuration](#configuration) below).
3. Double-click **`start.bat`**.
   - First run: it will `npm install` the dependencies (~15 seconds).
   - It launches the server and auto-opens Chrome to `http://localhost:3000`.
   - Keep the console window open — closing it stops the server.

## Quick start (manual / Linux)

```bash
cd ESPlanner
cp .env.example .env          # then edit .env
npm install                   # first run only
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Configuration

All settings live in a `.env` file in the project root. Copy `.env.example` to `.env` and edit the values.

| Key | What it does | Default |
|---|---|---|
| `PORT` | HTTP port for the local server. | `3000` |
| `MINUTE_FILE` | Full path to the one-minute OHLCV file (overwritten each minute with a single row). | *(required)* |
| `LEVELS_FILE` | Full path to the Sierra Chart notification CSV of price levels. | *(required)* |
| `PLANS_DIR` | Directory containing dated markdown trading plans. | *(required)* |
| `POLL_MS` | How often to re-read `MINUTE_FILE` (milliseconds). | `1000` |
| `HISTORY_DAYS` | Rolling chart window in days. Bars older than this are dropped. | `2` |
| `SESSION_FILE` | Where to persist observed bars so reloads don't lose context. | `./session_bars.csv` |

> **Path tip (Windows):** forward slashes work cleanly in `.env` files. Use
> `C:/Users/you/data/...` rather than `C:\Users\you\data\...`.

### `MINUTE_FILE` format

The file is expected to be **overwritten** each minute with a single row:

```
Time,Symbol,Open,High,Low,Close,Volume
```

Example row:

```
15:14:03,ESM6,7002,7003,7002,7002.5,966
```

The server polls this file every `POLL_MS`, deduplicates by `Time`, and appends each new bar to an in-memory history (and to `SESSION_FILE` on disk).

### `LEVELS_FILE` format

A Sierra Chart notification-style CSV. The header row must include at least:

```
Symbol,Price Level,Note,Foreground Color,Background Color
```

- `Note` is used as the chart-axis label (e.g. `VAH`, `VAL`, `POC`, `IBH`, `pVAH`).
- `Background Color` becomes the line color on the chart (hex, e.g. `#3b6b01`).
- Rows with `Price Level = 0` are ignored. Malformed hex colors (e.g. `#0000000`) fall back to a default.

Levels update instantly when you save the CSV — no refresh needed.

### `PLANS_DIR` format

A directory of markdown files. To be auto-selected as *today's plan*, a file must be named:

```
trading-plan-YYYY-MM-DD.md
```

Any `.md` file in the folder appears in the dropdown, sorted newest first.

---

## What the UI shows

### Top tiles

| Tile | Shows |
|---|---|
| **Last Price** | Most recent close. Green if up vs. session open, pink if down. Change in absolute price and percent below. |
| **Session O / H / L** | Session open (first bar's open), session high, session low. Range below. |
| **Top Prob · Near Price** | Highest-probability row from today's plan whose reference level is within ±15 points of the current price. Falls back to overall top if nothing is in band. |
| **Nearest Level** | The level (by price) closest to the current price, with the signed distance. |
| **Value Area** | VAH, POC, VAL side-by-side (from `LEVELS_FILE`). |

### Chart

- Candlesticks + volume histogram.
- Horizontal lines for any level within ±2% of the current price, colored from `LEVELS_FILE`. The ±2% filter prevents distant levels from squashing the auto-scale.
- Bottom strip shows the raw last bar: `15:14:03  O 7002  H 7003  L 7002  C 7002.5  V 966`.

### Trading plan

- Dropdown selects which plan to view. Today's is picked automatically if it exists.
- Full markdown rendering (headers, lists, tables, code blocks, blockquotes).
- Re-renders automatically when you save the file.

### Level tables (bottom)

The four panels across the bottom:

| Panel | Source | Contents |
|---|---|---|
| **Top Probabilities** | `PLANS_DIR` (today's plan .md) | Top 6 rows by `%` parsed from the plan's probability tables, with reference price(s) in muted text. Updates live when the plan file is rewritten. |
| **Intraday** | `LEVELS_FILE` | `IBH`, `IBL`, `IBH30`, `IBL30`, `2xIBH`, `2xIBL`, `rthOP` |
| **Reference** | `LEVELS_FILE` | `rthHI`, `rthLO`, `ethHI`, `ethLO`, `ethMID`, `onVPOC` |
| **Prior Day / Week** | `LEVELS_FILE` | `pVAH`, `pVAL`, `yVPOC`, `yHI`, `yLO`, `pCL`, `pWHI`, `pWLO` |

The level row matching the *nearest level* is highlighted in amber.

`VAH`, `VAL`, `POC` still appear in the **Value Area** tile and are drawn on the chart, but no longer have their own panel. `HVN` and `LVN` levels are drawn on the chart but do not have their own tables.

---

## How it works (internals)

### Server (`server.js`)
- Express serves the static UI from `public/`.
- `setInterval` polls `MINUTE_FILE` every `POLL_MS`. A row is considered new if its `Time` column differs from the last one seen.
- Each new bar is appended to `SESSION_FILE` (fast append) and to the in-memory bar list. When bars age past `HISTORY_DAYS`, the session file is fully rewritten.
- `chokidar` watches `LEVELS_FILE` and `PLANS_DIR`. On change, updates push to all connected browsers via SSE.
- Endpoints:
  - `GET /events` — Server-Sent Events stream (`snapshot`, `bar`, `levels`, `plans`).
  - `GET /api/plans` — list of plan filenames.
  - `GET /api/plans/:name` — one plan rendered to HTML.

### Frontend (`public/app.js`)
- Opens an `EventSource` to `/events`.
- On `snapshot`: paints the full bar history and levels.
- On `bar`: calls `candleSeries.update()` for a smooth live tick.
- On `levels`: re-categorizes and redraws price lines and tables.
- On `plans`: refreshes the dropdown.

### Charting library
TradingView [Lightweight Charts](https://github.com/tradingview/lightweight-charts) v4.1.3, loaded via `unpkg` CDN. Requires internet access on first load; your browser caches it after that.

---

## Time handling

`MINUTE_FILE` contains **time of day only** (`"15:14:03"`), no date. The server interprets each time as *today* in the server's local timezone. If the parsed time would be more than 12 hours in the future versus now (e.g. it's 00:05 local and the file still shows 23:59), the time rolls back one day so overnight ticks land on the correct calendar date.

**Tip:** restart the server after midnight to anchor new bars to the new date cleanly.

---

## Session persistence

Observed bars are appended to `SESSION_FILE` (default: `session_bars.csv` in the project folder) so that:

- Refreshing the browser doesn't clear the chart.
- Restarting the server doesn't clear the chart.

Safe to delete the file at any time — a fresh session starts on the next bar.

---

## Troubleshooting

<details>
<summary><strong>The page loads but status shows "disconnected"</strong></summary>

- The Node server isn't running, or a firewall is blocking `localhost:3000`.
- Check the console window from `start.bat` for errors.
- Confirm the `PORT` in `.env` matches what you're opening in the browser.
</details>

<details>
<summary><strong>Chart is empty</strong></summary>

- Confirm `MINUTE_FILE` in `.env` points at the right file.
- Open that file in Notepad and verify it contains one line in `Time,Symbol,O,H,L,C,V` format.
- Confirm the file is actually being written — its timestamp should change each minute.
- Check the server console for file-read errors.
</details>

<details>
<summary><strong>Level panels are empty</strong></summary>

- Confirm `LEVELS_FILE` path in `.env`.
- Verify the CSV has a header row with at least `Symbol, Price Level, Note, Foreground Color, Background Color`.
- Rows with price 0 are intentionally skipped.
</details>

<details>
<summary><strong>"No trading plans found"</strong></summary>

- Confirm `PLANS_DIR` path in `.env`.
- Make sure the directory contains at least one `.md` file.
- For today's plan to auto-select, name it `trading-plan-YYYY-MM-DD.md`.
</details>

<details>
<summary><strong>Bar times look wrong after midnight</strong></summary>

Restart the server. See [Time handling](#time-handling) for why.
</details>

<details>
<summary><strong>I want to reset all accumulated history</strong></summary>

1. Stop the server (close the console window).
2. Delete `session_bars.csv`.
3. Restart.
</details>

<details>
<summary><strong>Error in browser console: "Cannot parse color: #XXXXXXX"</strong></summary>

A row in `LEVELS_FILE` has a malformed hex color. The server now falls back to a default, but fixing the CSV is cleaner. Valid formats are `#RGB`, `#RRGGBB`, and `#RRGGBBAA`.
</details>

---

## File map

```
ESPlanner/
├── .env.example        Template — copy to .env and edit
├── .gitignore
├── package.json        npm manifest and dependencies
├── package-lock.json   Pinned dependency tree
├── README.md           This file
├── server.js           Express server, file polling/watching, SSE broadcaster
├── start.bat           Windows one-click launcher
├── public/
│   ├── index.html      Page layout
│   ├── app.js          Chart + SSE client + tile/table rendering
│   └── style.css       Dark purple theme
└── session_bars.csv    Auto-generated. Accumulated bar history. Safe to delete.
```

---

## License

Released under the [MIT License](LICENSE).

---

## Disclaimer

**ESPlanner is a personal file-viewing utility, not trading advice, signal service, or investment recommendation.** Nothing in this repository — including the chart, levels, probability tiles, or rendered trading plans — should be interpreted as a recommendation to buy, sell, or hold any security, futures contract, or other financial instrument.

Trading futures (including E-mini S&P 500 / ES contracts) involves **substantial risk of loss** and is not suitable for every investor. Leverage can work against you as well as for you. You can lose more than your initial deposit. Past performance of any trading methodology, plan, or level is not indicative of future results.

The probability figures displayed by this tool are parsed verbatim from markdown files **you** provide; they carry no statistical validation from this software. The author makes no warranty as to the accuracy, completeness, or fitness for any purpose of any data shown. Use at your own risk. Consult a licensed financial professional before making any trading decision.

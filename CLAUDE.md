# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies (first run only).
- `npm start` — run the Express server (`node server.js`) on `PORT` (default `3000`).
- `start.bat` — Windows launcher: installs deps if missing, starts server, opens Chrome to `http://localhost:3000`.
- `npm test` — runs the test suite via Node's built-in `node --test` (requires Node ≥ 20). Covers pure helpers in `src/helpers.js` plus an SSE integration smoke test that spawns the server against a temp directory.

No linter or build step is configured.

## Configuration

Runtime config comes from `.env` (copy `.env.example`). Required keys: `MINUTE_FILE`, `LEVELS_FILE`, `PLANS_DIR`. Optional: `PORT`, `POLL_MS`, `HISTORY_DAYS`, `SESSION_FILE`. On Windows, use forward slashes in paths.

## Architecture

Single-process local app: a Node/Express server (`server.js`) tails three external data sources and pushes updates to a browser via Server-Sent Events. No database, no build pipeline — the browser loads static files from `public/` plus TradingView Lightweight Charts v4.1.3 from the unpkg CDN.

**Data flow:**
1. **`MINUTE_FILE`** — one-row OHLCV CSV overwritten each minute by an external feed. Server polls it every `POLL_MS`, dedupes by `Time` column, appends new bars to in-memory history and to `SESSION_FILE` (append-only, rewritten when bars age past `HISTORY_DAYS`).
2. **`LEVELS_FILE`** — Sierra Chart notification CSV of price levels (VAH/VAL/POC/IB/prior-day etc.). Watched with `chokidar`; reparsed on change. `Note` column → axis label; `Background Color` → line color; rows with `Price Level = 0` skipped; malformed hex colors fall back.
3. **`PLANS_DIR`** — directory of markdown trading plans. Watched with `chokidar`. Files named `trading-plan-YYYY-MM-DD.md` auto-select as today's plan. Rendered to HTML with `marked`.

**SSE endpoint `/events`** emits four event types: `snapshot` (initial full state), `bar` (new minute), `levels` (levels CSV changed), `plans` (plan file list or content changed). REST helpers: `GET /api/plans`, `GET /api/plans/:name`.

**Frontend (`public/app.js`)** opens an `EventSource`, paints the chart on `snapshot`, uses `candleSeries.update()` for live ticks on `bar`, re-categorizes levels on `levels`. Levels within ±2% of current price are drawn on the chart; the rest still appear in the bottom panels. The "Top Prob · Near Price" tile parses probability tables out of the today's-plan markdown and picks the highest-% row whose reference price is within ±15 points of last price.

**Time handling quirk:** `MINUTE_FILE` has time-of-day only (no date). Server anchors each tick to today in local TZ; if the parsed time is >12h in the future vs. now, it rolls back one day (overnight session handling). Restarting the server after midnight re-anchors cleanly.

**Session persistence:** `SESSION_FILE` (default `./session_bars.csv`) preserves bars across server/browser restarts. Safe to delete to reset history.

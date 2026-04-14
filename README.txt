================================================================================
  ESPlanner  -  Local ES Futures Minute Monitor
================================================================================

OVERVIEW
--------
A small local web application that reads three live file sources from your PC
and displays them together in a browser:

  1. A one-minute OHLCV bar file for ES futures that is continuously overwritten
     with the latest minute's data. The app polls this file, accumulates a
     rolling history in memory (and on disk), and renders a candlestick chart.

  2. A Sierra Chart-style "notification CSV" of price levels (VAH, VAL, POC,
     key lines, etc.). The app draws each level as a horizontal line on the
     chart, colored with the colors from the CSV, and lists them in a side
     panel.

  3. A directory of daily trading plans written in Markdown. Today's plan is
     auto-selected; a dropdown lets you browse older plans.

All three sources update live: polled or watched by the server, and pushed to
the browser over Server-Sent Events (SSE). No reload is needed.

--------------------------------------------------------------------------------

REQUIREMENTS
------------
  * Windows (tested) or Linux
  * Node.js 18 or newer  (https://nodejs.org)
  * A modern Chromium-based browser (Chrome, Edge)

--------------------------------------------------------------------------------

QUICK START  (Windows)
----------------------
  1. Open the ESPlanner folder.
  2. Double-click  start.bat
     - On first run it will run "npm install" (one-time, ~15 seconds).
     - It will launch Chrome to http://localhost:3000 automatically.
     - A console window stays open showing server logs. Closing it stops
       the server.

QUICK START  (Manual / Linux)
-----------------------------
  1. cd ESPlanner
  2. npm install          (first run only)
  3. npm start
  4. Open http://localhost:3000 in your browser.

--------------------------------------------------------------------------------

CONFIGURATION  (.env)
---------------------
All paths and tuning parameters live in a file called  .env  in the project
root. An example file is provided as .env.example. Edit .env to point to your
data locations.

  PORT             HTTP port for the local server. Default 3000.

  MINUTE_FILE      Full path to the one-minute OHLCV file.
                   This file is expected to be OVERWRITTEN each minute with a
                   single line in the format:
                       Time,Symbol,Open,High,Low,Close,Volume
                   Example line:
                       15:14:03,ESM6,7002,7003,7002,7002.5,966
                   The server polls this file (see POLL_MS) and appends each
                   new, unique row to its in-memory bar history.

  LEVELS_FILE      Full path to the price-levels CSV. The header row must
                   include at least these columns:
                       Symbol, Price Level, Note,
                       Foreground Color, Background Color
                   This is the standard Sierra Chart notification export.
                   The file is watched for changes; saves are reflected
                   instantly on the chart.

  PLANS_DIR        Full path to a directory of markdown trading plans.
                   Files should be named:
                       trading-plan-YYYY-MM-DD.md
                   The file matching today's date is selected automatically.
                   All .md files in the folder appear in the dropdown,
                   sorted newest first.

  POLL_MS          How often (milliseconds) to re-read MINUTE_FILE.
                   Default 1000 (once per second).

  HISTORY_DAYS     Rolling chart window in days. Bars older than this
                   (relative to the newest bar) are dropped from the chart
                   and the session file. Default 2.

  SESSION_FILE     Where to persist accumulated bars so a browser reload or
                   a server restart does not lose the day's chart.
                   Default  ./session_bars.csv  (inside the project folder).

Paths on Windows: forward slashes work best (e.g. C:/Users/tonyk/...).
Backslashes also work but remember that a .env file is not a shell script.

--------------------------------------------------------------------------------

WHAT YOU SEE IN THE BROWSER
---------------------------
  Header
    - Contract symbol (parsed from each bar, e.g. ESM6).
    - Connection status: "live" in green when SSE is connected,
      "disconnected" in red otherwise.

  Left pane - Chart
    - Candlestick series with volume histogram below.
    - Horizontal price lines drawn from LEVELS_FILE, colored by that CSV's
      Background Color. The Note column is used as the axis label.
    - The footer under the chart shows the most recent raw bar:
          15:14:03  O 7002  H 7003  L 7002  C 7002.5  V 966

  Right pane - Trading Plan
    - Dropdown listing all .md files in PLANS_DIR (newest first).
    - Selected plan rendered as HTML.
    - Updates automatically if files are added, edited, or removed.

  Right pane - Price Levels
    - Tabular listing of every level in LEVELS_FILE with its note swatch
      and price.

--------------------------------------------------------------------------------

HOW IT WORKS (internals)
------------------------
  server.js
    - Express serves the static UI from the public/ folder.
    - setInterval polls MINUTE_FILE every POLL_MS. A new bar is detected by
      comparing the Time column to the previously observed one.
    - Each observed bar is appended to SESSION_FILE (append-only fast path);
      pruning past HISTORY_DAYS triggers a full rewrite.
    - chokidar watches LEVELS_FILE and PLANS_DIR. On change, the new data
      is pushed to all connected browsers via SSE.
    - /events   Server-Sent Events stream (snapshot, bar, levels, plans).
    - /api/plans        lists plan filenames.
    - /api/plans/:name  returns a markdown plan rendered to HTML.

  public/app.js
    - Opens an EventSource to /events.
    - On "snapshot" it paints the full bar history and levels.
    - On "bar" it calls candleSeries.update() for a smooth live update.
    - On "levels" it clears and redraws price lines.
    - On "plans" it refreshes the dropdown.

  Charting library
    - TradingView Lightweight Charts v4.1.3, loaded via unpkg CDN
      (requires internet on first load; it is cached by the browser after).

--------------------------------------------------------------------------------

TIME HANDLING
-------------
The minute file contains time of day only ("15:14:03"), no date.
The server interprets each time as "today" in the server's local timezone.
If the parsed time would be more than 12 hours in the future versus now
(e.g. it is 00:05 local and the file still reads 23:59), the time is rolled
back by one day so overnight ticks land on the correct calendar date.
Restarting the server after midnight will anchor new bars to the new date.

--------------------------------------------------------------------------------

SESSION PERSISTENCE
-------------------
Bars observed during a running session are appended to SESSION_FILE so that
refreshing the browser or restarting the server does not lose the chart.
Safe to delete the file at any time; a fresh session starts on the next bar.

--------------------------------------------------------------------------------

TROUBLESHOOTING
---------------
  Page loads but status shows "disconnected":
    The Node server is not running, or a firewall is blocking localhost:3000.
    Check the console for errors and confirm the port in .env.

  Chart is empty:
    - Confirm MINUTE_FILE path in .env points to the right file.
    - Confirm the file is actually being written (open it in Notepad++; it
      should change each minute).
    - Look at the server console - file-read errors are logged.

  "Levels" section is empty:
    - Confirm LEVELS_FILE path and that its header row matches the expected
      column names.

  "No trading plans found":
    - Confirm PLANS_DIR path and that it contains *.md files.

  Bar "jumps" to a wrong time after midnight:
    Restart the server. See TIME HANDLING above.

  Want to reset accumulated history:
    Stop the server, delete session_bars.csv, restart.

--------------------------------------------------------------------------------

FILES IN THIS PROJECT
---------------------
  package.json          npm manifest and dependencies
  server.js             Express server, file polling/watching, SSE broadcaster
  public/index.html     Page layout
  public/app.js         Chart and SSE client
  public/style.css      Dark theme styling
  .env                  Your configuration (edit to match your paths)
  .env.example          Template showing all supported keys
  start.bat             Windows one-click launcher (installs, runs, opens Chrome)
  session_bars.csv      Auto-generated at runtime. Accumulated bar history.
  README.txt            This file.

================================================================================

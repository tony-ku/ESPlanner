---
name: replace-session-bars
description: Replace session_bars.csv with a Sierra Chart-style tab-separated minute bar export (columns `-Ticker Date Time Open High Low Last Volume Open Interest`). Use when the user wants to seed or reset the chart's history from a raw minute-file dump. Preserves the existing session symbol (e.g. ESU6) and writes the project's comma-separated Time,Symbol,OHLCV format.
disable-model-invocation: true
---

# replace-session-bars

Converts a Sierra Chart tab-separated minute export to the `session_bars.csv`
format that `server.js` reads. See [server.js:44-78](../../../server.js#L44-L78)
for the loader and [server.js:87-94](../../../server.js#L87-L94) for the exact
on-disk format this skill must produce.

## When to use

Trigger whenever the user asks to:

- Replace / seed / reset `session_bars.csv` from a raw minute file.
- Import historical ES minute bars from a Sierra export into the chart.
- "Load this file into the session", where the file is tab-separated with a
  `@ES#` (or similar) ticker column and ISO datetimes like `2026-04-05T17:01`.

Do not use this for the running one-minute feed file (`MINUTE_FILE`). That one
is tailed live by the server and should not be overwritten.

## Input format (tab-separated)

```
-Ticker	Date Time	Open	High	Low	Last	Volume	Open Interest
@ES#	2026-04-05T17:01	6590.00	6590.00	6575.00	6576.25	2990	0
```

The header row is optional; it's detected by "first column doesn't start with
a digit after the ticker column" and skipped.

## Output format (comma-separated, no header)

```
2026-04-05 17:01:00,ESU6,6590,6590,6575,6576.25,2990
```

- Time: `YYYY-MM-DD HH:MM:SS`, space-separated, `:00` seconds for minute bars.
- Symbol: preserved from the current `session_bars.csv` first row
  (defaults to `ESU6` if the file is missing or empty).
- Prices: no forced decimals; `6590.00` → `6590`, `7005.50` → `7005.5`.
- Volume: integer.
- Rows with any OHLC ≤ 0 are dropped (matches server.js:57).
- Rows are sorted ascending by time; duplicate timestamps collapse to the last.

## How to run

The conversion is a Node script; the repo already depends on Node. From the
project root:

```bash
node .cursor/skills/replace-session-bars/convert.js <input-path>
```

Flags:

- `--symbol <sym>` — override the symbol (default: read from existing
  `session_bars.csv`, fallback `ESU6`).
- `--out <path>` — override the output path (default: `session_bars.csv`).
- `--no-backup` — skip the backup step (default: rotate existing file to
  `.bak`, pushing older backups to `.bak2` / `.bak3`).

The script prints a summary: written count, time range, dropped rows,
header rows skipped, duplicates collapsed, and the backup path.

## Steps

1. Confirm the input path with the user. If the data was pasted into the
   conversation instead of living on disk, write it to a temp file first
   (e.g. `./minute_import.tsv`) and use that as the input path.
2. Run the converter: `node .cursor/skills/replace-session-bars/convert.js <path>`.
3. Show the user the printed summary (first/last timestamp, count, dropped).
4. Remind the user the server reads `session_bars.csv` only at startup
   ([server.js:301](../../../server.js#L301)) — they'll need to restart
   `npm start` for the new history to show up in the chart.
5. If the input was a temp file created in step 1, delete it after a
   successful run.

## Safety

- The existing `session_bars.csv` is moved to `.bak` (rotating `.bak` →
  `.bak2` → `.bak3`) before being overwritten. To force a clean replace
  without a backup, pass `--no-backup`.
- If the user wants to *append* historical bars to the current session
  rather than replace, this skill is not the right tool — stop and ask.

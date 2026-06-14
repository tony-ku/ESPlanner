#!/usr/bin/env node
// Convert Sierra Chart tab-separated minute bar data to session_bars.csv format.
//
// Source row:  @ES#\t2026-04-05T17:01\t6590.00\t6590.00\t6575.00\t6576.25\t2990\t0
// Target row:  2026-04-05 17:01:00,ESM6,6590,6590,6575,6576.25,2990
//
// Usage:
//   node convert.js <input-file> [--symbol ESM6] [--out session_bars.csv] [--no-backup]
//
// If --symbol is omitted, the symbol is inferred from the first row of the
// existing output file (falling back to ESM6). The existing output file is
// moved to <out>.bak (rotating older backups) unless --no-backup is passed.

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { input: null, symbol: null, out: 'session_bars.csv', backup: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--symbol') args.symbol = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-backup') args.backup = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (!args.input) args.input = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return args;
}

function usage() {
  console.log(
    'Usage: node convert.js <input-file> [--symbol ESM6] [--out session_bars.csv] [--no-backup]'
  );
}

function inferSymbolFromSession(outPath, fallback) {
  try {
    if (!fs.existsSync(outPath)) return fallback;
    const text = fs.readFileSync(outPath, 'utf8');
    const first = text.split(/\r?\n/).find((l) => l.trim().length);
    if (!first) return fallback;
    const parts = first.split(',');
    if (parts.length < 2) return fallback;
    const sym = parts[1].trim();
    return sym || fallback;
  } catch {
    return fallback;
  }
}

// "6590.00" -> "6590"; "7005.50" -> "7005.5"; "7005.25" -> "7005.25"
function fmtPrice(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Match existing session style: no trailing zeros, no forced decimals.
  return String(n);
}

// "2026-04-05T17:01" -> "2026-04-05 17:01:00"
function fmtTime(s) {
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, date, hm, sec] = m;
  const [h, mi] = hm.split(':');
  const hh = h.padStart(2, '0');
  return `${date} ${hh}:${mi}:${sec || '00'}`;
}

function rotateBackup(outPath) {
  if (!fs.existsSync(outPath)) return null;
  // Rotate .bak -> .bak2 -> .bak3, keep 3 generations max.
  const b1 = outPath + '.bak';
  const b2 = outPath + '.bak2';
  const b3 = outPath + '.bak3';
  if (fs.existsSync(b2)) { try { fs.renameSync(b2, b3); } catch {} }
  if (fs.existsSync(b1)) { try { fs.renameSync(b1, b2); } catch {} }
  fs.renameSync(outPath, b1);
  return b1;
}

function convert({ input, symbol, out, backup }) {
  if (!fs.existsSync(input)) throw new Error(`Input file not found: ${input}`);
  const outAbs = path.resolve(out);

  const resolvedSymbol = symbol || inferSymbolFromSession(outAbs, 'ESM6');

  const text = fs.readFileSync(input, 'utf8');
  const lines = text.split(/\r?\n/);
  const bars = [];
  let header = 0;
  let dropped = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    // Accept both tab and multi-space separation; Sierra exports use tabs.
    const parts = line.split(/\t/);
    if (parts.length < 7) { dropped++; continue; }
    const [, dateTime, open, high, low, last, volume] = parts;
    // Skip header row (e.g. "-Ticker\tDate Time\tOpen...").
    if (!/^\d/.test(dateTime)) { header++; continue; }

    const t = fmtTime(dateTime);
    if (!t) { dropped++; continue; }
    const o = fmtPrice(open), h = fmtPrice(high), l = fmtPrice(low), c = fmtPrice(last);
    if (o === null || h === null || l === null || c === null) { dropped++; continue; }
    if (+o <= 0 || +h <= 0 || +l <= 0 || +c <= 0) { dropped++; continue; }
    const v = String(parseInt(volume, 10) || 0);

    bars.push({ t, o, h, l, c, v });
  }

  // Sort strictly ascending by time so server.js sees a clean stream.
  bars.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  // Drop duplicate timestamps (keep last occurrence, matching server tie-break).
  const deduped = [];
  for (const b of bars) {
    if (deduped.length && deduped[deduped.length - 1].t === b.t) {
      deduped[deduped.length - 1] = b;
    } else {
      deduped.push(b);
    }
  }

  let backupPath = null;
  if (backup) backupPath = rotateBackup(outAbs);

  const body = deduped
    .map((b) => `${b.t},${resolvedSymbol},${b.o},${b.h},${b.l},${b.c},${b.v}`)
    .join('\n');
  fs.writeFileSync(outAbs, body ? body + '\n' : '');

  return {
    outPath: outAbs,
    symbol: resolvedSymbol,
    inputLines: lines.length,
    headerSkipped: header,
    dropped,
    written: deduped.length,
    duplicatesCollapsed: bars.length - deduped.length,
    firstTime: deduped[0]?.t || null,
    lastTime: deduped[deduped.length - 1]?.t || null,
    backupPath,
  };
}

function main() {
  let args;
  try { args = parseArgs(process.argv); }
  catch (e) { console.error(e.message); usage(); process.exit(2); }

  if (args.help || !args.input) { usage(); process.exit(args.help ? 0 : 2); }

  try {
    const r = convert(args);
    console.log(`Wrote ${r.written} bars to ${r.outPath}`);
    console.log(`  symbol:      ${r.symbol}`);
    console.log(`  time range:  ${r.firstTime}  ..  ${r.lastTime}`);
    console.log(`  input lines: ${r.inputLines}  (header rows skipped: ${r.headerSkipped})`);
    console.log(`  dropped:     ${r.dropped}  (bad/zero/partial rows)`);
    if (r.duplicatesCollapsed) console.log(`  duplicates:  ${r.duplicatesCollapsed} collapsed`);
    if (r.backupPath) console.log(`  backup:      ${r.backupPath}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { convert };

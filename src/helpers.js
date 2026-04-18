const pad2 = (n) => String(n).padStart(2, '0');

function formatLocalDateTime(epoch) {
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function parseLocalDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Math.floor(d.getTime() / 1000);
}

// Convert "HH:MM:SS" (from the live feed) to epoch seconds using `now`'s date.
// If the parsed time is more than 12h in the future vs now, roll back one day
// (overnight session handling). `now` is injectable for deterministic tests.
function rawTimeToEpoch(rawTime, now = new Date()) {
  const [h, m, s] = rawTime.split(':').map((n) => parseInt(n, 10));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s || 0);
  if (d.getTime() - now.getTime() > 12 * 3600 * 1000) d.setDate(d.getDate() - 1);
  return Math.floor(d.getTime() / 1000);
}

function sanitizeColor(c, fallback) {
  if (typeof c !== 'string') return fallback;
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  return m ? `#${m[1]}` : fallback;
}

// Scan a plan's markdown tables for rows like:
//   | 1 | IBH or IBL | 98.1% | (465) | IBH 6861.50 / IBL 6826.50 |
// Return every probability entry found, each with {label, pct, prices[]}.
function extractProbabilities(md) {
  const out = [];
  const seen = new Set();
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('|') || !line.includes('%')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length && cells[0] === '') cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();

    let pctIdx = -1, pct = null;
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i].match(/^(\d+(?:\.\d+)?)\s*%$/);
      if (m) { pct = parseFloat(m[1]); pctIdx = i; break; }
    }
    if (pct === null || pctIdx <= 0) continue;

    let label = null;
    for (let j = pctIdx - 1; j >= 0; j--) {
      const c = cells[j].replace(/`/g, '').trim();
      if (c && !/^\d+$/.test(c)) { label = c; break; }
    }
    if (!label) continue;

    const prices = [];
    for (let k = pctIdx + 1; k < cells.length; k++) {
      const matches = cells[k].match(/\d{3,5}(?:\.\d+)?/g);
      if (matches) for (const s of matches) {
        const v = parseFloat(s);
        if (Number.isFinite(v) && v > 100) prices.push(v);
      }
    }

    const key = `${label}|${pct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, pct, prices });
  }
  return out;
}

// Parse one row of the minute file. Returns a bar object or null for malformed /
// incomplete rows (not enough columns, bad time format, non-positive prices).
// Note: `time` (epoch seconds) is NOT set here — callers apply rawTimeToEpoch
// so they can control the clock anchor.
function parseMinuteLine(line) {
  if (!line) return null;
  const parts = line.split(',');
  if (parts.length < 7) return null;
  const [rawTime, symbol, open, high, low, close, volume] = parts;
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(rawTime)) return null;
  if (+open <= 0 || +high <= 0 || +low <= 0 || +close <= 0) return null;
  return {
    rawTime,
    symbol,
    open: +open,
    high: +high,
    low: +low,
    close: +close,
    volume: +volume,
  };
}

module.exports = {
  formatLocalDateTime,
  parseLocalDateTime,
  rawTimeToEpoch,
  sanitizeColor,
  extractProbabilities,
  parseMinuteLine,
};

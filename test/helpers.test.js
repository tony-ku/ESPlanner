const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pad2,
  formatLocalDateTime,
  parseLocalDateTime,
  rawTimeToEpoch,
  sanitizeColor,
  extractProbabilities,
  parseMinuteLine,
} = require('../src/helpers');

test('pad2 pads single digits', () => {
  assert.equal(pad2(0), '00');
  assert.equal(pad2(7), '07');
  assert.equal(pad2(10), '10');
  assert.equal(pad2(59), '59');
});

test('parseLocalDateTime parses valid "YYYY-MM-DD HH:MM:SS"', () => {
  const epoch = parseLocalDateTime('2026-04-17 09:30:00');
  const d = new Date(epoch * 1000);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 3); // April
  assert.equal(d.getDate(), 17);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
});

test('parseLocalDateTime rejects malformed input', () => {
  assert.equal(parseLocalDateTime('not-a-date'), null);
  assert.equal(parseLocalDateTime('2026/04/17 09:30:00'), null); // wrong separator
  assert.equal(parseLocalDateTime('2026-04-17T09:30:00'), null); // ISO T
  assert.equal(parseLocalDateTime(''), null);
});

test('parseLocalDateTime accepts single-digit hour', () => {
  const epoch = parseLocalDateTime('2026-04-17 9:30:00');
  assert.ok(epoch != null);
  assert.equal(new Date(epoch * 1000).getHours(), 9);
});

test('formatLocalDateTime round-trips with parseLocalDateTime', () => {
  const s = '2026-04-17 09:30:45';
  assert.equal(formatLocalDateTime(parseLocalDateTime(s)), s);
});

test('formatLocalDateTime pads all fields', () => {
  // 2026-01-02 03:04:05 in local time
  const epoch = parseLocalDateTime('2026-01-02 03:04:05');
  assert.equal(formatLocalDateTime(epoch), '2026-01-02 03:04:05');
});

test('rawTimeToEpoch anchors to `now`\'s date when times are close', () => {
  const now = new Date(2026, 3, 17, 14, 30, 0); // Apr 17 2026 14:30 local
  const epoch = rawTimeToEpoch('14:35:00', now);
  const d = new Date(epoch * 1000);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 3);
  assert.equal(d.getDate(), 17);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 35);
});

test('rawTimeToEpoch rolls back one day when parsed > now + 12h', () => {
  // Just past midnight local; rawTime 23:55 came from late yesterday.
  const now = new Date(2026, 3, 17, 0, 5, 0);
  const epoch = rawTimeToEpoch('23:55:00', now);
  const d = new Date(epoch * 1000);
  assert.equal(d.getDate(), 16); // yesterday
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 55);
});

test('rawTimeToEpoch does NOT roll back at exactly 12h difference', () => {
  // now = 00:00:00; rawTime = 12:00:00 → diff = exactly 12h, condition is strict >.
  const now = new Date(2026, 3, 17, 0, 0, 0);
  const epoch = rawTimeToEpoch('12:00:00', now);
  const d = new Date(epoch * 1000);
  assert.equal(d.getDate(), 17); // same day
  assert.equal(d.getHours(), 12);
});

test('sanitizeColor accepts valid hex formats', () => {
  assert.equal(sanitizeColor('#fff', '#000'), '#fff');
  assert.equal(sanitizeColor('#FFFFFF', '#000'), '#FFFFFF');
  assert.equal(sanitizeColor('#abcdef12', '#000'), '#abcdef12'); // 8-digit alpha
});

test('sanitizeColor trims whitespace', () => {
  assert.equal(sanitizeColor('  #fff  ', '#000'), '#fff');
});

test('sanitizeColor rejects invalid input with fallback', () => {
  assert.equal(sanitizeColor('red', '#111'), '#111');
  assert.equal(sanitizeColor('#GGG', '#111'), '#111');
  assert.equal(sanitizeColor('#ff', '#111'), '#111'); // 2 digits not allowed
  assert.equal(sanitizeColor('#fffff', '#111'), '#111'); // 5 digits not allowed
  assert.equal(sanitizeColor(undefined, '#111'), '#111');
  assert.equal(sanitizeColor(null, '#111'), '#111');
  assert.equal(sanitizeColor(123, '#111'), '#111');
});

test('extractProbabilities pulls label/pct/prices from a standard row', () => {
  // Note: the heuristic treats every 3-5 digit number > 100 to the right of the
  // pct cell as a price, so a numeric count column like "(465)" is included.
  // This is the documented behavior — the parser is deliberately lenient.
  const md = '| 1 | IBH or IBL | 98.1% | (465) | IBH 6861.50 / IBL 6826.50 |';
  const out = extractProbabilities(md);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { label: 'IBH or IBL', pct: 98.1, prices: [465, 6861.50, 6826.50] });
});

test('extractProbabilities dedupes identical (label, pct) pairs', () => {
  const md = [
    '| 1 | VAH | 50% | ref 6000 |',
    '| 2 | VAH | 50% | ref 6000 |',
  ].join('\n');
  const out = extractProbabilities(md);
  assert.equal(out.length, 1);
});

test('extractProbabilities skips rows with no percent', () => {
  const md = '| label | value | 6000 |';
  assert.equal(extractProbabilities(md).length, 0);
});

test('extractProbabilities skips rows whose only cell before % is numeric', () => {
  // pctIdx must be > 0 and there must be a non-numeric cell before it.
  const md = '| 1 | 75% |';
  assert.equal(extractProbabilities(md).length, 0);
});

test('extractProbabilities filters prices <= 100', () => {
  const md = '| 1 | IBH | 60% | 50 / 99 / 200.5 |';
  const out = extractProbabilities(md);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].prices, [200.5]);
});

test('extractProbabilities ignores non-table lines', () => {
  const md = 'prose without a pipe and with 50% in it';
  assert.equal(extractProbabilities(md).length, 0);
});

test('parseMinuteLine returns bar object for valid row', () => {
  const out = parseMinuteLine('15:14:03,ESM6,7002,7003,7002,7002.5,966');
  assert.deepEqual(out, {
    rawTime: '15:14:03',
    symbol: 'ESM6',
    open: 7002,
    high: 7003,
    low: 7002,
    close: 7002.5,
    volume: 966,
  });
});

test('parseMinuteLine rejects rows with <7 fields', () => {
  assert.equal(parseMinuteLine('15:14:03,ESM6,7002,7003'), null);
  assert.equal(parseMinuteLine(''), null);
  assert.equal(parseMinuteLine(null), null);
});

test('parseMinuteLine rejects malformed rawTime', () => {
  assert.equal(parseMinuteLine('not-a-time,ESM6,7002,7003,7002,7002.5,966'), null);
  assert.equal(parseMinuteLine('25-14-03,ESM6,7002,7003,7002,7002.5,966'), null);
});

test('parseMinuteLine rejects rows with any non-positive OHLC price', () => {
  assert.equal(parseMinuteLine('15:14:03,ESM6,0,7003,7002,7002.5,966'), null);
  assert.equal(parseMinuteLine('15:14:03,ESM6,7002,0,7002,7002.5,966'), null);
  assert.equal(parseMinuteLine('15:14:03,ESM6,7002,7003,0,7002.5,966'), null);
  assert.equal(parseMinuteLine('15:14:03,ESM6,7002,7003,7002,0,966'), null);
  assert.equal(parseMinuteLine('15:14:03,ESM6,-1,7003,7002,7002.5,966'), null);
});

test('parseMinuteLine accepts single-digit hour in rawTime', () => {
  const out = parseMinuteLine('9:30:00,ESM6,7002,7003,7002,7002.5,966');
  assert.ok(out);
  assert.equal(out.rawTime, '9:30:00');
});

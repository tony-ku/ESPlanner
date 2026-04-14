require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { parse } = require('csv-parse/sync');
const { marked } = require('marked');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MINUTE_FILE = process.env.MINUTE_FILE;
const LEVELS_FILE = process.env.LEVELS_FILE;
const PLANS_DIR = process.env.PLANS_DIR;
const POLL_MS = parseInt(process.env.POLL_MS || '1000', 10);
const HISTORY_DAYS = parseFloat(process.env.HISTORY_DAYS || '2');
const SESSION_FILE = path.resolve(process.env.SESSION_FILE || './session_bars.csv');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---------- SSE clients ----------
const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  clients.add(res);
  // Prime the new client with current state
  res.write(`event: snapshot\ndata: ${JSON.stringify({ bars, levels })}\n\n`);
  req.on('close', () => clients.delete(res));
});

// ---------- Bars ----------
let bars = []; // [{time: epochSeconds, open, high, low, close, volume, symbol, rawTime}]
let lastRawTime = null;

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return;
  try {
    const text = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    if (!text) return;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const [time, symbol, open, high, low, close, volume, rawTime] = line.split(',');
      bars.push({
        time: parseInt(time, 10),
        symbol,
        open: +open,
        high: +high,
        low: +low,
        close: +close,
        volume: +volume,
        rawTime,
      });
    }
    pruneOld();
    if (bars.length) lastRawTime = bars[bars.length - 1].rawTime;
    console.log(`Loaded ${bars.length} bars from session`);
  } catch (e) {
    console.error('Failed to load session:', e.message);
  }
}

function appendSession(bar) {
  const line = `${bar.time},${bar.symbol},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume},${bar.rawTime}\n`;
  fs.appendFile(SESSION_FILE, line, (err) => {
    if (err) console.error('Session append failed:', err.message);
  });
}

function rewriteSession() {
  const text = bars
    .map((b) => `${b.time},${b.symbol},${b.open},${b.high},${b.low},${b.close},${b.volume},${b.rawTime}`)
    .join('\n');
  fs.writeFile(SESSION_FILE, text ? text + '\n' : '', (err) => {
    if (err) console.error('Session rewrite failed:', err.message);
  });
}

function pruneOld() {
  if (bars.length === 0) return false;
  const newest = bars[bars.length - 1].time;
  const cutoff = newest - HISTORY_DAYS * 86400;
  const before = bars.length;
  bars = bars.filter((b) => b.time >= cutoff);
  return bars.length !== before;
}

// Convert "HH:MM:SS" to epoch seconds using today's date (local time).
function rawTimeToEpoch(rawTime) {
  const [h, m, s] = rawTime.split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s || 0);
  // If the parsed time is more than 12h in the future vs now, assume it was yesterday.
  if (d.getTime() - now.getTime() > 12 * 3600 * 1000) d.setDate(d.getDate() - 1);
  return Math.floor(d.getTime() / 1000);
}

function pollMinuteFile() {
  fs.readFile(MINUTE_FILE, 'utf8', (err, text) => {
    if (err) return; // file may be mid-write; try again next tick
    const line = text.trim().split(/\r?\n/).pop();
    if (!line) return;
    const parts = line.split(',');
    if (parts.length < 7) return;
    const [rawTime, symbol, open, high, low, close, volume] = parts;
    if (rawTime === lastRawTime) return;

    const bar = {
      time: rawTimeToEpoch(rawTime),
      symbol,
      open: +open,
      high: +high,
      low: +low,
      close: +close,
      volume: +volume,
      rawTime,
    };

    // Lightweight Charts requires strictly increasing time. Replace if same second.
    if (bars.length && bars[bars.length - 1].time === bar.time) {
      bars[bars.length - 1] = bar;
      rewriteSession();
    } else if (bars.length && bars[bars.length - 1].time > bar.time) {
      // ignore out-of-order
      return;
    } else {
      bars.push(bar);
      appendSession(bar);
    }

    lastRawTime = rawTime;
    const pruned = pruneOld();
    if (pruned) rewriteSession();
    broadcast('bar', bar);
  });
}

// ---------- Levels ----------
let levels = [];

function loadLevels() {
  if (!LEVELS_FILE || !fs.existsSync(LEVELS_FILE)) {
    levels = [];
    return;
  }
  try {
    const text = fs.readFileSync(LEVELS_FILE, 'utf8');
    const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
    const sanitizeColor = (c, fallback) => {
      if (typeof c !== 'string') return fallback;
      const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
      return m ? `#${m[1]}` : fallback;
    };
    levels = rows
      .map((r) => ({
        symbol: r['Symbol'],
        price: parseFloat(r['Price Level']),
        note: r['Note'] || '',
        fg: sanitizeColor(r['Foreground Color'], '#FFFFFF'),
        bg: sanitizeColor(r['Background Color'], '#3b6b01'),
      }))
      .filter((l) => Number.isFinite(l.price) && l.price > 0);
  } catch (e) {
    console.error('Levels parse failed:', e.message);
    levels = [];
  }
}

// ---------- Plans ----------
function listPlans() {
  if (!PLANS_DIR || !fs.existsSync(PLANS_DIR)) return [];
  return fs
    .readdirSync(PLANS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort()
    .reverse();
}

app.get('/api/plans', (req, res) => {
  res.json({ files: listPlans() });
});

app.get('/api/plans/:name', (req, res) => {
  const name = req.params.name;
  if (!/^[\w\-.]+\.md$/i.test(name)) return res.status(400).send('bad name');
  const p = path.join(PLANS_DIR, name);
  if (!p.startsWith(path.resolve(PLANS_DIR))) return res.status(400).send('bad path');
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  const md = fs.readFileSync(p, 'utf8');
  res.json({ name, html: marked.parse(md) });
});

// ---------- Watchers ----------
if (LEVELS_FILE) {
  loadLevels();
  chokidar.watch(LEVELS_FILE, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
    .on('all', () => {
      loadLevels();
      broadcast('levels', levels);
    });
}

if (PLANS_DIR) {
  chokidar.watch(PLANS_DIR, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 200 } })
    .on('all', () => broadcast('plans', { files: listPlans() }));
}

loadSession();
setInterval(pollMinuteFile, POLL_MS);
pollMinuteFile();

app.listen(PORT, () => {
  console.log(`ESPlanner running at http://localhost:${PORT}`);
  console.log(`  minute file: ${MINUTE_FILE}`);
  console.log(`  levels file: ${LEVELS_FILE}`);
  console.log(`  plans dir:   ${PLANS_DIR}`);
});

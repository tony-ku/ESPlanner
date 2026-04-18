require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { parse } = require('csv-parse/sync');
const { marked } = require('marked');
const {
  formatLocalDateTime,
  parseLocalDateTime,
  rawTimeToEpoch,
  sanitizeColor,
  extractProbabilities,
  parseMinuteLine,
} = require('./src/helpers');

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
  res.write(`event: snapshot\ndata: ${JSON.stringify({ bars, levels, planStats: planStatsFor(todaysPlanName()) })}\n\n`);
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
    let dropped = 0;
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length < 7) { dropped++; continue; }
      const [dateTime, symbol, open, high, low, close, volume] = parts;
      const epoch = parseLocalDateTime(dateTime);
      if (epoch == null) { dropped++; continue; }
      if (+open <= 0 || +high <= 0 || +low <= 0 || +close <= 0) { dropped++; continue; }
      bars.push({
        time: epoch,
        symbol,
        open: +open,
        high: +high,
        low: +low,
        close: +close,
        volume: +volume,
        rawTime: dateTime.slice(11), // "HH:MM:SS" for display
      });
    }
    // Enforce strictly increasing time (restart after midnight can cause ties).
    bars.sort((a, b) => a.time - b.time);
    const pruned = pruneOld();
    if (bars.length) lastRawTime = bars[bars.length - 1].rawTime;
    if (dropped || pruned) rewriteSession();
    console.log(`Loaded ${bars.length} bars from session${dropped ? ` (dropped ${dropped})` : ''}`);
  } catch (e) {
    console.error('Failed to load session:', e.message);
  }
}

function appendSession(bar) {
  const line = `${formatLocalDateTime(bar.time)},${bar.symbol},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}\n`;
  fs.appendFile(SESSION_FILE, line, (err) => {
    if (err) console.error('Session append failed:', err.message);
  });
}

function rewriteSession() {
  const text = bars
    .map((b) => `${formatLocalDateTime(b.time)},${b.symbol},${b.open},${b.high},${b.low},${b.close},${b.volume}`)
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

function pollMinuteFile() {
  fs.readFile(MINUTE_FILE, 'utf8', (err, text) => {
    if (err) return; // file may be mid-write; try again next tick
    const line = text.trim().split(/\r?\n/).pop();
    const parsed = parseMinuteLine(line);
    if (!parsed) return;
    if (parsed.rawTime === lastRawTime) return;

    const bar = { ...parsed, time: rawTimeToEpoch(parsed.rawTime) };

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

    lastRawTime = parsed.rawTime;
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

function planStatsFor(name) {
  if (!PLANS_DIR || !name) return null;
  const p = path.join(PLANS_DIR, name);
  if (!fs.existsSync(p)) return null;
  try {
    const md = fs.readFileSync(p, 'utf8');
    const probabilities = extractProbabilities(md);
    return { name, probabilities };
  } catch {
    return null;
  }
}

function todaysPlanName() {
  const files = listPlans();
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = `trading-plan-${today}.md`;
  return files.includes(todayFile) ? todayFile : files[0] || null;
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
    .on('all', () => {
      broadcast('plans', { files: listPlans() });
      broadcast('plan-stats', planStatsFor(todaysPlanName()));
    });
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

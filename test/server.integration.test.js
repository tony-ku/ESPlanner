const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

// Grab an OS-assigned free TCP port.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Wait for a condition (async predicate) with a timeout.
async function waitFor(predicate, timeoutMs = 5000, pollMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('waitFor timed out');
}

// Parse SSE chunks from a streaming response body into {event, data} objects.
// Pushes each event into `sink` as it arrives.
function attachSseParser(body, sink) {
  const decoder = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for await (const chunk of body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          sink.push({ event, data });
        }
      }
    } catch {
      // body closed; ignore
    }
  })();
}

test('server ingests minute file, dedupes, emits SSE for bars and levels', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esplanner-'));
  const minuteFile = path.join(tmp, 'one_min.csv');
  const levelsFile = path.join(tmp, 'cn.csv');
  const plansDir = path.join(tmp, 'plans');
  const sessionFile = path.join(tmp, 'session.csv');
  fs.mkdirSync(plansDir);
  fs.writeFileSync(minuteFile, '');
  // chokidar requires the levels file to exist when the server starts.
  fs.writeFileSync(levelsFile, 'Symbol,Price Level,Note,Foreground Color,Background Color\n');

  const port = await freePort();
  const serverPath = path.join(__dirname, '..', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      MINUTE_FILE: minuteFile,
      LEVELS_FILE: levelsFile,
      PLANS_DIR: plansDir,
      POLL_MS: '50',
      SESSION_FILE: sessionFile,
      HISTORY_DAYS: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    child.kill();
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Wait for "running at" banner so we know the server is listening.
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server never logged ready')), 5000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running at')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
  });

  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: ac.signal });
  assert.equal(res.status, 200);
  const events = [];
  attachSseParser(res.body, events);
  t.after(() => ac.abort());

  const countOf = (type) => events.reduce((n, e) => n + (e.event === type ? 1 : 0), 0);
  const lastOf = (type) => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].event === type) return events[i];
    return undefined;
  };

  // 1) snapshot arrives immediately
  await waitFor(() => countOf('snapshot') > 0);
  const snap = JSON.parse(lastOf('snapshot').data);
  assert.ok(Array.isArray(snap.bars));
  assert.ok(Array.isArray(snap.levels));

  // 2) writing a bar row produces a 'bar' event with matching OHLCV
  const barsBefore = countOf('bar');
  fs.writeFileSync(minuteFile, '15:14:03,ESM6,7002,7003,7002,7002.5,966\n');
  await waitFor(() => countOf('bar') > barsBefore);
  const barEvt = JSON.parse(lastOf('bar').data);
  assert.equal(barEvt.symbol, 'ESM6');
  assert.equal(barEvt.open, 7002);
  assert.equal(barEvt.close, 7002.5);
  assert.equal(barEvt.volume, 966);
  assert.equal(barEvt.rawTime, '15:14:03');

  // 3) re-writing the same row does NOT produce another bar event
  const barsAfterFirst = countOf('bar');
  fs.writeFileSync(minuteFile, '15:14:03,ESM6,7002,7003,7002,7002.5,966\n');
  await new Promise((r) => setTimeout(r, 300)); // several poll cycles at POLL_MS=50
  assert.equal(countOf('bar'), barsAfterFirst, 'duplicate row should have been deduped');

  // 4) updating the levels file produces a 'levels' event
  const levelsBefore = countOf('levels');
  fs.writeFileSync(levelsFile,
    'Symbol,Price Level,Note,Foreground Color,Background Color\n' +
    'ESM6,7010,VAH,#FFFFFF,#3b6b01\n');
  // chokidar awaitWriteFinish stabilityThreshold is 200ms — give it margin.
  await waitFor(() => countOf('levels') > levelsBefore, 5000);
  const lvlEvt = JSON.parse(lastOf('levels').data);
  assert.ok(Array.isArray(lvlEvt));
  assert.equal(lvlEvt.length, 1);
  assert.equal(lvlEvt[0].note, 'VAH');
  assert.equal(lvlEvt[0].price, 7010);
  assert.equal(lvlEvt[0].bg, '#3b6b01');
});

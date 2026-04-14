const chartEl = document.getElementById('chart');
const statusEl = document.getElementById('status');
const symbolEl = document.getElementById('symbol');
const lastBarEl = document.getElementById('last-bar');
const planSelect = document.getElementById('plan-select');
const planContent = document.getElementById('plan-content');

const tileLast = document.getElementById('tile-last');
const tileChange = document.getElementById('tile-change');
const tileOhl = document.getElementById('tile-ohl');
const tileRange = document.getElementById('tile-range');
const tileVol = document.getElementById('tile-vol');
const tileBars = document.getElementById('tile-bars');
const tileNear = document.getElementById('tile-near');
const tileNearDist = document.getElementById('tile-near-dist');
const tileVa = document.getElementById('tile-va');

const chart = LightweightCharts.createChart(chartEl, {
  autoSize: true,
  layout: { background: { color: '#150a24' }, textColor: '#c9a0ff' },
  grid: { vertLines: { color: '#2a163f' }, horzLines: { color: '#2a163f' } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#4a2352' },
  rightPriceScale: { borderColor: '#4a2352' },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#7ee787', downColor: '#ff6b8a',
  borderUpColor: '#7ee787', borderDownColor: '#ff6b8a',
  wickUpColor: '#7ee787', wickDownColor: '#ff6b8a',
});

const volumeSeries = chart.addHistogramSeries({
  priceFormat: { type: 'volume' },
  priceScaleId: 'vol',
  color: '#4a2352',
});
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

// ---------- State ----------
let bars = [];
let allLevels = [];
let priceLines = [];
let lastClose = null;

// ---------- Level categorization ----------
const GROUP_RULES = [
  { group: 'va',        match: (n) => /^(VAH|VAL|POC)$/i.test(n) },
  { group: 'intraday',  match: (n) => /^(IBH|IBL|IBH30|IBL30|2xIBH|2xIBL|rthOP)$/i.test(n) },
  { group: 'reference', match: (n) => /^(rthHI|rthLO|ethHI|ethLO|ethMID|onVPOC)$/i.test(n) },
  { group: 'prior',     match: (n) => /^(pVAH|pVAL|yVPOC|yHI|yLO|pCL|pWHI|pWLO)$/i.test(n) },
  { group: 'hvn',       match: (n) => /^HVN$/i.test(n) },
  { group: 'lvn',       match: (n) => /^LVN$/i.test(n) },
];
function groupFor(note) {
  for (const r of GROUP_RULES) if (r.match(note)) return r.group;
  return null;
}

// ---------- Rendering ----------
function drawLevels() {
  for (const pl of priceLines) candleSeries.removePriceLine(pl);
  priceLines = [];

  const band = lastClose ? lastClose * 0.02 : Infinity;
  for (const lv of allLevels) {
    const inBand = lastClose ? Math.abs(lv.price - lastClose) <= band : true;
    if (!inBand) continue;
    const line = candleSeries.createPriceLine({
      price: lv.price,
      color: lv.bg,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: lv.note,
    });
    priceLines.push(line);
  }

  renderLevelTables();
}

function renderLevelTables() {
  const tables = document.querySelectorAll('#levels-grid table');
  const byGroup = { va: [], intraday: [], reference: [], prior: [], hvn: [], lvn: [] };
  for (const lv of allLevels) {
    const g = groupFor(lv.note);
    if (g) byGroup[g].push(lv);
  }

  let nearest = null;
  if (lastClose) {
    for (const lv of allLevels) {
      const d = Math.abs(lv.price - lastClose);
      if (nearest === null || d < nearest.d) nearest = { lv, d };
    }
  }

  for (const t of tables) {
    const g = t.dataset.group;
    const rows = byGroup[g] || [];
    // Sort descending by price so higher levels appear on top.
    rows.sort((a, b) => b.price - a.price);
    t.innerHTML = rows.map((lv) => {
      const nearClass = nearest && nearest.lv === lv ? ' class="near"' : '';
      return `<tr${nearClass}><td>${escapeHtml(lv.note)}</td><td>${lv.price.toFixed(2)}</td></tr>`;
    }).join('') || '<tr><td colspan="2" style="color:#555">&mdash;</td></tr>';
  }
}

function updateTiles() {
  if (!bars.length) return;
  const last = bars[bars.length - 1];
  const first = bars[0];

  const up = last.close >= first.open;
  tileLast.textContent = last.close.toFixed(2);
  tileLast.className = 'tile-value big ' + (up ? 'up' : 'down');
  const chg = last.close - first.open;
  const pct = (chg / first.open) * 100;
  tileChange.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;

  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  tileOhl.textContent = `${first.open.toFixed(2)} / ${hi.toFixed(2)} / ${lo.toFixed(2)}`;
  tileRange.textContent = `Range ${(hi - lo).toFixed(2)}`;

  const vol = bars.reduce((s, b) => s + (b.volume || 0), 0);
  tileVol.textContent = vol.toLocaleString();
  tileBars.textContent = `${bars.length} bars`;

  // Nearest level
  let nearest = null;
  for (const lv of allLevels) {
    const d = Math.abs(lv.price - last.close);
    if (nearest === null || d < nearest.d) nearest = { lv, d };
  }
  if (nearest) {
    tileNear.textContent = `${nearest.lv.note} @ ${nearest.lv.price.toFixed(2)}`;
    const sign = nearest.lv.price > last.close ? '+' : '-';
    tileNearDist.textContent = `${sign}${nearest.d.toFixed(2)} from last`;
  } else {
    tileNear.textContent = '—';
    tileNearDist.textContent = '—';
  }

  // Value area
  const va = { VAH: null, POC: null, VAL: null };
  for (const lv of allLevels) if (va[lv.note] === null && lv.note in va) va[lv.note] = lv.price;
  tileVa.innerHTML = [
    va.VAH !== null ? `VAH&nbsp;${va.VAH.toFixed(2)}` : '',
    va.POC !== null ? `POC&nbsp;${va.POC.toFixed(2)}` : '',
    va.VAL !== null ? `VAL&nbsp;${va.VAL.toFixed(2)}` : '',
  ].filter(Boolean).join('<br>') || '—';
}

function setBars(newBars) {
  bars = newBars;
  const candles = bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
  const volumes = bars.map((b) => ({
    time: b.time,
    value: b.volume,
    color: b.close >= b.open ? 'rgba(126,231,135,0.5)' : 'rgba(255,107,138,0.5)',
  }));
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  if (bars.length) {
    const last = bars[bars.length - 1];
    symbolEl.textContent = last.symbol;
    lastClose = last.close;
    updateLastBar(last);
    drawLevels();
    updateTiles();
    chart.timeScale().fitContent();
  }
}

function updateBar(b) {
  // Append or replace last
  if (bars.length && bars[bars.length - 1].time === b.time) bars[bars.length - 1] = b;
  else bars.push(b);
  candleSeries.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
  volumeSeries.update({
    time: b.time,
    value: b.volume,
    color: b.close >= b.open ? 'rgba(126,231,135,0.5)' : 'rgba(255,107,138,0.5)',
  });
  symbolEl.textContent = b.symbol;
  lastClose = b.close;
  updateLastBar(b);
  drawLevels();
  updateTiles();
}

function setLevels(levels) { allLevels = levels; drawLevels(); updateTiles(); }

function updateLastBar(b) {
  lastBarEl.textContent = `${b.rawTime}  O ${b.open}  H ${b.high}  L ${b.low}  C ${b.close}  V ${b.volume}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Plans ----------
async function loadPlanList(preferredName) {
  const { files } = await fetch('/api/plans').then((r) => r.json());
  planSelect.innerHTML = '';
  for (const f of files) {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f.replace(/\.md$/, '');
    planSelect.appendChild(opt);
  }
  const today = new Date().toISOString().slice(0, 10);
  const todayFile = `trading-plan-${today}.md`;
  const pick = preferredName && files.includes(preferredName) ? preferredName
    : files.includes(todayFile) ? todayFile
    : files[0];
  if (pick) {
    planSelect.value = pick;
    loadPlan(pick);
  } else {
    planContent.textContent = 'No trading plans found.';
  }
}

async function loadPlan(name) {
  const { html } = await fetch(`/api/plans/${encodeURIComponent(name)}`).then((r) => r.json());
  planContent.innerHTML = html;
}

planSelect.addEventListener('change', () => loadPlan(planSelect.value));

// ---------- SSE ----------
function connect() {
  const es = new EventSource('/events');
  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    allLevels = data.levels;
    setBars(data.bars);
    statusEl.textContent = 'live';
    statusEl.className = 'ok';
  });
  es.addEventListener('bar', (e) => updateBar(JSON.parse(e.data)));
  es.addEventListener('levels', (e) => setLevels(JSON.parse(e.data)));
  es.addEventListener('plans', () => loadPlanList(planSelect.value));
  es.onerror = () => { statusEl.textContent = 'disconnected'; statusEl.className = 'err'; };
}

// ---------- Resize splitters ----------
const LS_W = 'esplanner.planWidth';
const LS_H = 'esplanner.mainHeight';
const savedW = parseInt(localStorage.getItem(LS_W), 10);
const savedH = parseInt(localStorage.getItem(LS_H), 10);
if (Number.isFinite(savedW) && savedW > 200) document.documentElement.style.setProperty('--plan-width', savedW + 'px');
if (Number.isFinite(savedH) && savedH > 200) document.documentElement.style.setProperty('--main-height', savedH + 'px');

function attachVSplit() {
  const el = document.getElementById('split-v');
  const mainEl = document.querySelector('main');
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const rect = mainEl.getBoundingClientRect();
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--plan-width')) || 560;
    document.body.classList.add('resizing', 'resizing-v');
    el.classList.add('dragging');
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      let w = startW - dx;
      const max = rect.width - 300;
      w = Math.max(260, Math.min(max, w));
      document.documentElement.style.setProperty('--plan-width', w + 'px');
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing', 'resizing-v');
      el.classList.remove('dragging');
      localStorage.setItem(LS_W, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--plan-width'), 10));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function attachHSplit() {
  const el = document.getElementById('split-h');
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--main-height')) || 560;
    document.body.classList.add('resizing', 'resizing-h');
    el.classList.add('dragging');
    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      let h = startH + dy;
      h = Math.max(240, Math.min(window.innerHeight - 200, h));
      document.documentElement.style.setProperty('--main-height', h + 'px');
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing', 'resizing-h');
      el.classList.remove('dragging');
      localStorage.setItem(LS_H, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--main-height'), 10));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

attachVSplit();
attachHSplit();

loadPlanList();
connect();

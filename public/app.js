const chartEl = document.getElementById('chart');
const statusEl = document.getElementById('status');
const symbolEl = document.getElementById('symbol');
const lastBarEl = document.getElementById('last-bar');
const planSelect = document.getElementById('plan-select');
const planContent = document.getElementById('plan-content');
const levelsBody = document.querySelector('#levels-table tbody');

const chart = LightweightCharts.createChart(chartEl, {
  autoSize: true,
  layout: { background: { color: '#0e1117' }, textColor: '#c7c7c7' },
  grid: { vertLines: { color: '#1a1f29' }, horzLines: { color: '#1a1f29' } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#333' },
  rightPriceScale: { borderColor: '#333' },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#26a69a', downColor: '#ef5350',
  borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});

const volumeSeries = chart.addHistogramSeries({
  priceFormat: { type: 'volume' },
  priceScaleId: 'vol',
  color: '#3a4454',
});
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

window.addEventListener('resize', () => chart.resize(chartEl.clientWidth, chartEl.clientHeight));

let priceLines = [];
let allLevels = [];
let lastClose = null;

function drawLevels() {
  for (const pl of priceLines) candleSeries.removePriceLine(pl);
  priceLines = [];
  levelsBody.innerHTML = '';
  // Only draw levels within +/- 2% of the latest close so they don't blow up the
  // auto-scaled price range. The full list still shows in the side table.
  const band = lastClose ? lastClose * 0.02 : Infinity;
  for (const lv of allLevels) {
    const inBand = lastClose ? Math.abs(lv.price - lastClose) <= band : true;
    if (inBand) {
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
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="level-swatch" style="background:${lv.bg};color:${lv.fg}">${escapeHtml(lv.note)}</span></td><td>${lv.price.toFixed(2)}</td>`;
    levelsBody.appendChild(tr);
  }
}

function setLevels(levels) { allLevels = levels; drawLevels(); }

function setBars(bars) {
  const candles = bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
  const volumes = bars.map((b) => ({
    time: b.time,
    value: b.volume,
    color: b.close >= b.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
  }));
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  if (bars.length) {
    const last = bars[bars.length - 1];
    symbolEl.textContent = last.symbol;
    lastClose = last.close;
    updateLastBar(last);
    drawLevels();
    chart.timeScale().fitContent();
  }
}

function updateBar(b) {
  candleSeries.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
  volumeSeries.update({
    time: b.time,
    value: b.volume,
    color: b.close >= b.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
  });
  symbolEl.textContent = b.symbol;
  lastClose = b.close;
  updateLastBar(b);
  drawLevels();
}

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
    const { bars, levels } = JSON.parse(e.data);
    allLevels = levels;
    setBars(bars);
    statusEl.textContent = 'live';
    statusEl.className = 'ok';
  });
  es.addEventListener('bar', (e) => updateBar(JSON.parse(e.data)));
  es.addEventListener('levels', (e) => setLevels(JSON.parse(e.data)));
  es.addEventListener('plans', () => loadPlanList(planSelect.value));
  es.onerror = () => { statusEl.textContent = 'disconnected'; statusEl.className = 'err'; };
}

loadPlanList();
connect();

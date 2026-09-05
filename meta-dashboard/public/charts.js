/**
 * Chart rendering, backed by Chart.js (loaded locally from public/vendor/,
 * copied there at `npm install` time - no CDN, no bundler).
 *
 * linePlot / barChart / scatterPlot keep the exact call signature they had
 * when they drew raw SVG by hand, so the views that call them (app.js) did
 * not need to change - only what happens inside these functions did.
 * calendarHeatmap and the inline sparklines stay hand-rolled SVG: Chart.js has
 * no clean native chart type for either, and forcing them through it would
 * cost more risk than a few dozen lines of SVG are worth.
 *
 * Design rules unchanged from the hand-rolled version:
 *  - never two y-scales on one plot; two measures become two stacked plots
 *    sharing an x-axis
 *  - categorical colours come from fixed slots, assigned by entity, never cycled
 *  - status colours (good/warning/serious/critical) are reserved for state and
 *    always ship with a label, never colour alone
 *  - every chart gets a hand-built HTML tooltip via Chart.js's "external
 *    tooltip" hook, so tooltip styling stays pixel-identical to before
 */

const ChartJS = window.Chart;
if (!ChartJS) {
  // Fails loudly rather than silently drawing nothing: if this fires, either
  // `npm install` didn't run (so public/vendor/chart.umd.js is missing) or
  // index.html's script tag came after this module instead of before it.
  console.error('[charts] window.Chart is not defined. Run `npm install` (it copies Chart.js into public/vendor/) and confirm index.html loads /vendor/chart.umd.js before /app.js.');
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  return node;
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const palette = () => ({
  series: [css('--series-1'), css('--series-2'), css('--series-3')],
  good: css('--status-good'), warning: css('--status-warning'),
  serious: css('--status-serious'), critical: css('--status-critical'),
  grid: css('--grid'), axis: css('--axis'), muted: css('--ink-muted'),
  surface: css('--surface-1'), ink: css('--ink-primary'), ink2: css('--ink-secondary'),
  font: css('--font') || 'system-ui, sans-serif',
});

if (ChartJS) {
  // Font family is theme-invariant, so this is safe to set once rather than
  // passing it into every scale/tick option on every render.
  ChartJS.defaults.font.family = css('--font') || 'system-ui, sans-serif';
  ChartJS.defaults.font.size = 10.5;
}

const withAlpha = (hex, alpha) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

// --- shared HTML tooltip, reused by every Chart.js chart below --------------
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}
function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  let top = y - r.height / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}
export const hideTip = () => { if (tip) tip.hidden = true; };

/** Chart.js's documented pattern for a fully custom HTML tooltip. */
function externalTooltip(buildHtml) {
  return (context) => {
    const { chart, tooltip: tt } = context;
    if (tt.opacity === 0 || !tt.dataPoints?.length) { hideTip(); return; }
    const html = buildHtml(tt);
    if (!html) { hideTip(); return; }
    const rect = chart.canvas.getBoundingClientRect();
    showTip(html, rect.left + tt.caretX, rect.top + tt.caretY);
  };
}

// --- small inline Chart.js plugins, attached per-chart (never globally
// registered, so re-rendering a chart never risks a duplicate-plugin clash) --

/** Vertical hover line across the plot area, replacing the old SVG crosshair. */
const crosshairPlugin = {
  id: 'afCrosshair',
  afterDatasetsDraw(chart, _args, options) {
    const active = chart.getActiveElements();
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = options?.color || 'rgba(0,0,0,.25)';
    ctx.stroke();
    ctx.restore();
  },
};

/** Dashed horizontal reference line(s) - break-even, target - with a label. */
const refLinesPlugin = {
  id: 'afRefLines',
  afterDraw(chart, _args, options) {
    const lines = options?.lines;
    if (!lines?.length) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.font = `600 10px ${ChartJS.defaults.font.family}`;
    ctx.textAlign = 'right';
    for (const line of lines) {
      const y = scales.y.getPixelForValue(line.value);
      if (y < chartArea.top - 1 || y > chartArea.bottom + 1) continue;
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = line.color;
      ctx.fillText(line.label, chartArea.right, y - 6);
    }
    ctx.restore();
  },
};

/** Right-aligned value label per horizontal bar, replacing the old SVG text. */
const barValueLabelsPlugin = {
  id: 'afBarValues',
  afterDatasetsDraw(chart, _args, options) {
    if (!options) return;
    const { ctx, chartArea } = chart;
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.fillStyle = options.color || '#000';
    ctx.font = `600 12px ${ChartJS.defaults.font.family}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    meta.data.forEach((bar, i) => {
      ctx.fillText(options.format(options.values[i]), chartArea.right, bar.y);
    });
    ctx.restore();
  },
};

// --- Chart lifecycle: destroy the previous instance before redrawing into
// the same container, so repeated tab switches / 15-minute syncs don't leak
// canvases or risk a stale chart referencing a removed one. ------------------
const chartRegistry = new WeakMap();
function destroyChart(container) {
  const existing = chartRegistry.get(container);
  if (existing) { try { existing.destroy(); } catch { /* already gone */ } }
  chartRegistry.delete(container);
}

export const fmt = {
  money: (v, cur = 'EGP', dp = 0) => `${cur} ${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })}`,
  compact: (v) => {
    const n = Number(v || 0);
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
    return n.toFixed(0);
  },
  num: (v, dp = 0) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp }),
  pct: (v, dp = 1) => `${Number(v || 0).toFixed(dp)}%`,
  x: (v, dp = 2) => `${Number(v || 0).toFixed(dp)}x`,
  delta: (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` : '—'),
  day: (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
};

/**
 * One plot with a shared x-axis. Multiple series are allowed only when they
 * share a scale (e.g. a raw line and its own rolling mean).
 */
export function linePlot(container, {
  series = [], height = 190, yFormat = fmt.compact, valueFormat = null,
  area = false, refLine = null, refLabel = 'break-even', yMin = 0,
} = {}) {
  const p = palette();
  destroyChart(container);
  container.innerHTML = '';

  const points = series[0]?.points || [];
  if (!points.length) {
    container.innerHTML = '<p class="chart-empty">No data in this window.</p>';
    return;
  }

  container.style.position = 'relative';
  container.style.height = `${height}px`;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const labels = points.map((pt) => pt.label ?? pt.x);
  const datasets = series.map((s, si) => {
    const colour = s.color || p.series[si % p.series.length];
    return {
      label: s.name,
      data: s.points.map((pt) => pt.y),
      borderColor: colour,
      backgroundColor: area && si === 0
        ? (ctx) => {
          const { chartArea, ctx: c } = ctx.chart;
          if (!chartArea) return withAlpha(colour, 0.15);
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, withAlpha(colour, 0.28));
          g.addColorStop(1, withAlpha(colour, 0.02));
          return g;
        }
        : colour,
      fill: area && si === 0 ? 'origin' : false,
      borderWidth: 2,
      borderDash: s.dashed ? [6, 4] : [],
      pointRadius: 0,
      pointHitRadius: 8,
      pointHoverRadius: 4.5,
      pointHoverBackgroundColor: colour,
      pointHoverBorderColor: p.surface,
      pointHoverBorderWidth: 2,
      tension: 0,
      spanGaps: true,
    };
  });

  const allY = series.flatMap((s) => s.points.map((pt) => pt.y)).filter(Number.isFinite);
  const suggestedMax = (allY.length ? Math.max(...allY, refLine ?? 0) : (refLine ?? 1)) * 1.12;

  const chart = new ChartJS(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 8, top: 4 } },
      scales: {
        x: {
          grid: { display: false }, border: { display: false },
          ticks: { color: p.muted, autoSkip: true, maxRotation: 0, maxTicksLimit: 8 },
        },
        y: {
          min: yMin, suggestedMax, grid: { color: p.grid }, border: { display: false },
          ticks: { color: p.muted, callback: (v) => yFormat(v) },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: externalTooltip((tt) => {
            const idx = tt.dataPoints[0].dataIndex;
            const f = valueFormat || yFormat;
            const rows = series.map((s, si) => {
              const y = s.points[idx]?.y;
              if (!Number.isFinite(y)) return '';
              const colour = s.color || p.series[si % p.series.length];
              return `<div class="tip-row"><span class="swatch" style="background:${colour}"></span>${s.name}<b>${f(y)}</b></div>`;
            }).join('');
            return `<div class="tip-head">${labels[idx]}</div>${rows}`;
          }),
        },
        afCrosshair: { color: p.axis },
        afRefLines: { lines: refLine != null ? [{ value: refLine, color: p.critical, label: `${refLine.toFixed(2)}x ${refLabel}` }] : [] },
      },
    },
    plugins: [crosshairPlugin, refLinesPlugin],
  });
  chartRegistry.set(container, chart);
}

/** Horizontal bars with a value label at the end of each. */
export function barChart(container, { bars = [], height = null, valueFormat = fmt.compact, maxValue = null } = {}) {
  const p = palette();
  destroyChart(container);
  container.innerHTML = '';
  if (!bars.length) { container.innerHTML = '<p class="chart-empty">Nothing to show.</p>'; return; }

  const rowH = 30, gap = 6;
  container.style.position = 'relative';
  container.style.height = `${height || bars.length * (rowH + gap)}px`;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const chart = new ChartJS(canvas, {
    type: 'bar',
    data: {
      labels: bars.map((b) => b.label),
      datasets: [{
        data: bars.map((b) => b.value),
        backgroundColor: bars.map((b) => b.color || p.series[0]),
        borderRadius: 4,
        borderSkipped: false,
        barThickness: rowH - 10,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      layout: { padding: { right: 96 } },
      scales: {
        x: {
          beginAtZero: true, max: maxValue ?? undefined,
          grid: { display: false }, border: { display: false }, ticks: { display: false },
        },
        y: {
          grid: { display: false }, border: { display: false },
          ticks: {
            color: p.ink2, font: { size: 12 },
            callback: (v, i) => { const l = bars[i].label; return l.length > 34 ? `${l.slice(0, 33)}…` : l; },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: externalTooltip((tt) => bars[tt.dataPoints[0].dataIndex]?.tip || null),
        },
        afBarValues: { color: p.ink, format: valueFormat, values: bars.map((b) => b.value) },
      },
    },
    plugins: [barValueLabelsPlugin],
  });
  chartRegistry.set(container, chart);
}

/**
 * Delivery calendar. Sequential single-hue ramp for spend; days with no delivery
 * get a hatched, outlined cell rather than the lightest ramp step, so "nothing
 * ran" never reads as "a small amount ran". Kept as hand-rolled SVG - there is
 * no native Chart.js chart type this maps to cleanly.
 */
export function calendarHeatmap(container, { days = [], currency = 'EGP' } = {}) {
  const p = palette();
  destroyChart(container);
  container.innerHTML = '';
  if (!days.length) { container.innerHTML = '<p class="chart-empty">No history yet.</p>'; return; }

  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const cell = 15;
  const gapPx = 3;
  const weeks = Math.ceil((last - start) / (7 * 86400000)) + 1;
  const width = weeks * (cell + gapPx) + 46;
  const height = 7 * (cell + gapPx) + 26;
  const max = Math.max(...days.map((d) => d.spend || 0), 1);
  const ramp = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
  const stepFor = (v) => ramp[Math.min(ramp.length - 1, Math.floor((v / max) ** 0.6 * ramp.length))];

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height, class: 'plot calendar',
    preserveAspectRatio: 'xMinYMid meet', style: `width:${width}px;max-width:100%`,
  });
  const defs = el('defs');
  const hatch = el('pattern', { id: 'gapHatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  hatch.appendChild(el('rect', { width: 6, height: 6, fill: 'transparent' }));
  hatch.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: p.critical, 'stroke-width': 2, opacity: 0.6 }));
  defs.appendChild(hatch);
  svg.appendChild(defs);

  [['Mon', 0], ['Wed', 2], ['Fri', 4]].forEach(([label, row]) => {
    const t = el('text', { x: 0, y: row * (cell + gapPx) + cell + 4, class: 'axis-label' });
    t.textContent = label;
    svg.appendChild(t);
  });

  let cursor = new Date(start);
  let week = 0;
  let lastMonth = null;
  while (cursor <= last) {
    const iso = cursor.toISOString().slice(0, 10);
    const row = (cursor.getUTCDay() + 6) % 7;
    const x = 42 + week * (cell + gapPx);
    const y = row * (cell + gapPx) + 6;
    const d = byDate.get(iso);
    const inRange = cursor >= first && cursor <= last;
    const spent = d ? Number(d.spend || 0) : 0;
    const dark = inRange && spent < 1;

    const rect = el('rect', {
      x, y, width: cell, height: cell, rx: 3,
      fill: !inRange ? 'transparent' : dark ? 'url(#gapHatch)' : stepFor(spent),
      stroke: dark ? p.critical : 'transparent', 'stroke-width': dark ? 1 : 0,
      opacity: inRange ? 1 : 0.2,
    });
    if (inRange) {
      rect.addEventListener('mousemove', (ev) => showTip(
        `<div class="tip-head">${iso}</div>` + (dark
          ? '<div class="tip-row"><b>No delivery — dark day</b></div>'
          : `<div class="tip-row">Spend<b>${fmt.money(spent, currency)}</b></div><div class="tip-row">Return<b>${d?.roas ? fmt.x(d.roas) : '—'}</b></div>`),
        ev.clientX, ev.clientY,
      ));
      rect.addEventListener('mouseleave', hideTip);
    }
    svg.appendChild(rect);

    const month = cursor.getUTCMonth();
    if (row === 0 && month !== lastMonth) {
      lastMonth = month;
      const t = el('text', { x, y: height - 4, class: 'axis-label' });
      t.textContent = cursor.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
      svg.appendChild(t);
    }
    cursor = new Date(cursor.getTime() + 86400000);
    if (row === 6) week += 1;
  }
  container.appendChild(svg);
}

/**
 * Spend against return, with break-even and target reference lines. Points are
 * coloured by state (not identity) and every point states its band in words on
 * hover, so colour never carries the meaning alone.
 */
export function scatterPlot(container, { points = [], height = 260, breakEven = 1.8, target = 4, currency = 'EGP' } = {}) {
  const p = palette();
  destroyChart(container);
  container.innerHTML = '';
  if (!points.length) { container.innerHTML = '<p class="chart-empty">No campaigns with spend in this window.</p>'; return; }

  container.style.position = 'relative';
  container.style.height = `${height}px`;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const maxSpend = Math.max(...points.map((d) => d.spend), 1);
  const statusFor = (roas) => (roas < breakEven ? 'critical' : roas < target ? 'warning' : 'good');
  const bandFor = (status) => (status === 'good' ? 'Above target' : status === 'warning' ? 'Below target, above break-even' : 'Below break-even');

  const data = points.map((d) => ({ x: d.spend, y: d.roas, r: 6 + Math.sqrt(d.spend / maxSpend) * 10 }));

  const chart = new ChartJS(canvas, {
    type: 'bubble',
    data: {
      datasets: [{
        data,
        backgroundColor: points.map((d) => withAlpha(p[statusFor(d.roas)], 0.72)),
        borderColor: p.surface,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      layout: { padding: { top: 4, right: 10 } },
      scales: {
        x: {
          suggestedMax: Math.max(...points.map((d) => d.spend)) * 1.1,
          grid: { color: p.grid }, border: { display: false },
          title: { display: true, text: `Spend (${currency}) →`, color: p.muted, font: { size: 11 } },
          ticks: { color: p.muted, callback: (v) => fmt.compact(v) },
        },
        y: {
          suggestedMax: Math.max(...points.map((d) => d.roas), target * 1.2) * 1.1, beginAtZero: true,
          grid: { color: p.grid }, border: { display: false },
          ticks: { color: p.muted, callback: (v) => `${v.toFixed(1)}x` },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: externalTooltip((tt) => {
            const d = points[tt.dataPoints[0].dataIndex];
            const status = statusFor(d.roas);
            return `<div class="tip-head">${d.name}</div>
              <div class="tip-row">Spend<b>${fmt.money(d.spend, currency)}</b></div>
              <div class="tip-row">Return<b>${fmt.x(d.roas)}</b></div>
              <div class="tip-row">Purchases<b>${fmt.num(d.purchases)}</b></div>
              <div class="tip-row">Cost/purchase<b>${d.cpa ? fmt.money(d.cpa, currency) : '—'}</b></div>
              <div class="tip-row tip-band"><b>${bandFor(status)}</b></div>`;
          }),
        },
        afRefLines: {
          lines: [
            { value: breakEven, color: p.critical, label: `${breakEven.toFixed(2)}x break-even` },
            { value: target, color: p.good, label: `${target.toFixed(2)}x target` },
          ],
        },
      },
    },
    plugins: [refLinesPlugin],
  });
  chartRegistry.set(container, chart);
}

/**
 * Decorative filled trend used as a stat-tile backdrop. Stretched to the tile,
 * so it carries shape only - the tile's own number and delta carry the value.
 */
export function sparkArea(values, { color = null, height = 40 } = {}) {
  const p = palette();
  const nums = values.map((v) => (Number.isFinite(v) ? v : 0));
  if (nums.length < 2) return '';
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const w = 100;
  const pt = (v, i) => `${((i / (nums.length - 1)) * w).toFixed(2)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(2)}`;
  const line = nums.map((v, i) => `${i === 0 ? 'M' : 'L'}${pt(v, i)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${line} L${w},${height} L0,${height} Z" fill="${color || p.series[0]}"/>
  </svg>`;
}

/** Tiny inline trend line for table rows. */
export function sparkline(values, { width = 76, height = 22, color = null } = {}) {
  const p = palette();
  const nums = values.filter(Number.isFinite);
  if (nums.length < 2) return '';
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const d = nums.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (nums.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="spark" aria-hidden="true"><path d="${d}" fill="none" stroke="${color || p.series[0]}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

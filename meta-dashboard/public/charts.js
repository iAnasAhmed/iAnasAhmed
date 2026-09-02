/**
 * SVG chart primitives. No library, no CDN - the dashboard has to work on a
 * laptop with no internet and never break because a CDN moved.
 *
 * Rules followed throughout:
 *  - never two y-scales on one plot; two measures become two stacked plots
 *    sharing an x-axis
 *  - categorical colours come from fixed slots, assigned by entity, never cycled
 *  - status colours (good/warning/serious/critical) are reserved for state and
 *    always ship with a label, never colour alone
 *  - grid and axes recede; 2px strokes; >=8px hover targets
 */

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
});

// --- shared tooltip ---------------------------------------------------------
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

// --- helpers ----------------------------------------------------------------
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

/** "Nice" axis maximum so ticks land on readable numbers. */
function niceMax(max) {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  const n = max / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * base;
}

/**
 * One plot with a shared x-axis. Multiple series are allowed only when they
 * share a scale (e.g. a raw line and its own rolling mean).
 */
export function linePlot(container, {
  series = [], height = 190, yFormat = fmt.compact, valueFormat = null,
  area = false, refLine = null, refLabel = 'break-even', yMax = null, yMin = 0,
  showXLabels = true, labelEvery = null,
} = {}) {
  const p = palette();
  container.innerHTML = '';
  const width = container.clientWidth || 720;
  const pad = { top: 12, right: 14, bottom: showXLabels ? 24 : 10, left: 50 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);

  const points = series[0]?.points || [];
  if (!points.length) {
    container.innerHTML = '<p class="chart-empty">No data in this window.</p>';
    return;
  }
  const allY = series.flatMap((s) => s.points.map((pt) => pt.y)).filter(Number.isFinite);
  const rawMax = Math.max(...allY, refLine ?? 0);
  const max = yMax ?? niceMax(rawMax * 1.08);
  const min = yMin;
  const xAt = (i) => pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (v) => pad.top + plotH - ((Math.max(min, Math.min(v, max)) - min) / (max - min || 1)) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', class: 'plot' });

  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const v = min + ((max - min) / ticks) * i;
    const y = yAt(v);
    svg.appendChild(el('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, stroke: p.grid, 'stroke-width': 1 }));
    const label = el('text', { x: pad.left - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    label.textContent = yFormat(v);
    svg.appendChild(label);
  }

  if (refLine != null && refLine <= max) {
    const y = yAt(refLine);
    svg.appendChild(el('line', {
      x1: pad.left, x2: width - pad.right, y1: y, y2: y,
      stroke: p.critical, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: 0.75,
    }));
    const t = el('text', { x: width - pad.right, y: y - 6, 'text-anchor': 'end', class: 'ref-label' });
    t.textContent = `${refLine.toFixed(2)}x ${refLabel}`;
    svg.appendChild(t);
  }

  series.forEach((s, si) => {
    const colour = s.color || p.series[si % p.series.length];
    const valid = s.points.map((pt, i) => ({ i, ...pt })).filter((pt) => Number.isFinite(pt.y));
    if (!valid.length) return;
    const d = valid.map((pt, k) => `${k === 0 ? 'M' : 'L'}${xAt(pt.i).toFixed(1)},${yAt(pt.y).toFixed(1)}`).join(' ');
    if (area && si === 0) {
      const fillId = `grad-${Math.random().toString(36).slice(2, 8)}`;
      const defs = el('defs');
      const grad = el('linearGradient', { id: fillId, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(el('stop', { offset: '0%', 'stop-color': colour, 'stop-opacity': 0.28 }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': colour, 'stop-opacity': 0.02 }));
      defs.appendChild(grad);
      svg.appendChild(defs);
      svg.appendChild(el('path', {
        d: `${d} L${xAt(valid[valid.length - 1].i).toFixed(1)},${pad.top + plotH} L${xAt(valid[0].i).toFixed(1)},${pad.top + plotH} Z`,
        fill: `url(#${fillId})`, stroke: 'none',
      }));
    }
    svg.appendChild(el('path', {
      d, fill: 'none', stroke: colour, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'stroke-dasharray': s.dashed ? '6 4' : null,
    }));
  });

  const crosshair = el('line', { y1: pad.top, y2: pad.top + plotH, stroke: p.axis, 'stroke-width': 1, opacity: 0 });
  svg.appendChild(crosshair);
  const dots = series.map((s, si) => {
    const dot = el('circle', { r: 4.5, fill: s.color || p.series[si % p.series.length], stroke: p.surface, 'stroke-width': 2, opacity: 0 });
    svg.appendChild(dot);
    return dot;
  });

  const overlay = el('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: 'transparent', style: 'cursor:crosshair' });
  svg.appendChild(overlay);
  overlay.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const rel = ((ev.clientX - rect.left) / rect.width) * width;
    const idx = Math.round(((rel - pad.left) / plotW) * (points.length - 1));
    const i = Math.max(0, Math.min(points.length - 1, idx));
    const x = xAt(i);
    crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x); crosshair.setAttribute('opacity', 0.5);
    const rows = series.map((s, si) => {
      const pt = s.points[i];
      if (!pt || !Number.isFinite(pt.y)) { dots[si].setAttribute('opacity', 0); return null; }
      dots[si].setAttribute('cx', x); dots[si].setAttribute('cy', yAt(pt.y)); dots[si].setAttribute('opacity', 1);
      const f = valueFormat || yFormat;
      return `<div class="tip-row"><span class="swatch" style="background:${s.color || p.series[si % p.series.length]}"></span>${s.name}<b>${f(pt.y)}</b></div>`;
    }).filter(Boolean).join('');
    showTip(`<div class="tip-head">${points[i].label ?? points[i].x}</div>${rows}`, ev.clientX, ev.clientY);
  });
  overlay.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    hideTip();
  });

  if (showXLabels) {
    const every = labelEvery || Math.max(1, Math.ceil(points.length / 7));
    points.forEach((pt, i) => {
      if (i % every !== 0 && i !== points.length - 1) return;
      const t = el('text', { x: xAt(i), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' });
      t.textContent = pt.label ?? pt.x;
      svg.appendChild(t);
    });
  }

  container.appendChild(svg);
}

/** Horizontal bars with rounded data-ends and a surface gap between them. */
export function barChart(container, { bars = [], height = null, valueFormat = fmt.compact, maxValue = null } = {}) {
  const p = palette();
  container.innerHTML = '';
  if (!bars.length) { container.innerHTML = '<p class="chart-empty">Nothing to show.</p>'; return; }
  const width = container.clientWidth || 640;
  const rowH = 30;
  const gap = 6;
  const labelW = Math.min(200, Math.max(110, width * 0.3));
  const valueW = 96;
  const h = height || bars.length * (rowH + gap);
  const plotW = Math.max(20, width - labelW - valueW - 8);
  const max = maxValue ?? niceMax(Math.max(...bars.map((b) => Math.abs(b.value)), 1));

  const svg = el('svg', { viewBox: `0 0 ${width} ${h}`, width: '100%', height: h, class: 'plot' });
  bars.forEach((b, i) => {
    const y = i * (rowH + gap);
    const w = Math.max(2, (Math.abs(b.value) / max) * plotW);
    const colour = b.color || p.series[0];
    const g = el('g');
    g.appendChild(el('rect', { x: labelW, y: y + 5, width: plotW, height: rowH - 10, rx: 4, fill: p.grid, opacity: 0.55 }));
    g.appendChild(el('rect', { x: labelW, y: y + 5, width: w, height: rowH - 10, rx: 4, fill: colour }));
    const name = el('text', { x: labelW - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'bar-label' });
    name.textContent = b.label.length > 28 ? `${b.label.slice(0, 27)}…` : b.label;
    g.appendChild(name);
    const val = el('text', { x: width - 4, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'bar-value' });
    val.textContent = valueFormat(b.value);
    g.appendChild(val);
    if (b.tip) {
      g.addEventListener('mousemove', (ev) => showTip(b.tip, ev.clientX, ev.clientY));
      g.addEventListener('mouseleave', hideTip);
    }
    svg.appendChild(g);
  });
  container.appendChild(svg);
}

/**
 * Delivery calendar. Sequential single-hue ramp for spend; days with no delivery
 * get a hatched, outlined cell rather than the lightest ramp step, so "nothing
 * ran" never reads as "a small amount ran".
 */
export function calendarHeatmap(container, { days = [], currency = 'EGP' } = {}) {
  const p = palette();
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
    preserveAspectRatio: 'xMinYMid meet', style: `max-width:${width}px`,
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
  container.innerHTML = '';
  if (!points.length) { container.innerHTML = '<p class="chart-empty">No campaigns with spend in this window.</p>'; return; }
  const width = container.clientWidth || 720;
  const pad = { top: 14, right: 18, bottom: 38, left: 52 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = Math.max(10, height - pad.top - pad.bottom);

  const maxX = niceMax(Math.max(...points.map((d) => d.spend)) * 1.1);
  const maxY = niceMax(Math.max(...points.map((d) => d.roas), target * 1.2) * 1.1);
  const xAt = (v) => pad.left + (v / maxX) * plotW;
  const yAt = (v) => pad.top + plotH - (Math.min(v, maxY) / maxY) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, class: 'plot' });
  for (let i = 0; i <= 4; i += 1) {
    const v = (maxY / 4) * i;
    const y = yAt(v);
    svg.appendChild(el('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, stroke: p.grid, 'stroke-width': 1 }));
    const t = el('text', { x: pad.left - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    t.textContent = `${v.toFixed(1)}x`;
    svg.appendChild(t);
  }
  for (const [value, colour, label] of [[breakEven, p.critical, 'break-even'], [target, p.good, 'target']]) {
    if (value > maxY) continue;
    const y = yAt(value);
    svg.appendChild(el('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, stroke: colour, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', opacity: 0.85 }));
    const t = el('text', { x: width - pad.right, y: y - 6, 'text-anchor': 'end', class: 'ref-label' });
    t.textContent = `${value.toFixed(2)}x ${label}`;
    svg.appendChild(t);
  }
  for (let i = 0; i <= 3; i += 1) {
    const v = (maxX / 3) * i;
    const t = el('text', { x: xAt(v), y: height - 12, 'text-anchor': 'middle', class: 'axis-label' });
    t.textContent = fmt.compact(v);
    svg.appendChild(t);
  }
  const xTitle = el('text', { x: pad.left + plotW / 2, y: height - 1, 'text-anchor': 'middle', class: 'axis-title' });
  xTitle.textContent = `Spend (${currency}) →`;
  svg.appendChild(xTitle);

  const maxSpend = Math.max(...points.map((d) => d.spend), 1);
  for (const d of points) {
    const status = d.roas < breakEven ? 'critical' : d.roas < target ? 'warning' : 'good';
    const band = status === 'good' ? 'Above target' : status === 'warning' ? 'Below target, above break-even' : 'Below break-even';
    const r = 6 + Math.sqrt(d.spend / maxSpend) * 10;
    const c = el('circle', {
      cx: xAt(d.spend), cy: yAt(d.roas), r,
      fill: p[status], 'fill-opacity': 0.72, stroke: p.surface, 'stroke-width': 2, style: 'cursor:pointer',
    });
    c.addEventListener('mousemove', (ev) => showTip(
      `<div class="tip-head">${d.name}</div>
       <div class="tip-row">Spend<b>${fmt.money(d.spend, currency)}</b></div>
       <div class="tip-row">Return<b>${fmt.x(d.roas)}</b></div>
       <div class="tip-row">Purchases<b>${fmt.num(d.purchases)}</b></div>
       <div class="tip-row">Cost/purchase<b>${d.cpa ? fmt.money(d.cpa, currency) : '—'}</b></div>
       <div class="tip-row tip-band"><b>${band}</b></div>`,
      ev.clientX, ev.clientY,
    ));
    c.addEventListener('mouseleave', hideTip);
    svg.appendChild(c);
  }
  container.appendChild(svg);
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

/**
 * Hand-rolled SVG charts.
 *
 * Colours come from CSS custom properties defined in styles.css, which carry
 * the validated categorical palette and swap for dark mode in one place. No
 * chart library, and no colour literals in here.
 */

import { s } from './dom.ts';
import { type Money, format, formatPct, toEgp } from '../core/money.ts';

// ------------------------------------------------------------------ donut

export interface DonutSlice {
  readonly label: string;
  readonly value: Money;
  /** 1-based categorical slot. Capped at 3 — see docs and the palette rules. */
  readonly slot: number;
}

/**
 * Allocation donut.
 *
 * A 2px surface-coloured gap separates adjacent segments, so boundaries read
 * without relying on hue contrast. Every slice is direct-labelled in the
 * legend with its value and share — the light-mode contrast relief the
 * palette validator requires.
 */
export function donutChart(slices: readonly DonutSlice[], size = 200): SVGElement {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = size / 2;
  const thickness = size * 0.19;
  const innerRadius = radius - thickness;
  const centre = radius;

  const svg = s('svg', {
    viewBox: `0 0 ${size} ${size}`,
    class: 'donut',
    role: 'img',
    'aria-label': 'Portfolio allocation by asset class',
  });

  if (total <= 0) {
    svg.appendChild(
      s('circle', {
        cx: centre, cy: centre, r: (radius + innerRadius) / 2,
        fill: 'none', stroke: 'var(--grid)', 'stroke-width': thickness,
      }),
    );
    return svg;
  }

  // A 2px gap in angular terms, so segments never touch.
  const gapAngle = slices.length > 1 ? 2 / radius : 0;
  let angle = -Math.PI / 2; // start at 12 o'clock

  for (const slice of slices) {
    if (slice.value <= 0) continue;
    const sweep = (slice.value / total) * Math.PI * 2;
    const start = angle + gapAngle / 2;
    const end = angle + sweep - gapAngle / 2;
    angle += sweep;
    if (end <= start) continue;

    svg.appendChild(
      s('path', {
        d: arcPath(centre, centre, radius, innerRadius, start, end),
        fill: `var(--series-${slice.slot})`,
        class: 'donut-slice',
      }, s('title', {}, `${slice.label}: ${format(slice.value)}`)),
    );
  }

  return svg;
}

function arcPath(
  cx: number, cy: number, outer: number, inner: number, start: number, end: number,
): string {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const x1 = cx + outer * Math.cos(start), y1 = cy + outer * Math.sin(start);
  const x2 = cx + outer * Math.cos(end), y2 = cy + outer * Math.sin(end);
  const x3 = cx + inner * Math.cos(end), y3 = cy + inner * Math.sin(end);
  const x4 = cx + inner * Math.cos(start), y4 = cy + inner * Math.sin(start);

  return [
    `M ${x1} ${y1}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

// ------------------------------------------------------------------- lines

export interface SeriesPoint {
  readonly date: string;
  readonly value: Money;
}

export interface Series {
  readonly label: string;
  readonly points: readonly SeriesPoint[];
  readonly slot: number;
  /** Dashed rendering, used for the benchmark so the portfolio reads as primary. */
  readonly dashed?: boolean;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

/**
 * Portfolio value against the benchmark, over time.
 *
 * One y-axis only — both series are EGP, so they belong on the same scale, and
 * that shared scale is the entire point: the gap between the lines *is* the
 * answer to "am I beating the money-market fund?".
 *
 * A crosshair and tooltip track the pointer across the plot.
 */
export function lineChart(
  series: readonly Series[],
  options: { readonly tooltip?: HTMLElement } = {},
): SVGElement {
  const svg = s('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    class: 'linechart',
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': 'Portfolio value against the money-market benchmark',
  });

  const all = series.flatMap((sr) => sr.points);
  if (all.length < 2) {
    svg.appendChild(
      s('text', {
        x: CHART_WIDTH / 2, y: CHART_HEIGHT / 2,
        'text-anchor': 'middle', class: 'chart-empty',
      }, 'Not enough history yet — add transactions to see the curve'),
    );
    return svg;
  }

  const values = all.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Pad the band so the lines never graze the frame, and never divide by zero.
  const span = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const dates = [...new Set(all.map((p) => p.date))].sort();
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  const xOf = (date: string): number => {
    const index = dates.indexOf(date);
    const fraction = dates.length > 1 ? index / (dates.length - 1) : 0.5;
    return PADDING.left + fraction * plotWidth;
  };
  const yOf = (value: number): number =>
    PADDING.top + (1 - (value - min) / (max - min)) * plotHeight;

  // --- recessive grid + axis labels
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    const y = yOf(value);
    svg.appendChild(
      s('line', {
        x1: PADDING.left, y1: y, x2: CHART_WIDTH - PADDING.right, y2: y,
        stroke: 'var(--grid)', 'stroke-width': 1,
      }),
    );
    svg.appendChild(
      s('text', {
        x: PADDING.left - 8, y: y + 4,
        'text-anchor': 'end', class: 'axis-label',
      }, format(value as Money, { currency: false, compact: true, decimals: 0 })),
    );
  }

  // --- date ticks: first, middle, last only — enough to orient, no clutter
  for (const index of [0, Math.floor((dates.length - 1) / 2), dates.length - 1]) {
    const date = dates[index];
    if (!date) continue;
    svg.appendChild(
      s('text', {
        x: xOf(date), y: CHART_HEIGHT - 8,
        'text-anchor': index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle',
        class: 'axis-label',
      }, date.slice(2)),
    );
  }

  // --- series
  for (const sr of series) {
    if (sr.points.length < 2) continue;
    const d = sr.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.date)} ${yOf(p.value)}`)
      .join(' ');

    svg.appendChild(
      s('path', {
        d,
        fill: 'none',
        stroke: `var(--series-${sr.slot})`,
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-dasharray': sr.dashed ? '5 4' : undefined,
      }),
    );
  }

  // --- hover layer
  const crosshair = s('line', {
    y1: PADDING.top, y2: CHART_HEIGHT - PADDING.bottom,
    stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
    opacity: 0, class: 'crosshair',
  });
  svg.appendChild(crosshair);

  const markers = series.map((sr) =>
    s('circle', {
      r: 4.5, fill: `var(--series-${sr.slot})`,
      stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0,
    }),
  );
  for (const marker of markers) svg.appendChild(marker);

  const overlay = s('rect', {
    x: PADDING.left, y: PADDING.top, width: plotWidth, height: plotHeight,
    fill: 'transparent', class: 'hover-overlay',
  });

  const hide = (): void => {
    crosshair.setAttribute('opacity', '0');
    for (const marker of markers) marker.setAttribute('opacity', '0');
    if (options.tooltip) options.tooltip.hidden = true;
  };

  overlay.addEventListener('pointermove', (event) => {
    const point = event as PointerEvent;
    const box = svg.getBoundingClientRect();
    // Map client pixels back into viewBox units.
    const vx = ((point.clientX - box.left) / box.width) * CHART_WIDTH;
    const fraction = (vx - PADDING.left) / plotWidth;
    const index = Math.round(fraction * (dates.length - 1));
    const date = dates[Math.max(0, Math.min(dates.length - 1, index))];
    if (!date) return;

    crosshair.setAttribute('x1', String(xOf(date)));
    crosshair.setAttribute('x2', String(xOf(date)));
    crosshair.setAttribute('opacity', '1');

    const rows: string[] = [];
    series.forEach((sr, i) => {
      const found = sr.points.find((p) => p.date === date);
      const marker = markers[i];
      if (!found || !marker) {
        marker?.setAttribute('opacity', '0');
        return;
      }
      marker.setAttribute('cx', String(xOf(date)));
      marker.setAttribute('cy', String(yOf(found.value)));
      marker.setAttribute('opacity', '1');
      rows.push(
        `<div class="tt-row"><span class="tt-swatch" style="background:var(--series-${sr.slot})"></span>` +
        `<span class="tt-label">${sr.label}</span><span class="tt-value">${format(found.value)}</span></div>`,
      );
    });

    if (options.tooltip) {
      options.tooltip.hidden = false;
      options.tooltip.innerHTML = `<div class="tt-date">${date}</div>${rows.join('')}`;
      const left = ((xOf(date) / CHART_WIDTH) * box.width);
      options.tooltip.style.left = `${Math.min(Math.max(left, 8), box.width - 8)}px`;
    }
  });

  overlay.addEventListener('pointerleave', hide);
  svg.appendChild(overlay);
  return svg;
}

// --------------------------------------------------------------- benchmark bar

/**
 * A two-ended bar comparing actual return against the benchmark.
 *
 * Deliberately shows the shortfall as prominently as the gain: the point of
 * the dashboard is to make underperformance impossible to miss.
 */
export function benchmarkBar(actual: number, benchmark: number): SVGElement {
  const width = 320, height = 64, pad = 4;
  // Reserve room for the label that sits after each bar, so it never clips.
  const labelRoom = 118;
  const scale = Math.max(Math.abs(actual), Math.abs(benchmark), benchmark * 1.2, 0.01) * 1.15;
  const toWidth = (value: number): number =>
    Math.max(2, (Math.abs(value) / scale) * (width - pad * 2 - labelRoom));

  const svg = s('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'benchbar',
    role: 'img',
    'aria-label': `Your annualised return ${formatPct(actual)} against benchmark ${formatPct(benchmark)}`,
  });

  const rows: readonly [number, string, string][] = [
    [actual, actual >= benchmark ? 'var(--good)' : 'var(--critical)', 'You'],
    [benchmark, 'var(--muted)', 'Money market'],
  ];

  rows.forEach(([value, colour, label], i) => {
    const y = pad + i * 28;
    svg.appendChild(
      s('rect', {
        x: pad, y, width: toWidth(value), height: 14, rx: 4, fill: colour,
      }),
    );
    svg.appendChild(
      s('text', {
        x: pad + toWidth(value) + 8, y: y + 11, class: 'bar-label',
      }, `${label} ${formatPct(value)}`),
    );
  });

  return svg;
}

export { toEgp };

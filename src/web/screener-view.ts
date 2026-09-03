/**
 * Research view — the screener UI.
 *
 * A lens, not a tipster. The owner sets filters and factor weights; the table
 * ranks the EGX universe against *those* choices and shows every sub-score, so
 * a high rank is always explainable. It also ties two of the project's core
 * ideas into the act of choosing a stock:
 *   - liquidity first (thin names cost more than every fee combined)
 *   - the ~22% hurdle (a dividend yield is shown against it, and it rarely wins)
 */

import { h, s } from './dom.ts';
import { format, formatPct, formatShare, formatPrice, type Money } from '../core/money.ts';
import {
  type ScreenResult, type ScreenWeights, type ScreenFilters, type LiquidityTier,
} from '../core/screener.ts';

export interface ScreenerHandlers {
  readonly onFilters: (patch: Partial<RawFilters>) => void;
  readonly onWeight: (factor: keyof ScreenWeights, value: number) => void;
  readonly onToggleWatch: (symbol: string) => void;
  readonly onSourceChange: (id: string) => void;
}

/** Filter values as the UI holds them (strings/numbers), pre-normalisation. */
export interface RawFilters {
  readonly search: string;
  readonly sector: string;         // '' = all
  readonly minLiquidityM: number;  // in EGP millions
  readonly maxPe: number;          // 0 = no cap
  readonly minDivYield: number;    // percent
}

export interface ScreenerViewModel {
  readonly results: readonly ScreenResult[];
  readonly sectors: readonly string[];
  readonly weights: ScreenWeights;
  readonly filters: RawFilters;
  readonly watchlist: readonly string[];
  readonly benchmarkRate: number;
  readonly isDemo: boolean;
  readonly sourceLabel: string;
  readonly sourceId: string;
  readonly totalUniverse: number;
  readonly handlers: ScreenerHandlers;
}

const TIER_LABEL: Record<LiquidityTier, string> = {
  liquid: 'Liquid',
  moderate: 'Moderate',
  thin: 'Thin',
};

const FACTOR_LABELS: readonly [keyof ScreenWeights, string, string][] = [
  ['liquidity', 'Liquidity', 'How easily you can get out. Weighted highest for a reason.'],
  ['value', 'Value', 'Cheaper multiples (P/E, P/B) rank higher.'],
  ['size', 'Size', 'Larger, steadier companies rank higher.'],
  ['income', 'Income', 'Higher dividend yield ranks higher.'],
  ['momentum', 'Momentum', '52-week price trend. Past moves, not future ones.'],
];

export function screenerView(vm: ScreenerViewModel): HTMLElement {
  return h('main', { class: 'layout' },
    intro(vm),
    controls(vm),
    resultsCard(vm),
    watchlistCard(vm),
    methodologyNote(),
  );
}

// --------------------------------------------------------------------- intro

function intro(vm: ScreenerViewModel): HTMLElement {
  return h('section', { class: 'hero research-hero' },
    h('div', { class: 'hero-label' }, 'Research · EGX screener'),
    h('div', { class: 'research-headline' },
      `Ranking ${vm.results.length} of ${vm.totalUniverse} names against your criteria`),
    h('p', { class: 'research-sub' },
      'This is a filter you control, not a tip sheet. Adjust the weights and the ' +
      'order changes. Every score breaks down into the factors below, so you can ' +
      'always see why something ranks where it does.'),
    vm.isDemo
      ? h('div', { class: 'alert' },
          h('span', { 'aria-hidden': 'true' }, '⚠'),
          h('span', {},
            h('strong', {}, 'Approximate demo data. '),
            'These are approximate real-world figures compiled around Sep 2026 — ' +
            'point-in-time, not a live feed, and not verified to the piastre. ' +
            'Switch the source to live data (with the local server running) before ' +
            'trusting anything here.'))
      : null,
  );
}

// ------------------------------------------------------------------ controls

function controls(vm: ScreenerViewModel): HTMLElement {
  const { handlers, filters } = vm;

  const sectorSelect = h('select', {
    id: 'scr-sector',
    onChange: (e: Event) => handlers.onFilters({ sector: (e.target as HTMLSelectElement).value }),
  },
    h('option', { value: '', selected: filters.sector === '' }, 'All sectors'),
    ...vm.sectors.map((sector) =>
      h('option', { value: sector, selected: filters.sector === sector }, sector)),
  );

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Filters'),
    h('div', { class: 'screener-filters' },
      field('Search', h('input', {
        id: 'scr-search', type: 'search', placeholder: 'symbol or name', value: filters.search,
        onInput: (e: Event) => handlers.onFilters({ search: (e.target as HTMLInputElement).value }),
      })),
      field('Sector', sectorSelect),
      field('Min. liquidity (EGP M/day)', h('input', {
        id: 'scr-liq', type: 'number', min: '0', step: '0.5', value: String(filters.minLiquidityM),
        onChange: (e: Event) => handlers.onFilters({ minLiquidityM: Number((e.target as HTMLInputElement).value) }),
      })),
      field('Max P/E (0 = any)', h('input', {
        id: 'scr-pe', type: 'number', min: '0', step: '1', value: String(filters.maxPe),
        onChange: (e: Event) => handlers.onFilters({ maxPe: Number((e.target as HTMLInputElement).value) }),
      })),
      field('Min. dividend yield (%)', h('input', {
        id: 'scr-dy', type: 'number', min: '0', step: '0.5', value: String(filters.minDivYield),
        onChange: (e: Event) => handlers.onFilters({ minDivYield: Number((e.target as HTMLInputElement).value) }),
      })),
      field('Data source', h('select', {
        id: 'scr-src',
        onChange: (e: Event) => handlers.onSourceChange((e.target as HTMLSelectElement).value),
      },
        h('option', { value: 'mock', selected: vm.sourceId === 'mock' }, 'Demo (illustrative)'),
        h('option', { value: 'yahoo', selected: vm.sourceId === 'yahoo' }, 'Yahoo Finance (live)'),
      )),
    ),
    h('h3', { class: 'weights-title' }, 'Weights — what matters to you'),
    h('div', { class: 'weights' },
      ...FACTOR_LABELS.map(([key, label, hint]) => weightControl(vm, key, label, hint)),
    ),
  );
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), control);
}

function weightControl(
  vm: ScreenerViewModel, key: keyof ScreenWeights, label: string, hint: string,
): HTMLElement {
  const value = vm.weights[key];
  return h('div', { class: 'weight' },
    h('div', { class: 'weight-head' },
      h('span', { class: 'weight-label' }, label),
      h('span', { class: 'weight-value' }, String(value)),
    ),
    h('input', {
      type: 'range', min: '0', max: '5', step: '1', value: String(value),
      'aria-label': `${label} weight`,
      onInput: (e: Event) => vm.handlers.onWeight(key, Number((e.target as HTMLInputElement).value)),
    }),
    h('small', { class: 'weight-hint' }, hint),
  );
}

// ------------------------------------------------------------------ results

function resultsCard(vm: ScreenerViewModel): HTMLElement {
  if (vm.results.length === 0) {
    return h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Results'),
      h('p', { class: 'muted' }, 'Nothing matches these filters. Loosen them to see more.'),
    );
  }

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Ranked results'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'screener' },
        h('thead', {},
          h('tr', {},
            h('th', {}, 'Match'),
            h('th', {}, 'Symbol'),
            h('th', {}, 'Liquidity'),
            h('th', { class: 'num' }, 'P/E'),
            h('th', { class: 'num' }, 'P/B'),
            h('th', { class: 'num' }, 'Div yield'),
            h('th', { class: 'num' }, 'vs 22% cash'),
            h('th', { class: 'num' }, '1-yr'),
            h('th', {}, 'Watch'),
          ),
        ),
        h('tbody', {}, ...vm.results.map((r) => resultRow(vm, r))),
      ),
    ),
  );
}

function resultRow(vm: ScreenerViewModel, r: ScreenResult): HTMLElement {
  const watched = vm.watchlist.includes(r.metrics.symbol);
  const heavy = r.sectorWeight >= 0.35;

  return h('tr', {},
    h('td', {}, scoreCell(r.score)),
    h('td', {},
      h('div', { class: 'sym' }, r.metrics.symbol),
      h('div', { class: 'sym-name' }, r.metrics.name),
      h('div', { class: heavy ? 'sym-sector heavy' : 'sym-sector' },
        heavy
          ? `${r.metrics.sector} · you're ${formatShare(r.sectorWeight)} here`
          : r.metrics.sector),
    ),
    h('td', {}, h('span', { class: `tier ${r.liquidityTier}` }, TIER_LABEL[r.liquidityTier]),
      h('div', { class: 'tier-value' }, adtv(r.metrics.avgDailyValue))),
    h('td', { class: 'num' }, r.metrics.peRatio?.toFixed(1) ?? '—'),
    h('td', { class: 'num' }, r.metrics.pbRatio?.toFixed(2) ?? '—'),
    h('td', { class: 'num' }, r.metrics.dividendYield !== undefined ? formatShare(r.metrics.dividendYield, 1) : '—'),
    h('td', { class: `num ${r.incomeVsHurdle >= 0 ? 'pos' : 'neg'}` }, formatPct(r.incomeVsHurdle, 1)),
    h('td', { class: `num ${(r.metrics.yearChange ?? 0) >= 0 ? 'pos' : 'neg'}` },
      r.metrics.yearChange !== undefined ? formatPct(r.metrics.yearChange, 0) : '—'),
    h('td', {},
      h('button', {
        class: watched ? 'star on' : 'star',
        title: watched ? 'Remove from watchlist' : 'Add to watchlist',
        'aria-label': `${watched ? 'Unwatch' : 'Watch'} ${r.metrics.symbol}`,
        'aria-pressed': watched ? 'true' : 'false',
        onClick: () => vm.handlers.onToggleWatch(r.metrics.symbol),
      }, watched ? '★' : '☆'),
    ),
  );
}

/** A 0–100 match cell: the number plus a bar that encodes it again as length. */
function scoreCell(score: number): HTMLElement {
  const pct = Math.round(score);
  return h('div', { class: 'score' },
    h('div', { class: 'score-num' }, String(pct)),
    h('div', { class: 'score-track' },
      h('div', { class: 'score-fill', style: `width:${pct}%` }),
    ),
  );
}

function adtv(value: Money | undefined): string {
  if (value === undefined) return 'unknown';
  return `${format(value, { currency: false, compact: true, decimals: 1 })}/day`;
}

// ---------------------------------------------------------------- watchlist

function watchlistCard(vm: ScreenerViewModel): HTMLElement {
  if (vm.watchlist.length === 0) {
    return h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Watchlist'),
      h('p', { class: 'muted' },
        'Star names above to shortlist them here — a holding area for candidates ' +
        'before any money is committed.'),
    );
  }

  const bySymbol = new Map(vm.results.map((r) => [r.metrics.symbol, r]));

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, `Watchlist (${vm.watchlist.length})`),
    h('ul', { class: 'watchlist' },
      ...vm.watchlist.map((symbol) => {
        const r = bySymbol.get(symbol);
        return h('li', { class: 'watch-item' },
          h('div', { class: 'watch-main' },
            h('span', { class: 'sym' }, symbol),
            h('span', { class: 'sym-name' }, r?.metrics.name ?? 'not in current results'),
          ),
          r ? h('span', { class: 'watch-score' }, `match ${Math.round(r.score)}`) : null,
          r ? h('span', { class: `tier ${r.liquidityTier}` }, TIER_LABEL[r.liquidityTier]) : null,
          h('button', {
            class: 'btn icon', title: 'Remove', 'aria-label': `Remove ${symbol}`,
            onClick: () => vm.handlers.onToggleWatch(symbol),
          }, '×'),
        );
      }),
    ),
    h('p', { class: 'fineprint' },
      'A watchlist is not a buy list. When you do buy, log it in Portfolio → ' +
      'Log a transaction, and the holding starts being tracked against the benchmark.'),
  );
}

// -------------------------------------------------------------- methodology

function methodologyNote(): HTMLElement {
  return h('section', { class: 'card method' },
    h('h2', { class: 'card-title' }, 'How the match score works'),
    h('ul', { class: 'method-list' },
      h('li', {}, 'Each factor is scored by rank against the other names that passed your filters — a percentile, not an absolute grade.'),
      h('li', {}, 'The match score is your weights applied to those percentiles. Change a weight and every rank recomputes.'),
      h('li', {}, 'A missing figure scores neutrally, so one blank cell never unfairly sinks a stock.'),
      h('li', {}, h('strong', {}, 'It measures fit to your filters, not future returns. '),
        'No screen predicts price. This one enforces discipline — liquidity, valuation, and the cash hurdle — so a decision is at least a considered one.'),
    ),
  );
}

export { s };

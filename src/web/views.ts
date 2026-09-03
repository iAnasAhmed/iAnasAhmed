/**
 * View layer. Renders what core computes — and computes nothing itself
 * (CLAUDE.md §3). Every number on screen comes from src/core.
 */

import { h, s, type Attrs } from './dom.ts';
import { donutChart, lineChart, benchmarkBar, type DonutSlice, type Series } from './charts.ts';
import { type Money, format, formatPct, formatShare, formatPrice, toEgp } from '../core/money.ts';
import type { Holding, PortfolioSummary, Transaction } from '../core/types.ts';
import type { BenchmarkResult } from '../core/performance.ts';
import type { ConcentrationWarning } from '../core/portfolio.ts';
import { describeMarketStatus, type MarketStatus } from '../core/market-hours.ts';
import type { Snapshot } from '../core/history.ts';
import { EGX_INSTRUMENTS } from '../data/symbols.ts';

/** Sign-aware CSS class for a P&L figure. */
function toneOf(value: number): string {
  if (value > 0) return 'pos';
  if (value < 0) return 'neg';
  return 'flat';
}

function card(title: string, ...body: (Node | string | false | null)[]): HTMLElement {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, title),
    ...body,
  );
}

// ------------------------------------------------------------------- header

export type AppView = 'portfolio' | 'research';

export function header(params: {
  readonly status: MarketStatus;
  readonly providerLabel: string;
  readonly isDemo: boolean;
  readonly view: AppView;
  readonly onNav: (view: AppView) => void;
  readonly onRefresh: () => void;
  readonly onToggleTheme: () => void;
}): HTMLElement {
  const navButton = (view: AppView, label: string): HTMLElement =>
    h('button', {
      class: params.view === view ? 'nav-btn active' : 'nav-btn',
      'aria-current': params.view === view ? 'page' : 'false',
      onClick: () => params.onNav(view),
    }, label);

  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' },
      h('span', { class: 'brand-mark' }, 'T'),
      h('div', {},
        h('div', { class: 'brand-name' }, 'Telda Investing Tracker'),
        h('div', { class: `market-pill ${params.status}` }, describeMarketStatus(params.status)),
      ),
    ),
    h('nav', { class: 'topnav', 'aria-label': 'Views' },
      navButton('portfolio', 'Portfolio'),
      navButton('research', 'Research'),
    ),
    h('div', { class: 'topbar-actions' },
      params.isDemo
        ? h('span', { class: 'badge warn', title: 'Prices are simulated, not real market data' }, '⚠ Demo prices')
        : h('span', { class: 'badge' }, params.providerLabel),
      h('button', { class: 'btn ghost', onClick: params.onRefresh, title: 'Refresh quotes' }, '↻'),
      h('button', { class: 'btn ghost', onClick: params.onToggleTheme, title: 'Toggle theme' }, '◐'),
    ),
  );
}

// --------------------------------------------------------------------- hero

export function hero(summary: PortfolioSummary, dayChange: Money | undefined): HTMLElement {
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-label' }, 'Total portfolio value'),
    h('div', { class: 'hero-value' }, format(summary.totalValue)),
    h('div', { class: 'hero-sub' },
      h('span', { class: `delta ${toneOf(summary.totalPnl)}` },
        `${format(summary.totalPnl, { signed: true })} all time`),
      dayChange !== undefined
        ? h('span', { class: `delta ${toneOf(dayChange)}` },
            `${format(dayChange, { signed: true })} today`)
        : null,
    ),
  );
}

// ---------------------------------------------------------------- benchmark

/**
 * The verdict card — the most important thing on the page.
 *
 * It answers "is picking stocks actually working?" and is written to be
 * uncomfortable when the answer is no.
 */
export function benchmarkCard(
  result: BenchmarkResult | undefined,
  benchmarkRate: number,
): HTMLElement {
  if (!result) {
    return card('Versus doing nothing',
      h('p', { class: 'muted' },
        `Add a deposit and some transactions, and this card will tell you whether ` +
        `you are beating an EGP money-market fund at ${formatPct(benchmarkRate, 0)} a year.`),
    );
  }

  const won = result.beatBenchmark;
  return h('section', { class: `card verdict ${won ? 'good' : 'bad'}` },
    h('h2', { class: 'card-title' }, 'Versus doing nothing'),
    h('div', { class: 'verdict-headline' },
      h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, won ? '▲' : '▼'),
      h('span', {}, won ? 'Ahead of the money-market fund' : 'Behind the money-market fund'),
    ),
    h('div', { class: `verdict-amount ${toneOf(result.valueDifference)}` },
      format(result.valueDifference, { signed: true }),
    ),
    benchmarkBar(result.actual, result.benchmark),
    h('dl', { class: 'stat-list' },
      statRow('Your annualised return', formatPct(result.actual), toneOf(result.actual)),
      statRow('Risk-free alternative', formatPct(result.benchmark), 'flat'),
      statRow('Excess return', formatPct(result.excess), toneOf(result.excess)),
      statRow('After inflation (real)', formatPct(result.realReturn), toneOf(result.realReturn)),
    ),
    h('p', { class: 'fineprint' },
      won
        ? 'Keep going, but check this again next quarter — one good quarter is luck, four is skill.'
        : 'The same money in an EGP money-market fund would be worth more. Two consecutive ' +
          'quarters behind is the signal to move the learning sleeve back to the core.',
    ),
  );
}

function statRow(label: string, value: string, tone: string): HTMLElement {
  return h('div', { class: 'stat-row' },
    h('dt', {}, label),
    h('dd', { class: tone }, value),
  );
}

// -------------------------------------------------------------------- KPIs

export function kpiGrid(summary: PortfolioSummary): HTMLElement {
  const tiles: readonly [string, string, string][] = [
    ['Invested', format(summary.invested), 'flat'],
    ['Cash', format(summary.cash), 'flat'],
    ['Unrealised P&L', format(summary.unrealisedPnl, { signed: true }), toneOf(summary.unrealisedPnl)],
    ['Realised P&L', format(summary.realisedPnl, { signed: true }), toneOf(summary.realisedPnl)],
    ['Dividends', format(summary.dividends), 'flat'],
    ['Costs paid', format(summary.totalCosts), summary.totalCosts > 0 ? 'neg' : 'flat'],
  ];

  return h('div', { class: 'kpi-grid' },
    ...tiles.map(([label, value, tone]) =>
      h('div', { class: 'kpi' },
        h('div', { class: 'kpi-label' }, label),
        h('div', { class: `kpi-value ${tone}` }, value),
      ),
    ),
  );
}

// -------------------------------------------------------------- allocation

const CLASS_LABELS: Readonly<Record<string, string>> = {
  equity: 'Equities',
  money_market: 'Money market',
  fund: 'Funds',
  cash: 'Cash',
};

/** Fixed slot per asset class — colour follows the entity, never its rank. */
const CLASS_SLOTS: Readonly<Record<string, number>> = {
  equity: 1,
  money_market: 3,
  fund: 2,
  cash: 2,
};

export function allocationCard(allocation: ReadonlyMap<string, Money>): HTMLElement {
  const total = [...allocation.values()].reduce((sum, v) => sum + v, 0);

  const slices: DonutSlice[] = [...allocation.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({
      label: CLASS_LABELS[key] ?? key,
      value,
      slot: CLASS_SLOTS[key] ?? 1,
    }));

  return card('Allocation',
    slices.length === 0
      ? h('p', { class: 'muted' }, 'Nothing allocated yet.')
      : h('div', { class: 'alloc' },
          donutChart(slices),
          // Direct labels with values: the contrast relief the palette requires,
          // and the fastest way to read an allocation anyway.
          h('ul', { class: 'legend' },
            ...slices.map((slice) =>
              h('li', {},
                h('span', { class: 'swatch', style: `background: var(--series-${slice.slot})` }),
                h('span', { class: 'legend-label' }, slice.label),
                h('span', { class: 'legend-value' },
                  `${format(slice.value, { currency: false })} · ${formatShare(total > 0 ? slice.value / total : 0)}`),
              ),
            ),
          ),
        ),
  );
}

// ------------------------------------------------------------- performance

export function performanceCard(
  snapshots: readonly Snapshot[],
  benchmark: readonly Snapshot[],
): HTMLElement {
  const tooltip = h('div', { class: 'tooltip', hidden: true });

  const series: Series[] = [
    { label: 'Your portfolio', points: snapshots, slot: 1 },
    { label: 'Money market', points: benchmark, slot: 2, dashed: true },
  ];

  return card('Value over time',
    h('div', { class: 'chart-wrap' },
      lineChart(series, { tooltip }),
      tooltip,
    ),
    h('ul', { class: 'legend inline' },
      h('li', {},
        h('span', { class: 'swatch', style: 'background: var(--series-1)' }),
        h('span', { class: 'legend-label' }, 'Your portfolio'),
      ),
      h('li', {},
        h('span', { class: 'swatch dashed', style: 'background: var(--series-2)' }),
        h('span', { class: 'legend-label' }, 'Money market benchmark'),
      ),
    ),
    snapshots.length < 2
      ? h('p', { class: 'fineprint' },
          'History builds as you open the dashboard — one snapshot per day. ' +
          'Past values are never back-filled, because historical EGX prices are not ' +
          'freely available and inventing them would make this chart a lie.')
      : null,
  );
}

// ---------------------------------------------------------------- holdings

export function holdingsCard(
  holdings: readonly Holding[],
  warnings: readonly ConcentrationWarning[],
): HTMLElement {
  const flagged = new Set(warnings.map((w) => w.symbol));

  if (holdings.length === 0) {
    return card('Holdings', h('p', { class: 'muted' }, 'No open positions yet.'));
  }

  return card('Holdings',
    warnings.length > 0
      ? h('div', { class: 'alert' },
          h('span', { 'aria-hidden': 'true' }, '⚠'),
          h('span', {},
            `${warnings.map((w) => w.symbol).join(', ')} ` +
            `${warnings.length === 1 ? 'exceeds' : 'exceed'} ` +
            `${formatShare(warnings[0]!.limit)} of the portfolio. ` +
            `Concentration is the fastest way to turn a learning sleeve into a loss.`),
        )
      : null,
    h('div', { class: 'table-wrap' },
      h('table', { class: 'holdings' },
        h('thead', {},
          h('tr', {},
            h('th', {}, 'Symbol'),
            h('th', { class: 'num' }, 'Qty'),
            h('th', { class: 'num' }, 'Avg cost'),
            h('th', { class: 'num' }, 'Price'),
            h('th', { class: 'num' }, 'Value'),
            h('th', { class: 'num' }, 'P&L'),
            h('th', { class: 'num' }, 'Weight'),
          ),
        ),
        h('tbody', {},
          ...holdings.map((holding) => holdingRow(holding, flagged.has(holding.symbol))),
        ),
      ),
    ),
  );
}

function holdingRow(holding: Holding, flagged: boolean): HTMLElement {
  return h('tr', { class: flagged ? 'flagged' : '' },
    h('td', {},
      h('div', { class: 'sym' }, holding.symbol),
      h('div', { class: 'sym-name' }, holding.instrument.name),
    ),
    h('td', { class: 'num' }, formatQuantity(holding.quantity)),
    h('td', { class: 'num' }, formatPrice(holding.averageCost)),
    h('td', { class: 'num' },
      holding.lastPrice === undefined
        ? h('span', { class: 'muted', title: 'No quote available — using average cost' }, '—')
        : formatPrice(holding.lastPrice),
    ),
    h('td', { class: 'num' }, format(holding.marketValue, { currency: false })),
    h('td', { class: `num ${toneOf(holding.unrealisedPnl)}` },
      h('div', {}, format(holding.unrealisedPnl, { signed: true, currency: false })),
      h('div', { class: 'sub' }, formatPct(holding.unrealisedPnlPct)),
    ),
    h('td', { class: 'num' }, formatShare(holding.weight)),
  );
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(3);
}

// ------------------------------------------------------------ transactions

export function transactionsCard(
  transactions: readonly Transaction[],
  onDelete: (id: string) => void,
): HTMLElement {
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  return card(`Transactions (${transactions.length})`,
    recent.length === 0
      ? h('p', { class: 'muted' }, 'Nothing logged yet. Every EGP in and out belongs here.')
      : h('ul', { class: 'txlist' },
          ...recent.map((tx) => transactionRow(tx, onDelete)),
        ),
  );
}

function transactionRow(tx: Transaction, onDelete: (id: string) => void): HTMLElement {
  const detail =
    tx.quantity !== undefined && tx.price !== undefined
      ? `${formatQuantity(tx.quantity)} @ ${formatPrice(tx.price)}`
      : tx.amount !== undefined
        ? format(tx.amount)
        : '';

  return h('li', { class: 'tx' },
    h('span', { class: `tx-kind ${tx.kind}` }, tx.kind),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-symbol' }, tx.symbol ?? '—'),
      h('span', { class: 'tx-detail' }, detail),
    ),
    h('span', { class: 'tx-date' }, tx.date),
    h('button', {
      class: 'btn icon',
      title: 'Delete transaction',
      'aria-label': `Delete ${tx.kind} on ${tx.date}`,
      onClick: () => onDelete(tx.id),
    }, '×'),
  );
}

// ------------------------------------------------------------------- form

export interface FormHandlers {
  readonly onSubmit: (form: HTMLFormElement) => void;
}

export function transactionForm(handlers: FormHandlers): HTMLElement {
  const options = h('datalist', { id: 'symbol-options' },
    ...EGX_INSTRUMENTS.map((i) => h('option', { value: i.symbol }, i.name)),
  );

  const form = h('form', { class: 'txform' },
    h('div', { class: 'field' },
      h('label', { for: 'f-kind' }, 'Type'),
      h('select', { id: 'f-kind', name: 'kind' },
        ...(['buy', 'sell', 'deposit', 'withdrawal', 'dividend', 'fee'] as const).map(
          (kind) => h('option', { value: kind }, kind),
        ),
      ),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'f-date' }, 'Date'),
      h('input', { id: 'f-date', name: 'date', type: 'date', required: true,
        value: new Date().toISOString().slice(0, 10) }),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'f-symbol' }, 'Symbol'),
      h('input', { id: 'f-symbol', name: 'symbol', list: 'symbol-options',
        placeholder: 'COMI', autocomplete: 'off' }),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'f-quantity' }, 'Quantity'),
      h('input', { id: 'f-quantity', name: 'quantity', type: 'number',
        step: 'any', min: '0', placeholder: '100' }),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'f-price' }, 'Price (EGP)'),
      h('input', { id: 'f-price', name: 'price', type: 'number',
        step: '0.001', min: '0', placeholder: '85.500' }),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'f-amount' }, 'Amount (EGP)'),
      h('input', { id: 'f-amount', name: 'amount', type: 'number',
        step: '0.01', placeholder: '30000.00' }),
    ),
    h('div', { class: 'field' },
      h('label', { for: 'f-costs' }, 'Actual costs (EGP)'),
      h('input', { id: 'f-costs', name: 'costs', type: 'number', step: '0.01', min: '0',
        placeholder: 'from contract note',
        title: 'Leave blank to use the modelled estimate. Fill it in from your contract note for exact tracking.' }),
    ),
    h('button', { class: 'btn primary', type: 'submit' }, 'Add transaction'),
    options,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onSubmit(form);
  });

  return card('Log a transaction', form);
}

// --------------------------------------------------------------- settings

export interface SettingsHandlers {
  readonly onChange: (patch: Record<string, string>) => void;
  readonly onExport: () => void;
  readonly onImport: (file: File) => void;
  readonly onSeedDemo: () => void;
  readonly onClear: () => void;
}

export function settingsCard(params: {
  readonly providerId: string;
  readonly benchmarkRate: number;
  readonly inflation: number;
  readonly otherFeesBps: number;
  readonly handlers: SettingsHandlers;
}): HTMLElement {
  const { handlers } = params;

  const numberField = (
    id: string, label: string, value: number, step: string, hint: string,
  ): HTMLElement =>
    h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('input', {
        id, type: 'number', step, value: String(value),
        onChange: (event: Event) =>
          handlers.onChange({ [id]: (event.target as HTMLInputElement).value }),
      }),
      h('small', { class: 'hint' }, hint),
    );

  const fileInput = h('input', {
    type: 'file', accept: 'application/json', class: 'hidden-file',
    onChange: (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) handlers.onImport(file);
    },
  });

  return card('Settings',
    h('div', { class: 'settings-grid' },
      h('div', { class: 'field' },
        h('label', { for: 'provider' }, 'Price source'),
        h('select', {
          id: 'provider',
          onChange: (event: Event) =>
            handlers.onChange({ providerId: (event.target as HTMLSelectElement).value }),
        },
          h('option', { value: 'mock', selected: params.providerId === 'mock' }, 'Demo data (offline)'),
          h('option', { value: 'yahoo', selected: params.providerId === 'yahoo' }, 'Yahoo Finance (live)'),
        ),
        h('small', { class: 'hint' }, 'Live quotes need the local server running.'),
      ),
      numberField('benchmarkRate', 'Benchmark rate', params.benchmarkRate, '0.005',
        'EGP money-market yield. ~0.22 as at Sep 2026.'),
      numberField('inflation', 'Inflation', params.inflation, '0.005',
        'For real returns. ~0.16 as at Sep 2026.'),
      numberField('otherFeesBps', 'Other fees (bps)', params.otherFeesBps, '0.5',
        'Estimated. Replace with your real contract-note figure.'),
    ),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn', onClick: handlers.onExport }, 'Export JSON'),
      h('button', { class: 'btn', onClick: () => fileInput.click() }, 'Import JSON'),
      h('button', { class: 'btn', onClick: handlers.onSeedDemo }, 'Load example'),
      h('button', { class: 'btn danger', onClick: handlers.onClear }, 'Clear all'),
      fileInput,
    ),
    h('p', { class: 'fineprint' },
      'Everything is stored in this browser only. No account, no server, no tracking. ' +
      'Export regularly — clearing site data deletes it permanently.'),
  );
}

// ------------------------------------------------------------------ footer

export function disclaimer(): HTMLElement {
  return h('footer', { class: 'disclaimer' },
    h('p', {},
      h('strong', {}, 'Not financial advice. '),
      'This is a tracking tool. It measures decisions; it does not make them. ' +
      'Figures for costs and taxes are modelled from published rates and may be ' +
      'wrong — always reconcile against your real Telda statements.',
    ),
  );
}

export { s, toEgp, type Attrs };

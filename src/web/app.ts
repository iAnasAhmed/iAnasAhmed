/**
 * Application entry point. Wires state to views; holds no business logic.
 */

import { render, qs, h } from './dom.ts';
import * as views from './views.ts';
import {
  loadState, saveState, addTransaction, removeTransaction, updateSettings,
  withHistory, toggleWatch, newId, symbolsIn, toExport, reviveState, EMPTY_STATE,
  type AppState,
} from './store.ts';
import { demoState } from './demo.ts';
import { egp, price, type Money, type Price } from '../core/money.ts';
import type { Quote, Transaction, TransactionKind } from '../core/types.ts';
import { buildPortfolio, concentrationWarnings, allocationByClass } from '../core/portfolio.ts';
import {
  portfolioCashFlows, xirr, compareToBenchmark, daysSince, simpleReturn, annualise,
  type BenchmarkResult,
} from '../core/performance.ts';
import { recordSnapshot, benchmarkSeries, alignedDates, trimHistory, today } from '../core/history.ts';
import { marketStatus } from '../core/market-hours.ts';
import { instrumentMap, EGX_INSTRUMENTS } from '../data/symbols.ts';
import { createProvider, type ProviderId } from '../data/registry.ts';
import {
  runScreen, equitySectorWeights, sectorsIn, DEFAULT_WEIGHTS,
  type ScreenMetrics, type ScreenWeights, type ScreenFilters,
} from '../core/screener.ts';
import { createFundamentalsProvider } from '../data/fundamentals.ts';
import * as screener from './screener-view.ts';
import type { RawFilters } from './screener-view.ts';

const storage: Storage = globalThis.localStorage;

let state: AppState = loadState(storage);
let quotes: ReadonlyMap<string, Quote> = new Map();

// --- research view state (transient; not persisted)
type View = 'portfolio' | 'research';
let view: View = 'portfolio';
let fundamentals: ReadonlyMap<string, ScreenMetrics> = new Map();
let fundamentalsLoaded = false;
let screenWeights: ScreenWeights = { ...DEFAULT_WEIGHTS };
let rawFilters: RawFilters = {
  search: '', sector: '', minLiquidityM: 0, maxPe: 0, minDivYield: 0,
};

// ------------------------------------------------------------------ helpers

function costConfig(): { commissionBps: number; stampDutyBps: number; otherFeesBps: number } {
  const { commissionBps, stampDutyBps, otherFeesBps } = state.settings;
  return { commissionBps, stampDutyBps, otherFeesBps };
}

function currentSummary() {
  return buildPortfolio(state.transactions, {
    costConfig: costConfig(),
    quotes,
    instruments: instrumentMap(state.customInstruments),
  });
}

/** Day change across all holdings, when previous closes are available. */
function dayChange(): Money | undefined {
  const summary = currentSummary();
  let change = 0;
  let sawAny = false;

  for (const holding of summary.holdings) {
    const quote = quotes.get(holding.symbol);
    if (!quote?.previousClose) continue;
    sawAny = true;
    change += (holding.quantity * (quote.price - quote.previousClose)) / 10;
  }

  return sawAny ? (Math.round(change) as Money) : undefined;
}

function benchmarkResult(): BenchmarkResult | undefined {
  const summary = currentSummary();
  if (summary.netContributions <= 0) return undefined;

  const dates = state.transactions.map((tx) => tx.date).sort();
  const firstDate = dates[0];
  if (!firstDate) return undefined;

  const days = Math.max(1, daysSince(firstDate, today()));
  const flows = portfolioCashFlows(state.transactions, summary.totalValue, today());

  // XIRR when the flows support it; otherwise annualise the simple return.
  const rate =
    xirr(flows) ??
    annualise(simpleReturn(summary.totalPnl, summary.netContributions), days);

  return compareToBenchmark({
    annualisedReturn: rate,
    netContributions: summary.netContributions,
    currentValue: summary.totalValue,
    days,
    benchmarkRate: state.settings.benchmarkRate,
    inflation: state.settings.inflation,
  });
}

function persist(next: AppState): void {
  state = next;
  saveState(storage, state);
  renderApp();
}

function applyTheme(): void {
  const { theme } = state.settings;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

// ------------------------------------------------------------------ actions

function handleSubmit(form: HTMLFormElement): void {
  const data = new FormData(form);
  const read = (name: string): string => String(data.get(name) ?? '').trim();

  const kind = read('kind') as TransactionKind;
  const date = read('date');
  if (!date) return;

  const symbol = read('symbol').toUpperCase();
  const quantity = read('quantity') ? Number(read('quantity')) : undefined;
  const priceValue = read('price') ? Number(read('price')) : undefined;
  const amount = read('amount') ? Number(read('amount')) : undefined;
  const costs = read('costs') ? Number(read('costs')) : undefined;

  // Guard the combinations that would produce a meaningless row.
  if ((kind === 'buy' || kind === 'sell') && (!symbol || !quantity || priceValue === undefined)) {
    window.alert('A buy or sell needs a symbol, a quantity and a price.');
    return;
  }
  if ((kind === 'deposit' || kind === 'withdrawal' || kind === 'dividend' || kind === 'fee')
      && amount === undefined) {
    window.alert(`A ${kind} needs an amount.`);
    return;
  }

  const tx: Transaction = {
    id: newId(),
    date,
    kind,
    ...(symbol ? { symbol } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(priceValue !== undefined ? { price: price(priceValue) as Price } : {}),
    ...(amount !== undefined ? { amount: egp(amount) } : {}),
    ...(costs !== undefined ? { costs: egp(costs) } : {}),
  };

  persist(addTransaction(state, tx));
  form.reset();
  const dateField = form.querySelector<HTMLInputElement>('#f-date');
  if (dateField) dateField.value = today();
}

function handleSettingsChange(patch: Record<string, string>): void {
  const next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    next[key] = key === 'providerId' ? (raw as ProviderId) : Number(raw);
  }
  persist(updateSettings(state, next));
  void refreshQuotes();
}

function handleExport(): void {
  const blob = new Blob([JSON.stringify(toExport(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `telda-tracker-${today()}.json` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleImport(file: File): Promise<void> {
  try {
    persist(reviveState(JSON.parse(await file.text())));
    await refreshQuotes();
  } catch {
    window.alert('That file could not be read as a valid export.');
  }
}

function handleClear(): void {
  if (window.confirm('Delete every transaction and setting? This cannot be undone.')) {
    persist(EMPTY_STATE);
  }
}

// ------------------------------------------------------------------- quotes

async function refreshQuotes(): Promise<void> {
  const symbols = symbolsIn(state);
  if (symbols.length === 0) {
    quotes = new Map();
    renderApp();
    return;
  }

  const provider = createProvider(state.settings.providerId, {
    quotesEndpoint: '/api/quotes',
    chartEndpoint: '/api/quote/',
  });
  try {
    quotes = await provider.getQuotes(symbols);
  } catch {
    quotes = new Map(); // a dead provider must not blank the dashboard
  }
  captureSnapshot();
  renderApp();
}

/** Record one observed value per day. This is the only source of chart history. */
function captureSnapshot(): void {
  const summary = currentSummary();
  if (summary.totalValue === 0 && state.transactions.length === 0) return;
  const history = trimHistory(recordSnapshot(state.history, summary.totalValue));
  state = withHistory(state, history);
  saveState(storage, state);
}

// -------------------------------------------------------------------- render

function renderApp(): void {
  applyTheme();

  const provider = createProvider(state.settings.providerId);

  render(qs('#app'),
    views.header({
      status: marketStatus(),
      providerLabel: provider.label,
      isDemo: state.settings.providerId === 'mock',
      view,
      onNav: (next) => {
        if (next === view) return;
        view = next;
        renderApp();
        if (view === 'research' && !fundamentalsLoaded) void loadFundamentals();
      },
      onRefresh: () => void refreshQuotes(),
      onToggleTheme: () => {
        const next = state.settings.theme === 'system' ? 'light'
          : state.settings.theme === 'light' ? 'dark' : 'system';
        persist(updateSettings(state, { theme: next }));
      },
    }),
    view === 'research' ? renderResearch() : renderPortfolio(),
  );
}

function renderPortfolio(): HTMLElement {
  const summary = currentSummary();
  const dates = alignedDates(state.history, [today()]);

  return h('main', { class: 'layout' },
    views.hero(summary, dayChange()),
    views.benchmarkCard(benchmarkResult(), state.settings.benchmarkRate),
    views.kpiGrid(summary),

    h('div', { class: 'grid-2' },
      views.allocationCard(allocationByClass(summary)),
      views.performanceCard(
        state.history,
        benchmarkSeries(state.transactions, state.settings.benchmarkRate, dates),
      ),
    ),

    views.holdingsCard(summary.holdings, concentrationWarnings(summary)),

    h('div', { class: 'grid-2' },
      views.transactionForm({ onSubmit: handleSubmit }),
      views.transactionsCard(state.transactions, (id) => {
        persist(removeTransaction(state, id));
      }),
    ),

    views.settingsCard({
      providerId: state.settings.providerId,
      benchmarkRate: state.settings.benchmarkRate,
      inflation: state.settings.inflation,
      otherFeesBps: state.settings.otherFeesBps,
      handlers: {
        onChange: handleSettingsChange,
        onExport: handleExport,
        onImport: (file) => void handleImport(file),
        onSeedDemo: () => { persist(demoState()); void refreshQuotes(); },
        onClear: handleClear,
      },
    }),

    views.disclaimer(),
  );
}

// ------------------------------------------------------------------ research

/** Screener filters as the engine wants them, derived from the raw UI values. */
function screenFilters(): ScreenFilters {
  const filters: ScreenFilters = {
    ...(rawFilters.search ? { search: rawFilters.search } : {}),
    ...(rawFilters.sector ? { sectors: [rawFilters.sector] } : {}),
    ...(rawFilters.minLiquidityM > 0 ? { minLiquidity: egp(rawFilters.minLiquidityM * 1_000_000) } : {}),
    ...(rawFilters.maxPe > 0 ? { maxPe: rawFilters.maxPe } : {}),
    ...(rawFilters.minDivYield > 0 ? { minDividendYield: rawFilters.minDivYield / 100 } : {}),
  };
  return filters;
}

function renderResearch(): HTMLElement {
  const metrics = [...fundamentals.values()];
  const summary = currentSummary();

  const results = runScreen(metrics, {
    filters: screenFilters(),
    weights: screenWeights,
    benchmarkRate: state.settings.benchmarkRate,
    sectorWeights: equitySectorWeights(summary.holdings),
  });

  const provider = createFundamentalsProvider(state.settings.fundamentalsId);

  if (!fundamentalsLoaded) {
    return h('main', { class: 'layout' },
      h('section', { class: 'card' },
        h('p', { class: 'muted' }, 'Loading fundamentals…')),
    );
  }

  return screener.screenerView({
    results,
    sectors: sectorsIn(metrics),
    weights: screenWeights,
    filters: rawFilters,
    watchlist: state.watchlist,
    benchmarkRate: state.settings.benchmarkRate,
    isDemo: state.settings.fundamentalsId === 'mock',
    sourceLabel: provider.label,
    sourceId: state.settings.fundamentalsId,
    totalUniverse: metrics.length,
    handlers: {
      onFilters: (patch) => { rawFilters = { ...rawFilters, ...patch }; renderApp(); },
      onWeight: (factor, value) => { screenWeights = { ...screenWeights, [factor]: value }; renderApp(); },
      onToggleWatch: (symbol) => persist(toggleWatch(state, symbol)),
      onSourceChange: (id) => {
        persist(updateSettings(state, { fundamentalsId: id as ProviderId }));
        void loadFundamentals();
      },
    },
  });
}

async function loadFundamentals(): Promise<void> {
  const symbols = EGX_INSTRUMENTS.filter((i) => i.assetClass === 'equity').map((i) => i.symbol);
  const provider = createFundamentalsProvider(state.settings.fundamentalsId, {
    quotesEndpoint: '/api/quotes',
  });
  try {
    fundamentals = await provider.getFundamentals(symbols);
  } catch {
    fundamentals = new Map();
  }
  fundamentalsLoaded = true;
  if (view === 'research') renderApp();
}

// ---------------------------------------------------------------------- boot

/**
 * `#demo` (or the `__TELDA_DEMO__` global the standalone bundle sets) loads the
 * example portfolio without touching saved data — handy for a first look, for
 * reproducible screenshots, and for the shareable single-file build.
 */
const wantsDemo =
  globalThis.location?.hash === '#demo' ||
  (globalThis as { __TELDA_DEMO__?: boolean }).__TELDA_DEMO__ === true;
if (wantsDemo && state.transactions.length === 0) {
  state = demoState();
}

renderApp();
void refreshQuotes();

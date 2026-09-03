/**
 * Application entry point. Wires state to views; holds no business logic.
 */

import { render, qs, h } from './dom.ts';
import * as views from './views.ts';
import {
  loadState, saveState, addTransaction, removeTransaction, updateSettings,
  withHistory, newId, symbolsIn, toExport, reviveState, EMPTY_STATE,
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
import { instrumentMap } from '../data/symbols.ts';
import { createProvider, type ProviderId } from '../data/registry.ts';

const storage: Storage = globalThis.localStorage;

let state: AppState = loadState(storage);
let quotes: ReadonlyMap<string, Quote> = new Map();

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

  const provider = createProvider(state.settings.providerId, { endpoint: '/api/quote/' });
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

  const summary = currentSummary();
  const provider = createProvider(state.settings.providerId);
  const dates = alignedDates(state.history, [today()]);

  render(qs('#app'),
    views.header({
      status: marketStatus(),
      providerLabel: provider.label,
      isDemo: state.settings.providerId === 'mock',
      onRefresh: () => void refreshQuotes(),
      onToggleTheme: () => {
        const next = state.settings.theme === 'system' ? 'light'
          : state.settings.theme === 'light' ? 'dark' : 'system';
        persist(updateSettings(state, { theme: next }));
      },
    }),

    h('main', { class: 'layout' },
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
    ),
  );
}

// ---------------------------------------------------------------------- boot

/**
 * `#demo` loads the example portfolio without touching saved data — handy for
 * a first look, and for reproducible screenshots.
 */
if (globalThis.location?.hash === '#demo' && state.transactions.length === 0) {
  state = demoState();
}

renderApp();
void refreshQuotes();

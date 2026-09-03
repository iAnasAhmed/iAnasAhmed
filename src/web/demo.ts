/**
 * Example portfolio.
 *
 * Deliberately built to the framework in docs/allocation-framework.md on a
 * 30,000 EGP base: ~70% money market, ~20% equities, ~10% cash. It exists to
 * show what a tracked portfolio looks like — the symbols are illustrative,
 * **not recommendations** (CLAUDE.md §1.6).
 */

import { egp, price } from '../core/money.ts';
import type { Transaction } from '../core/types.ts';
import type { AppState } from './store.ts';
import { DEFAULT_SETTINGS } from './store.ts';

export function demoState(): AppState {
  // Cost bases sit just below the demo's current (approximate real) prices, so
  // the equity sleeve shows modest gains — enough to look real, not so much
  // that it swamps the "slightly behind the money-market fund" teaching point.
  const transactions: Transaction[] = [
    { id: 'd1', date: '2026-04-01', kind: 'deposit', amount: egp(30_000),
      note: 'Opening capital' },

    // Core sleeve: the benchmark itself, ~70% (21,000 of 30,000).
    { id: 'd2', date: '2026-04-02', kind: 'buy', symbol: 'MMF',
      quantity: 2_100, price: price(10) },

    // Learning sleeve: ~20%, three liquid names, none above ~40% of the sleeve.
    { id: 'd3', date: '2026-04-05', kind: 'buy', symbol: 'COMI',
      quantity: 25, price: price(132.0) },   // now ~138
    { id: 'd4', date: '2026-05-12', kind: 'buy', symbol: 'ETEL',
      quantity: 20, price: price(106.0) },   // now ~111
    { id: 'd5', date: '2026-06-03', kind: 'buy', symbol: 'FWRY',
      quantity: 60, price: price(19.2) },    // now ~20

    { id: 'd6', date: '2026-07-15', kind: 'dividend', symbol: 'COMI',
      amount: egp(108), note: 'Net of 5% WHT' },

    // A trimmed position, so realised P&L is non-zero.
    { id: 'd7', date: '2026-08-20', kind: 'sell', symbol: 'FWRY',
      quantity: 20, price: price(20.5) },
  ];

  // A plausible snapshot history, roughly consistent with what the transactions
  // above plus demo quotes produce (~30.3k), so the chart has no cliff where the
  // seeded history meets today's live snapshot.
  const history = [
    { date: '2026-04-02', value: egp(29_960) },
    { date: '2026-05-01', value: egp(30_050) },
    { date: '2026-06-01', value: egp(29_900) },
    { date: '2026-07-01', value: egp(30_140) },
    { date: '2026-08-01', value: egp(30_260) },
    { date: '2026-09-01', value: egp(30_330) },
  ];

  return {
    transactions,
    customInstruments: [],
    history,
    // A couple of names already shortlisted, so the Research view isn't empty.
    watchlist: ['SWDY', 'ABUK'],
    settings: DEFAULT_SETTINGS,
  };
}

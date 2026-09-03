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
  const transactions: Transaction[] = [
    { id: 'd1', date: '2026-04-01', kind: 'deposit', amount: egp(30_000),
      note: 'Opening capital' },

    // Core sleeve: the benchmark itself, ~70%.
    { id: 'd2', date: '2026-04-02', kind: 'buy', symbol: 'MMF',
      quantity: 2_100, price: price(10) },

    // Learning sleeve: ~20%, three liquid names, none above 40% of the sleeve.
    { id: 'd3', date: '2026-04-05', kind: 'buy', symbol: 'COMI',
      quantity: 25, price: price(89.2) },
    { id: 'd4', date: '2026-05-12', kind: 'buy', symbol: 'ETEL',
      quantity: 45, price: price(43.6) },
    { id: 'd5', date: '2026-06-03', kind: 'buy', symbol: 'FWRY',
      quantity: 200, price: price(7.85) },

    { id: 'd6', date: '2026-07-15', kind: 'dividend', symbol: 'COMI',
      amount: egp(142.5), note: 'Net of 5% WHT' },

    // A trimmed position, so realised P&L is non-zero.
    { id: 'd7', date: '2026-08-20', kind: 'sell', symbol: 'FWRY',
      quantity: 80, price: price(8.6) },
  ];

  // A plausible snapshot history, kept consistent with what the transactions
  // above plus demo quotes actually produce (~30.4k) so the chart has no cliff
  // where the seeded history meets today's live snapshot.
  const history = [
    { date: '2026-04-02', value: egp(29_955) },
    { date: '2026-05-01', value: egp(30_120) },
    { date: '2026-06-01', value: egp(29_880) },
    { date: '2026-07-01', value: egp(30_240) },
    { date: '2026-08-01', value: egp(30_510) },
    { date: '2026-09-01', value: egp(30_390) },
  ];

  return {
    transactions,
    customInstruments: [],
    history,
    settings: DEFAULT_SETTINGS,
  };
}

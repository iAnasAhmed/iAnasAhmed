/**
 * Example portfolio.
 *
 * Deliberately built to the framework in docs/allocation-framework.md on a
 * 30,000 EGP base: ~70% money market, ~20% equities, ~10% cash. It exists to
 * show what a tracked portfolio looks like — the symbols are illustrative,
 * **not recommendations** (CLAUDE.md §1.6).
 */

import { egp, price } from '../core/money.ts';
import type { Note } from '../core/notes.ts';
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

  // Example journal entries — illustrative reasoning, not advice, showing the
  // range of note kinds the system tracks.
  const notes: Note[] = [
    {
      id: 'note-1', createdAt: '2026-04-05T09:00:00.000Z', updatedAt: '2026-07-20T09:00:00.000Z',
      title: 'CIB: cheap, liquid, benefits from high rates',
      body: 'Banks earn the spread while CBE holds ~19%. Trades ~6x earnings with a real dividend. Core learning-sleeve holding.',
      kind: 'thesis', sentiment: 'bullish', conviction: 4, horizon: 'long', status: 'open',
      symbol: 'COMI', tags: ['banks', 'rates'], targetPrice: price(160), reviewOn: '2026-10-01',
    },
    {
      id: 'note-2', createdAt: '2026-05-12T09:00:00.000Z', updatedAt: '2026-08-01T09:00:00.000Z',
      title: 'Telecom Egypt has run hard — trim into strength?',
      body: 'Up ~150% over the year. Still cheap on P/E but the easy gains are behind it. Watching for a pullback rather than adding.',
      kind: 'observation', sentiment: 'neutral', conviction: 3, horizon: 'medium', status: 'watching',
      symbol: 'ETEL', tags: ['momentum'],
    },
    {
      id: 'note-3', createdAt: '2026-06-03T09:00:00.000Z', updatedAt: '2026-06-03T09:00:00.000Z',
      title: 'EGP devaluation risk overhangs everything',
      body: 'Nominal EGP gains flatter the picture. Keep watching the USD-adjusted view; a sharp move would hit the whole book.',
      kind: 'risk', sentiment: 'bearish', conviction: 3, horizon: 'long', status: 'open',
      tags: ['macro', 'currency'],
    },
    {
      id: 'note-4', createdAt: '2026-08-20T09:00:00.000Z', updatedAt: '2026-08-20T09:00:00.000Z',
      title: 'Lesson: trimmed Fawry too early',
      body: 'Sold a third near 20.5 on a hunch; it kept grinding up. Position sizing should be the rule, not gut timing.',
      kind: 'lesson', sentiment: 'neutral', conviction: 4, horizon: 'short', status: 'closed',
      symbol: 'FWRY', tags: ['discipline'],
    },
  ];

  return {
    transactions,
    customInstruments: [],
    history,
    // A couple of names already shortlisted, so the Research view isn't empty.
    watchlist: ['SWDY', 'ABUK'],
    notes,
    settings: DEFAULT_SETTINGS,
  };
}

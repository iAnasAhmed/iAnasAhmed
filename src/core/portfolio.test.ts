import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egp, price, valueOf } from './money.ts';
import type { Instrument, Quote, Transaction } from './types.ts';
import { NO_COSTS, TELDA_EGX } from './costs.ts';
import {
  buildPortfolio, concentrationWarnings, allocationByClass, costsFor, grossValue,
} from './portfolio.ts';

let seq = 0;
const tx = (t: Omit<Transaction, 'id'>): Transaction => ({ id: `t${++seq}`, ...t });

const deposit = (date: string, amount: number) =>
  tx({ date, kind: 'deposit', amount: egp(amount) });

const buy = (date: string, symbol: string, quantity: number, p: number) =>
  tx({ date, kind: 'buy', symbol, quantity, price: price(p) });

const sell = (date: string, symbol: string, quantity: number, p: number) =>
  tx({ date, kind: 'sell', symbol, quantity, price: price(p) });

const quotes = (m: Record<string, number>): Map<string, Quote> =>
  new Map(
    Object.entries(m).map(([symbol, p]) => [
      symbol,
      { symbol, price: price(p), asOf: '2026-09-02T12:00:00Z' },
    ]),
  );

// ------------------------------------------------------------------ basics

test('an empty portfolio is all zeros, not NaN', () => {
  const p = buildPortfolio([]);
  assert.equal(p.totalValue, 0);
  assert.equal(p.cash, 0);
  assert.equal(p.totalReturnPct, 0);
  assert.deepEqual(p.holdings, []);
});

test('deposits and withdrawals move cash and net contributions', () => {
  const p = buildPortfolio([
    deposit('2026-01-01', 30_000),
    tx({ date: '2026-02-01', kind: 'withdrawal', amount: egp(5_000) }),
  ]);
  assert.equal(p.cash, egp(25_000));
  assert.equal(p.netContributions, egp(25_000));
  assert.equal(p.invested, 0);
});

test('a buy moves cash into a holding and capitalises costs', () => {
  const p = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 85.5)],
    { costConfig: TELDA_EGX },
  );
  // gross = 8,550. costs = 15 bps = 12.83 (rounded from 12.825)
  const gross = egp(8_550);
  const costs = egp(12.83);
  assert.equal(p.cash, egp(30_000) - gross - costs);

  const h = p.holdings[0]!;
  assert.equal(h.symbol, 'COMI');
  assert.equal(h.quantity, 100);
  assert.equal(h.costBasis, gross + costs);
  assert.equal(p.totalCosts, costs);
});

test('average cost includes buy costs and blends across purchases', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),
      buy('2026-01-03', 'COMI', 100, 90),
    ],
    { costConfig: NO_COSTS },
  );
  const h = p.holdings[0]!;
  assert.equal(h.quantity, 200);
  assert.equal(h.costBasis, egp(17_000));
  assert.equal(h.averageCost, price(85)); // (80 + 90) / 2
});

// ------------------------------------------------------------- P&L accuracy

test('unrealised P&L uses the live quote', () => {
  const p = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 80)],
    { costConfig: NO_COSTS, quotes: quotes({ COMI: 92 }) },
  );
  const h = p.holdings[0]!;
  assert.equal(h.marketValue, egp(9_200));
  assert.equal(h.unrealisedPnl, egp(1_200));
  assert.equal(h.unrealisedPnlPct, 0.15);
});

test('a partial sell realises exactly its share of the basis', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),   // basis 8,000
      sell('2026-03-01', 'COMI', 40, 100),  // proceeds 4,000, basis out 3,200
    ],
    { costConfig: NO_COSTS, quotes: quotes({ COMI: 100 }) },
  );
  assert.equal(p.realisedPnl, egp(800)); // 4,000 - 3,200

  const h = p.holdings[0]!;
  assert.equal(h.quantity, 60);
  assert.equal(h.costBasis, egp(4_800)); // 8,000 - 3,200
  assert.equal(h.marketValue, egp(6_000));
  assert.equal(h.unrealisedPnl, egp(1_200));
});

test('closing a position fully leaves no residual basis', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),
      sell('2026-03-01', 'COMI', 100, 95),
    ],
    { costConfig: NO_COSTS },
  );
  assert.deepEqual(p.holdings, []);
  assert.equal(p.realisedPnl, egp(1_500));
  assert.equal(p.invested, 0);
  assert.equal(p.cash, egp(30_000 - 8_000 + 9_500));
});

test('a loss is realised as a negative number', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),
      sell('2026-03-01', 'COMI', 100, 60),
    ],
    { costConfig: NO_COSTS },
  );
  assert.equal(p.realisedPnl, egp(-2_000));
  assert.equal(p.totalPnl, egp(-2_000));
});

test('costs reduce realised gains on both legs', () => {
  const withCosts = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 80), sell('2026-03-01', 'COMI', 100, 80)],
    { costConfig: TELDA_EGX },
  );
  // Flat price, so the entire loss is the round trip: 15 bps x 8,000 x 2 = 24 EGP
  assert.equal(withCosts.realisedPnl, egp(-24));
  assert.equal(withCosts.totalCosts, egp(24));
});

test('dividends are recorded net and added to cash and P&L', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),
      // 1,000 gross, 5% WHT -> 950 net is what the owner records
      tx({ date: '2026-06-01', kind: 'dividend', symbol: 'COMI', amount: egp(950) }),
    ],
    { costConfig: NO_COSTS, quotes: quotes({ COMI: 80 }) },
  );
  assert.equal(p.dividends, egp(950));
  assert.equal(p.holdings[0]!.dividends, egp(950));
  assert.equal(p.cash, egp(30_000 - 8_000 + 950));
  assert.equal(p.totalPnl, egp(950));
});

test('standalone fees reduce cash and count as costs', () => {
  const p = buildPortfolio([
    deposit('2026-01-01', 1_000),
    tx({ date: '2026-01-05', kind: 'fee', amount: egp(25) }),
  ]);
  assert.equal(p.cash, egp(975));
  assert.equal(p.totalCosts, egp(25));
});

// ------------------------------------------------------- ordering & robustness

test('transactions are applied in date order regardless of input order', () => {
  const ordered = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 80), sell('2026-03-01', 'COMI', 50, 100)],
    { costConfig: NO_COSTS },
  );
  const shuffled = buildPortfolio(
    [sell('2026-03-01', 'COMI', 50, 100), deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 80)],
    { costConfig: NO_COSTS },
  );
  assert.equal(ordered.realisedPnl, shuffled.realisedPnl);
  assert.equal(ordered.cash, shuffled.cash);
});

test('overselling is clamped rather than throwing', () => {
  // A typo in the log must not crash the dashboard.
  const p = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 80), sell('2026-03-01', 'COMI', 500, 100)],
    { costConfig: NO_COSTS },
  );
  assert.deepEqual(p.holdings, []);
  assert.equal(p.realisedPnl, egp(2_000)); // only the 100 held are realised
});

test('a holding with no quote falls back to average cost, showing zero P&L', () => {
  const p = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'XXXX', 10, 50)],
    { costConfig: NO_COSTS },
  );
  const h = p.holdings[0]!;
  assert.equal(h.lastPrice, undefined);
  assert.equal(h.unrealisedPnl, 0);
  assert.equal(h.marketValue, egp(500));
});

test('the accounting identity holds: value = contributions + P&L', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),
      buy('2026-01-03', 'ETEL', 200, 25),
      sell('2026-04-01', 'COMI', 50, 95),
      tx({ date: '2026-06-01', kind: 'dividend', symbol: 'ETEL', amount: egp(400) }),
    ],
    { costConfig: TELDA_EGX, quotes: quotes({ COMI: 95, ETEL: 28 }) },
  );
  // Every EGP is accounted for: what you have equals what you put in plus what you made.
  assert.equal(p.totalValue, p.netContributions + p.totalPnl);
});

// ------------------------------------------------------------- portfolio views

test('weights sum to 1 and holdings sort by market value', () => {
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 100, 80),
      buy('2026-01-03', 'ETEL', 100, 25),
    ],
    { costConfig: NO_COSTS, quotes: quotes({ COMI: 80, ETEL: 25 }) },
  );
  assert.equal(p.holdings[0]!.symbol, 'COMI'); // larger first
  const sum = p.holdings.reduce((acc, h) => acc + h.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('concentration warnings flag oversized positions', () => {
  const p = buildPortfolio(
    [deposit('2026-01-01', 30_000), buy('2026-01-02', 'COMI', 100, 80), buy('2026-01-03', 'ETEL', 40, 25)],
    { costConfig: NO_COSTS, quotes: quotes({ COMI: 80, ETEL: 25 }) },
  );
  const warnings = concentrationWarnings(p, 0.4);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.symbol, 'COMI');
  assert.equal(concentrationWarnings(p, 0.95).length, 0);
});

test('allocation groups by asset class and includes cash', () => {
  const instruments = new Map<string, Instrument>([
    ['COMI', { symbol: 'COMI', name: 'CIB', assetClass: 'equity' }],
    ['MMF', { symbol: 'MMF', name: 'Money Market Fund', assetClass: 'money_market' }],
  ]);
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'COMI', 75, 80),   //  6,000
      buy('2026-01-03', 'MMF', 2100, 10),  // 21,000
    ],
    { costConfig: NO_COSTS, instruments, quotes: quotes({ COMI: 80, MMF: 10 }) },
  );
  const alloc = allocationByClass(p);
  assert.equal(alloc.get('equity'), egp(6_000));
  assert.equal(alloc.get('money_market'), egp(21_000));
  assert.equal(alloc.get('cash'), egp(3_000));
});

// ------------------------------------------------------------------- helpers

test('grossValue and costsFor behave on trade and non-trade rows', () => {
  const b = buy('2026-01-02', 'COMI', 100, 85.5);
  assert.equal(grossValue(b), valueOf(100, price(85.5)));
  assert.equal(costsFor(b, NO_COSTS), 0);
  assert.equal(grossValue(deposit('2026-01-01', 100)), 0);
});

test('a recorded real cost overrides the modelled estimate', () => {
  // After the first real contract note, reality must win over the model.
  const real = tx({
    date: '2026-01-02', kind: 'buy', symbol: 'COMI',
    quantity: 100, price: price(80), costs: egp(9.99),
  });
  assert.equal(costsFor(real, TELDA_EGX), egp(9.99));
});

test('the money-market core is exempt from concentration warnings', () => {
  // The framework wants ~70% in the money-market sleeve, so warning about it
  // would train the owner to ignore the warning that actually matters.
  const instruments = new Map<string, Instrument>([
    ['MMF', { symbol: 'MMF', name: 'Money Market Fund', assetClass: 'money_market' }],
    ['COMI', { symbol: 'COMI', name: 'CIB', assetClass: 'equity' }],
  ]);
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'MMF', 2_100, 10),  // 21,000 — 78% of invested
      buy('2026-01-03', 'COMI', 75, 80),    //  6,000 — 22%
    ],
    { costConfig: NO_COSTS, instruments, quotes: quotes({ MMF: 10, COMI: 80 }) },
  );
  assert.deepEqual(concentrationWarnings(p), []);
});

test('an oversized equity position is still flagged', () => {
  const instruments = new Map<string, Instrument>([
    ['MMF', { symbol: 'MMF', name: 'Money Market Fund', assetClass: 'money_market' }],
    ['COMI', { symbol: 'COMI', name: 'CIB', assetClass: 'equity' }],
  ]);
  const p = buildPortfolio(
    [
      deposit('2026-01-01', 30_000),
      buy('2026-01-02', 'MMF', 500, 10),    //  5,000
      buy('2026-01-03', 'COMI', 250, 80),   // 20,000 — 80%
    ],
    { costConfig: NO_COSTS, instruments, quotes: quotes({ MMF: 10, COMI: 80 }) },
  );
  const warnings = concentrationWarnings(p);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.symbol, 'COMI');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egp, price } from './money.ts';
import type { Holding, Instrument } from './types.ts';
import {
  runScreen, applyFilters, liquidityTier, equitySectorWeights, sectorsIn,
  totalWeight, DEFAULT_WEIGHTS, type ScreenMetrics, type ScreenWeights,
} from './screener.ts';

const m = (over: Partial<ScreenMetrics> & Pick<ScreenMetrics, 'symbol'>): ScreenMetrics => ({
  name: over.symbol, sector: 'Banking', ...over,
});

const universe: ScreenMetrics[] = [
  m({ symbol: 'BIGL', sector: 'Banking', avgDailyValue: egp(50_000_000), marketCap: egp(200_000_000_000),
      peRatio: 8, pbRatio: 1.2, dividendYield: 0.05, yearChange: 0.40, price: price(90) }),
  m({ symbol: 'MIDD', sector: 'Telecom', avgDailyValue: egp(8_000_000), marketCap: egp(40_000_000_000),
      peRatio: 12, pbRatio: 2.0, dividendYield: 0.03, yearChange: 0.10, price: price(45) }),
  m({ symbol: 'THIN', sector: 'Real estate', avgDailyValue: egp(500_000), marketCap: egp(2_000_000_000),
      peRatio: 25, pbRatio: 3.5, dividendYield: 0.0, yearChange: -0.15, price: price(9) }),
];

// ------------------------------------------------------------ liquidity tier

test('liquidity tiers follow the thresholds; unknown is treated as thin', () => {
  assert.equal(liquidityTier(egp(50_000_000)), 'liquid');
  assert.equal(liquidityTier(egp(8_000_000)), 'moderate');
  assert.equal(liquidityTier(egp(500_000)), 'thin');
  assert.equal(liquidityTier(undefined), 'thin'); // never assume easy exit
});

// ----------------------------------------------------------------- filtering

test('minLiquidity excludes thin names', () => {
  const kept = applyFilters(universe, { minLiquidity: egp(2_000_000) });
  assert.deepEqual(kept.map((x) => x.symbol).sort(), ['BIGL', 'MIDD']);
});

test('search matches symbol or name, case-insensitively', () => {
  assert.equal(applyFilters(universe, { search: 'big' }).length, 1);
  assert.equal(applyFilters(universe, { search: 'zzz' }).length, 0);
});

test('sector filter keeps only chosen sectors', () => {
  const kept = applyFilters(universe, { sectors: ['Telecom', 'Real estate'] });
  assert.deepEqual(kept.map((x) => x.symbol).sort(), ['MIDD', 'THIN']);
});

test('maxPe excludes known-expensive names but not missing P/E', () => {
  const withMissing = [...universe, m({ symbol: 'NOPE', avgDailyValue: egp(9_000_000) })];
  const kept = applyFilters(withMissing, { maxPe: 15 });
  // THIN (P/E 25) excluded; NOPE (no P/E) kept.
  assert.ok(kept.some((x) => x.symbol === 'NOPE'));
  assert.ok(!kept.some((x) => x.symbol === 'THIN'));
});

test('minDividendYield treats a missing yield as zero', () => {
  const kept = applyFilters(universe, { minDividendYield: 0.04 });
  assert.deepEqual(kept.map((x) => x.symbol), ['BIGL']);
});

// ------------------------------------------------------------------ scoring

test('the strong, liquid, cheap name ranks first under default weights', () => {
  const results = runScreen(universe);
  assert.equal(results[0]!.metrics.symbol, 'BIGL');
  assert.equal(results[results.length - 1]!.metrics.symbol, 'THIN');
});

test('score is 0–100 and factors are 0–1', () => {
  for (const r of runScreen(universe)) {
    assert.ok(r.score >= 0 && r.score <= 100, `score ${r.score}`);
    for (const f of Object.values(r.factors)) {
      assert.ok(f >= 0 && f <= 1, `factor ${f}`);
    }
  }
});

test('weights change the ranking', () => {
  // Weight momentum only: the highest yearChange must lead.
  const momentumOnly: ScreenWeights = { liquidity: 0, value: 0, income: 0, momentum: 1, size: 0 };
  const results = runScreen(universe, { weights: momentumOnly });
  assert.equal(results[0]!.metrics.symbol, 'BIGL'); // +40% is the top mover here
});

test('a value-only screen prefers the lowest multiples', () => {
  const valueOnly: ScreenWeights = { liquidity: 0, value: 1, income: 0, momentum: 0, size: 0 };
  const results = runScreen(universe, { weights: valueOnly });
  assert.equal(results[0]!.metrics.symbol, 'BIGL'); // P/E 8, P/B 1.2 — cheapest
});

test('zero total weight yields a zero score rather than NaN', () => {
  const zero: ScreenWeights = { liquidity: 0, value: 0, income: 0, momentum: 0, size: 0 };
  const results = runScreen(universe, { weights: zero });
  assert.ok(results.every((r) => r.score === 0));
});

test('a missing factor scores a neutral 0.5, not a penalising 0', () => {
  const bare = [
    m({ symbol: 'AAAA', avgDailyValue: egp(10_000_000) }),
    m({ symbol: 'BBBB', avgDailyValue: egp(10_000_000) }),
  ];
  // No P/E or P/B anywhere -> value factor is neutral for both.
  const results = runScreen(bare, { weights: { liquidity: 0, value: 1, income: 0, momentum: 0, size: 0 } });
  assert.ok(results.every((r) => r.factors.value === 0.5));
  assert.ok(results.every((r) => r.score === 50));
});

test('dividend-vs-hurdle exposes that dividends rarely beat cash', () => {
  const [best] = runScreen(universe, { benchmarkRate: 0.22 });
  // BIGL yields 5%, hurdle 22% -> -17%.
  assert.ok(Math.abs(best!.incomeVsHurdle - (0.05 - 0.22)) < 1e-9);
  assert.ok(best!.incomeVsHurdle < 0);
});

// ------------------------------------------------------- sector concentration

test('equitySectorWeights ignores the money-market core', () => {
  const holding = (symbol: string, assetClass: Instrument['assetClass'], sector: string, value: number): Holding => ({
    symbol, instrument: { symbol, name: symbol, assetClass, sector },
    quantity: 1, costBasis: egp(value), averageCost: price(value), marketValue: egp(value),
    unrealisedPnl: egp(0), unrealisedPnlPct: 0, realisedPnl: egp(0), dividends: egp(0),
    totalCosts: egp(0), weight: 0,
  });

  const weights = equitySectorWeights([
    holding('MMF', 'money_market', 'Fixed income', 21_000),
    holding('COMI', 'equity', 'Banking', 6_000),
    holding('ETEL', 'equity', 'Telecom', 2_000),
  ]);
  // Equity book is 8,000: Banking 75%, Telecom 25%. MMF excluded.
  assert.ok(Math.abs(weights.get('Banking')! - 0.75) < 1e-9);
  assert.ok(Math.abs(weights.get('Telecom')! - 0.25) < 1e-9);
  assert.equal(weights.has('Fixed income'), false);
});

test('results carry the current sector weight for the concentration flag', () => {
  const sectorWeights = new Map([['Banking', 0.6]]);
  const [top] = runScreen(universe, { sectorWeights });
  assert.equal(top!.metrics.sector, 'Banking');
  assert.equal(top!.sectorWeight, 0.6);
});

test('sectorsIn lists distinct sectors sorted', () => {
  assert.deepEqual(sectorsIn(universe), ['Banking', 'Real estate', 'Telecom']);
});

test('totalWeight and defaults', () => {
  assert.equal(totalWeight(DEFAULT_WEIGHTS), 9);
});

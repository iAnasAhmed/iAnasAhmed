import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egp } from './money.ts';
import type { Transaction } from './types.ts';
import {
  xirr, npv, simpleReturn, annualise, realReturn, growAt,
  compareToBenchmark, maxDrawdown, portfolioCashFlows, daysSince,
  MONEY_MARKET_BENCHMARK,
} from './performance.ts';

const near = (actual: number, expected: number, tolerance = 1e-4): void => {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ~${expected}, got ${actual}`,
  );
};

// ----------------------------------------------------------------- XIRR

test('xirr recovers a known 10% annual return', () => {
  const r = xirr([
    { date: '2025-01-01', amount: egp(-1_000) },
    { date: '2026-01-01', amount: egp(1_100) },
  ]);
  near(r!, 0.1, 1e-3);
});

test('xirr recovers a known 22% annual return — the benchmark rate', () => {
  const r = xirr([
    { date: '2025-01-01', amount: egp(-10_000) },
    { date: '2026-01-01', amount: egp(12_200) },
  ]);
  near(r!, 0.22, 1e-3);
});

test('xirr annualises a sub-year holding period', () => {
  // +10% in roughly half a year annualises to about +21%
  const r = xirr([
    { date: '2026-01-01', amount: egp(-1_000) },
    { date: '2026-07-02', amount: egp(1_100) },
  ]);
  assert.ok(r! > 0.20 && r! < 0.22, `got ${r}`);
});

test('xirr handles losses', () => {
  const r = xirr([
    { date: '2025-01-01', amount: egp(-1_000) },
    { date: '2026-01-01', amount: egp(800) },
  ]);
  near(r!, -0.2, 1e-3);
});

test('xirr accounts for the timing of later deposits', () => {
  // Money added late had less time to work; XIRR must exceed the naive figure.
  const r = xirr([
    { date: '2026-01-01', amount: egp(-1_000) },
    { date: '2026-11-01', amount: egp(-1_000) },
    { date: '2026-12-31', amount: egp(2_200) },
  ]);
  const naive = 200 / 2000; // 10%
  assert.ok(r! > naive, `XIRR ${r} should exceed the naive ${naive}`);
});

test('xirr returns undefined when no rate exists', () => {
  assert.equal(xirr([{ date: '2026-01-01', amount: egp(-100) }]), undefined);
  assert.equal(
    xirr([
      { date: '2026-01-01', amount: egp(-100) },
      { date: '2026-06-01', amount: egp(-100) },
    ]),
    undefined,
  );
  assert.equal(xirr([]), undefined);
});

test('npv is zero at the internal rate of return', () => {
  const flows = [
    { date: '2025-01-01', amount: egp(-1_000) },
    { date: '2026-01-01', amount: egp(1_100) },
  ];
  near(npv(flows, xirr(flows)!), 0, 1e-4);
});

// ------------------------------------------------------- returns & inflation

test('simpleReturn guards a zero base', () => {
  assert.equal(simpleReturn(egp(500), egp(5_000)), 0.1);
  assert.equal(simpleReturn(egp(500), egp(0)), 0);
});

test('annualise scales a partial period', () => {
  near(annualise(0.1, 365), 0.1);
  near(annualise(0.1, 182.5), 0.21, 1e-2);
  assert.equal(annualise(0.1, 0), 0);
});

test('realReturn uses the exact Fisher relation, not subtraction', () => {
  // 20% nominal at 16% inflation is 3.45% real, NOT 4%.
  near(realReturn(0.20, 0.16), 0.034483, 1e-5);
  assert.notEqual(realReturn(0.20, 0.16), 0.04);
});

test('inflation can turn a nominal gain into a real loss', () => {
  // The trap this dashboard exists to expose.
  assert.ok(realReturn(0.12, 0.16) < 0);
});

test('growAt compounds correctly', () => {
  assert.equal(growAt(egp(10_000), 0.22, 365), egp(12_200));
  assert.equal(growAt(egp(10_000), 0.22, 0), egp(10_000));
});

// -------------------------------------------------------------- benchmarking

test('beating the benchmark is reported as a win', () => {
  const r = compareToBenchmark({
    annualisedReturn: 0.30,
    netContributions: egp(30_000),
    currentValue: egp(39_000),
    days: 365,
  });
  assert.equal(r.beatBenchmark, true);
  near(r.excess, 0.08);
  assert.equal(r.benchmarkValue, egp(36_600)); // 30,000 at 22%
  assert.equal(r.valueDifference, egp(2_400));
});

test('a positive nominal return that lags the benchmark is reported as a loss', () => {
  // The core insight: +18% looks good and is still a mistake in Egypt.
  const r = compareToBenchmark({
    annualisedReturn: 0.18,
    netContributions: egp(30_000),
    currentValue: egp(35_400),
    days: 365,
  });
  assert.equal(r.beatBenchmark, false);
  near(r.excess, -0.04);
  assert.ok(r.valueDifference < 0, 'should be behind the money-market fund');
  // and it barely beats inflation
  assert.ok(r.realReturn < 0.02);
});

test('the default benchmark matches the verified money-market rate', () => {
  assert.equal(MONEY_MARKET_BENCHMARK, 0.22);
  const r = compareToBenchmark({
    annualisedReturn: 0.22,
    netContributions: egp(1_000),
    currentValue: egp(1_220),
    days: 365,
  });
  assert.equal(r.beatBenchmark, false); // must strictly beat it
  near(r.excess, 0);
});

// ----------------------------------------------------------------- drawdown

test('maxDrawdown finds the worst peak-to-trough fall', () => {
  const r = maxDrawdown([
    { date: '2026-01-01', value: egp(10_000) },
    { date: '2026-02-01', value: egp(12_000) }, // peak
    { date: '2026-03-01', value: egp(9_000) },  // trough: -25%
    { date: '2026-04-01', value: egp(11_000) },
  ]);
  near(r.maxDrawdown, 0.25);
  assert.equal(r.peakDate, '2026-02-01');
  assert.equal(r.troughDate, '2026-03-01');
});

test('a monotonically rising series has no drawdown', () => {
  const r = maxDrawdown([
    { date: '2026-01-01', value: egp(10_000) },
    { date: '2026-02-01', value: egp(11_000) },
  ]);
  assert.equal(r.maxDrawdown, 0);
  assert.equal(r.peakDate, undefined);
});

test('maxDrawdown handles an empty series', () => {
  assert.equal(maxDrawdown([]).maxDrawdown, 0);
});

// ------------------------------------------------------------- cash flows

test('portfolioCashFlows uses external flows only', () => {
  const txs: Transaction[] = [
    { id: '1', date: '2026-01-01', kind: 'deposit', amount: egp(10_000) },
    { id: '2', date: '2026-01-02', kind: 'buy', symbol: 'COMI', quantity: 100, price: 80_000 as never },
    { id: '3', date: '2026-06-01', kind: 'withdrawal', amount: egp(2_000) },
  ];
  const flows = portfolioCashFlows(txs, egp(9_000), '2026-09-02');

  assert.equal(flows.length, 3); // deposit, withdrawal, current value — no trade
  assert.equal(flows[0]!.amount, egp(-10_000)); // money in is negative
  assert.equal(flows[1]!.amount, egp(2_000));
  assert.equal(flows[2]!.amount, egp(9_000));
});

test('portfolioCashFlows is empty when there are no external flows', () => {
  assert.deepEqual(portfolioCashFlows([], egp(1_000), '2026-09-02'), []);
});

test('an end-to-end portfolio XIRR is sane', () => {
  const txs: Transaction[] = [
    { id: '1', date: '2026-01-01', kind: 'deposit', amount: egp(30_000) },
  ];
  const flows = portfolioCashFlows(txs, egp(34_000), '2027-01-01');
  near(xirr(flows)!, 0.1333, 1e-3);
});

test('daysSince counts whole days and never goes negative', () => {
  assert.equal(daysSince('2026-01-01', '2026-01-31'), 30);
  assert.equal(daysSince('2026-02-01', '2026-01-01'), 0);
});

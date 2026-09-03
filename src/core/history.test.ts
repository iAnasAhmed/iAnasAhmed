import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egp } from './money.ts';
import type { Transaction } from './types.ts';
import { recordSnapshot, benchmarkSeries, alignedDates, trimHistory, today } from './history.ts';

test('recordSnapshot appends and keeps the series sorted', () => {
  let history = recordSnapshot([], egp(1_000), '2026-01-02');
  history = recordSnapshot(history, egp(1_100), '2026-01-01');
  assert.deepEqual(history.map((s) => s.date), ['2026-01-01', '2026-01-02']);
});

test('recordSnapshot replaces the same day rather than duplicating it', () => {
  let history = recordSnapshot([], egp(1_000), '2026-01-01');
  history = recordSnapshot(history, egp(1_500), '2026-01-01');
  assert.equal(history.length, 1);
  assert.equal(history[0]!.value, egp(1_500));
});

test('benchmarkSeries compounds a deposit at the annual rate', () => {
  const txs: Transaction[] = [
    { id: '1', date: '2026-01-01', kind: 'deposit', amount: egp(10_000) },
  ];
  const [start, year] = benchmarkSeries(txs, 0.22, ['2026-01-01', '2027-01-01']);
  assert.equal(start!.value, egp(10_000));
  assert.equal(year!.value, egp(12_200)); // exactly +22%
});

test('benchmarkSeries ignores contributions made after the evaluation date', () => {
  const txs: Transaction[] = [
    { id: '1', date: '2026-01-01', kind: 'deposit', amount: egp(10_000) },
    { id: '2', date: '2026-07-01', kind: 'deposit', amount: egp(5_000) },
  ];
  const [january] = benchmarkSeries(txs, 0.22, ['2026-01-01']);
  assert.equal(january!.value, egp(10_000)); // the July deposit does not exist yet
});

test('benchmarkSeries subtracts withdrawals', () => {
  const txs: Transaction[] = [
    { id: '1', date: '2026-01-01', kind: 'deposit', amount: egp(10_000) },
    { id: '2', date: '2026-01-01', kind: 'withdrawal', amount: egp(4_000) },
  ];
  const [point] = benchmarkSeries(txs, 0.22, ['2027-01-01']);
  assert.equal(point!.value, egp(7_320)); // 6,000 grown 22%
});

test('benchmarkSeries ignores trades — they are internal, not contributions', () => {
  const txs: Transaction[] = [
    { id: '1', date: '2026-01-01', kind: 'deposit', amount: egp(10_000) },
    { id: '2', date: '2026-02-01', kind: 'buy', symbol: 'COMI', quantity: 10, price: 80_000 as never },
  ];
  const [point] = benchmarkSeries(txs, 0.22, ['2027-01-01']);
  assert.equal(point!.value, egp(12_200));
});

test('benchmarkSeries with no contributions is flat zero', () => {
  assert.equal(benchmarkSeries([], 0.22, ['2026-01-01'])[0]!.value, 0);
});

test('alignedDates merges and de-duplicates', () => {
  const snapshots = [
    { date: '2026-01-02', value: egp(1) },
    { date: '2026-01-01', value: egp(1) },
  ];
  assert.deepEqual(alignedDates(snapshots, ['2026-01-02', '2026-01-03']),
    ['2026-01-01', '2026-01-02', '2026-01-03']);
});

test('trimHistory drops points beyond the window', () => {
  const history = [
    { date: '2024-01-01', value: egp(1) },
    { date: '2026-08-01', value: egp(2) },
  ];
  const kept = trimHistory(history, 730, '2026-09-02');
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.date, '2026-08-01');
});

test('today formats as an ISO date', () => {
  assert.equal(today(new Date('2026-09-02T23:30:00Z')), '2026-09-02');
});

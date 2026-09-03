/**
 * Value history.
 *
 * Historical EGX prices are not freely available (docs/research/04-data-providers.md),
 * so the portfolio's past value cannot be reconstructed after the fact without
 * inventing numbers. Instead the app records a **snapshot** of total value each
 * day it is opened, and charts those real observations.
 *
 * The benchmark curve, by contrast, *can* be computed exactly: it is the
 * owner's own deposits and withdrawals compounded at the money-market rate.
 * Comparing a real snapshot series against an exact benchmark is honest;
 * back-filling fake prices would not be.
 */

import { type Money, ZERO } from './money.ts';
import type { IsoDate, Transaction } from './types.ts';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

export interface Snapshot {
  readonly date: IsoDate;
  readonly value: Money;
}

export function today(at: Date = new Date()): IsoDate {
  return at.toISOString().slice(0, 10);
}

function dayDiff(from: IsoDate, to: IsoDate): number {
  return (Date.parse(to) - Date.parse(from)) / MS_PER_DAY;
}

/** Add or replace today's snapshot, keeping one entry per day, sorted. */
export function recordSnapshot(
  history: readonly Snapshot[],
  value: Money,
  date: IsoDate = today(),
): Snapshot[] {
  const kept = history.filter((snapshot) => snapshot.date !== date);
  return [...kept, { date, value }].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The benchmark curve: every contribution compounded at `annualRate` from the
 * day it was made, evaluated on each date in `dates`.
 *
 * This is what the same money would be worth in an EGP money-market fund — the
 * line the portfolio has to stay above to justify the effort of picking stocks.
 */
export function benchmarkSeries(
  transactions: readonly Transaction[],
  annualRate: number,
  dates: readonly IsoDate[],
): Snapshot[] {
  const flows = transactions
    .filter((tx) => tx.kind === 'deposit' || tx.kind === 'withdrawal')
    .map((tx) => ({
      date: tx.date,
      amount: (tx.kind === 'deposit' ? (tx.amount ?? ZERO) : -(tx.amount ?? ZERO)) as Money,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return dates.map((date) => {
    let total = 0;
    for (const flow of flows) {
      const days = dayDiff(flow.date, date);
      if (days < 0) continue; // not yet contributed on this date
      total += flow.amount * (1 + annualRate) ** (days / DAYS_PER_YEAR);
    }
    return { date, value: Math.round(total) as Money };
  });
}

/**
 * Merge snapshot dates with a set of extra dates, so both series in the chart
 * are evaluated on exactly the same x-axis.
 */
export function alignedDates(
  snapshots: readonly Snapshot[],
  extra: readonly IsoDate[] = [],
): IsoDate[] {
  return [...new Set([...snapshots.map((s) => s.date), ...extra])].sort();
}

/** Drop snapshots older than `days` so the chart stays readable over years. */
export function trimHistory(
  history: readonly Snapshot[],
  days = 730,
  from: IsoDate = today(),
): Snapshot[] {
  return history.filter((snapshot) => dayDiff(snapshot.date, from) <= days);
}

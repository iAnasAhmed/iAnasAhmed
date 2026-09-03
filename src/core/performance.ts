/**
 * Return measurement.
 *
 * The purpose of this module is to answer one question honestly:
 * **is the owner's stock picking beating the risk-free alternative?**
 *
 * In Egypt that alternative pays ~20–25% (docs/research/03-macro-context.md),
 * so a naive "+18% this year!" headline can still be a loss against doing
 * nothing. Every function here exists to prevent that self-deception.
 */

import { type Money, ZERO, toEgp } from './money.ts';
import type { IsoDate, Transaction } from './types.ts';

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365;

/** A dated cash flow. Negative = money in (invested), positive = money out. */
export interface CashFlow {
  readonly date: IsoDate;
  readonly amount: Money;
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return (Date.parse(to) - Date.parse(from)) / MS_PER_DAY;
}

/** Net present value of dated flows at annual rate `rate`. */
export function npv(flows: readonly CashFlow[], rate: number): number {
  const first = flows[0];
  if (!first) return 0;

  let total = 0;
  for (const flow of flows) {
    const years = daysBetween(first.date, flow.date) / DAYS_PER_YEAR;
    total += toEgp(flow.amount) / (1 + rate) ** years;
  }
  return total;
}

/**
 * Extended internal rate of return — the annualised return that accounts for
 * the *timing* of deposits.
 *
 * This is the number that matters for someone adding money over time: a simple
 * percentage gain flatters a portfolio that received most of its capital late.
 *
 * Newton–Raphson with a bisection fallback, because Newton alone diverges on
 * the irregular flows a real portfolio produces. Returns `undefined` when no
 * rate exists (e.g. all flows the same sign) rather than a misleading number.
 */
export function xirr(flows: readonly CashFlow[], guess = 0.2): number | undefined {
  if (flows.length < 2) return undefined;

  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));

  // A sign change is necessary for a root to exist.
  const hasPositive = sorted.some((f) => f.amount > 0);
  const hasNegative = sorted.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return undefined;

  // --- Newton–Raphson
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const value = npv(sorted, rate);
    if (Math.abs(value) < 1e-7) return rate;

    const epsilon = 1e-6;
    const derivative = (npv(sorted, rate + epsilon) - value) / epsilon;
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;

    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }

  // --- Bisection fallback over a wide but bounded range
  let low = -0.9999;
  let high = 100;
  let lowValue = npv(sorted, low);
  if (!Number.isFinite(lowValue)) return undefined;
  if (Math.sign(lowValue) === Math.sign(npv(sorted, high))) return undefined;

  for (let i = 0; i < 300; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(sorted, mid);
    if (Math.abs(midValue) < 1e-9) return mid;
    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

/**
 * Build the cash-flow series for an XIRR calculation.
 *
 * External flows only — deposits and withdrawals. Trades move money *within*
 * the portfolio and must not appear, or the return would be double-counted.
 * The current total value is appended as a final positive flow.
 */
export function portfolioCashFlows(
  transactions: readonly Transaction[],
  currentValue: Money,
  asOf: IsoDate,
): CashFlow[] {
  const flows: CashFlow[] = [];

  for (const tx of transactions) {
    if (tx.kind === 'deposit' && tx.amount) {
      flows.push({ date: tx.date, amount: -tx.amount as Money });
    } else if (tx.kind === 'withdrawal' && tx.amount) {
      flows.push({ date: tx.date, amount: tx.amount });
    }
  }

  if (flows.length > 0) flows.push({ date: asOf, amount: currentValue });
  return flows;
}

/** Simple return: gain over money put in. Ignores timing — use XIRR for that. */
export function simpleReturn(pnl: Money, netContributions: Money): number {
  if (netContributions === 0) return 0;
  return pnl / netContributions;
}

/**
 * Annualise a total return over a period.
 * A 10% gain in 6 months annualises to ~21%.
 */
export function annualise(totalReturn: number, days: number): number {
  if (days <= 0) return 0;
  return (1 + totalReturn) ** (DAYS_PER_YEAR / days) - 1;
}

/**
 * Inflation-adjusted (real) return, by the exact Fisher relation.
 *
 * `(1 + nominal) / (1 + inflation) - 1`, not the `nominal - inflation`
 * approximation, which is materially wrong at Egyptian inflation levels:
 * at 20% nominal and 16% inflation the true real return is 3.45%, not 4%.
 */
export function realReturn(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1;
}

/** Growth of an amount at an annual rate over a number of days. */
export function growAt(principal: Money, annualRate: number, days: number): Money {
  const years = days / DAYS_PER_YEAR;
  return Math.round(principal * (1 + annualRate) ** years) as Money;
}

// ---------------------------------------------------------------- benchmarking

/**
 * Default benchmark: an EGP money-market fund.
 *
 * 22% is the midpoint of the ~20–25% range verified 2026-09-02
 * (docs/research/03-macro-context.md). Configurable — update it as the CBE
 * moves rates.
 */
export const MONEY_MARKET_BENCHMARK = 0.22;

/** Assumed annual inflation, for real-return reporting. ~16–17% (CBE, 2026). */
export const INFLATION_ASSUMPTION = 0.16;

export interface BenchmarkResult {
  /** The portfolio's actual annualised return. */
  readonly actual: number;
  /** What the risk-free alternative would have returned. */
  readonly benchmark: number;
  /** actual - benchmark. Negative means the effort destroyed value. */
  readonly excess: number;
  /** The portfolio's return after inflation. */
  readonly realReturn: number;
  /** What the same money would be worth in the benchmark today. */
  readonly benchmarkValue: Money;
  /** Actual value minus benchmark value, in EGP. */
  readonly valueDifference: Money;
  /** The verdict the dashboard shows. */
  readonly beatBenchmark: boolean;
}

/**
 * Compare a portfolio against the risk-free alternative.
 *
 * Deliberately unflattering. This is the single most valuable number the
 * dashboard produces (docs/allocation-framework.md, Step 5).
 */
export function compareToBenchmark(params: {
  readonly annualisedReturn: number;
  readonly netContributions: Money;
  readonly currentValue: Money;
  readonly days: number;
  readonly benchmarkRate?: number;
  readonly inflation?: number;
}): BenchmarkResult {
  const benchmark = params.benchmarkRate ?? MONEY_MARKET_BENCHMARK;
  const inflation = params.inflation ?? INFLATION_ASSUMPTION;

  const benchmarkValue = growAt(params.netContributions, benchmark, params.days);

  return {
    actual: params.annualisedReturn,
    benchmark,
    excess: params.annualisedReturn - benchmark,
    realReturn: realReturn(params.annualisedReturn, inflation),
    benchmarkValue,
    valueDifference: (params.currentValue - benchmarkValue) as Money,
    beatBenchmark: params.annualisedReturn > benchmark,
  };
}

// ------------------------------------------------------------------- drawdown

export interface DrawdownPoint {
  readonly date: IsoDate;
  readonly value: Money;
}

export interface DrawdownResult {
  /** Largest peak-to-trough fall, as a positive ratio. 0.2 = a 20% fall. */
  readonly maxDrawdown: number;
  readonly peakDate?: IsoDate;
  readonly troughDate?: IsoDate;
}

/**
 * Maximum drawdown — the worst peak-to-trough decline.
 *
 * Reported because it is the number that predicts behaviour: people abandon
 * strategies during drawdowns, not during bad average returns.
 */
export function maxDrawdown(series: readonly DrawdownPoint[]): DrawdownResult {
  let peak = -Infinity;
  let peakDate: IsoDate | undefined;
  let worst = 0;
  let worstPeakDate: IsoDate | undefined;
  let worstTroughDate: IsoDate | undefined;

  for (const point of series) {
    if (point.value > peak) {
      peak = point.value;
      peakDate = point.date;
    }
    if (peak > 0) {
      const drawdown = (peak - point.value) / peak;
      if (drawdown > worst) {
        worst = drawdown;
        worstPeakDate = peakDate;
        worstTroughDate = point.date;
      }
    }
  }

  const result: DrawdownResult = { maxDrawdown: worst };
  if (worstPeakDate === undefined || worstTroughDate === undefined) return result;
  return { ...result, peakDate: worstPeakDate, troughDate: worstTroughDate };
}

/** Whole days between two ISO dates. */
export function daysSince(from: IsoDate, to: IsoDate): number {
  return Math.max(0, Math.round(daysBetween(from, to)));
}

export { ZERO };

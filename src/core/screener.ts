/**
 * Stock screener — a transparent, user-driven lens over the EGX universe.
 *
 * This is NOT a recommendation engine (CLAUDE.md §1.6). It filters and ranks
 * instruments against criteria and weights *the owner sets*, and it exposes
 * every sub-score so a ranking is never a black box. The score answers "how
 * well does this match the filters I chose?", not "should I buy this?".
 *
 * It is pure: no DOM, no fetch. It takes metrics in and returns rankings out.
 * Where those metrics come from — a live provider, a demo set, or manual entry
 * — is the data layer's problem, not this module's.
 */

import { type Money, egp, toEgp, ratio } from './money.ts';
import type { Price } from './money.ts';
import type { Holding } from './types.ts';

/** One row of screenable data for an instrument. Any field may be missing. */
export interface ScreenMetrics {
  readonly symbol: string;
  readonly name: string;
  readonly sector: string;
  readonly price?: Price;
  /** Market capitalisation, EGP. Proxy for size / stability. */
  readonly marketCap?: Money;
  /** Average daily traded value, EGP. The liquidity measure that matters. */
  readonly avgDailyValue?: Money;
  readonly peRatio?: number;
  readonly pbRatio?: number;
  /** Trailing dividend yield as a ratio: 0.04 = 4%. */
  readonly dividendYield?: number;
  /** 52-week price change as a ratio: 0.30 = +30%. */
  readonly yearChange?: number;
}

export type ScreenFactor = 'liquidity' | 'value' | 'income' | 'momentum' | 'size';

/** Relative importance of each factor. Any scale; only the ratios matter. */
export interface ScreenWeights {
  readonly liquidity: number;
  readonly value: number;
  readonly income: number;
  readonly momentum: number;
  readonly size: number;
}

/**
 * Default weights lean on **liquidity** — the project's own first rule for a
 * beginner (docs/allocation-framework.md, Step 4): a thin stock's spread costs
 * more than every fee combined. The owner can re-weight freely.
 */
export const DEFAULT_WEIGHTS: ScreenWeights = {
  liquidity: 3,
  value: 2,
  size: 2,
  income: 1,
  momentum: 1,
};

export interface ScreenFilters {
  /** Matches symbol or name, case-insensitive. */
  readonly search?: string;
  /** Keep only these sectors. Empty/undefined = all sectors. */
  readonly sectors?: readonly string[];
  /** Exclude anything below this average daily traded value. */
  readonly minLiquidity?: Money;
  /** Exclude anything with a P/E above this (missing P/E is not excluded). */
  readonly maxPe?: number;
  /** Exclude anything yielding less than this (as a ratio). */
  readonly minDividendYield?: number;
}

export interface FactorScores {
  readonly liquidity: number;
  readonly value: number;
  readonly income: number;
  readonly momentum: number;
  readonly size: number;
}

export type LiquidityTier = 'thin' | 'moderate' | 'liquid';

export interface ScreenResult {
  readonly metrics: ScreenMetrics;
  /** Per-factor percentile within the filtered set, 0–1. */
  readonly factors: FactorScores;
  /** Weighted composite, 0–100. */
  readonly score: number;
  readonly liquidityTier: LiquidityTier;
  /**
   * Dividend yield minus the money-market benchmark. Almost always negative —
   * the point being that dividends alone do not clear the ~22% hurdle.
   */
  readonly incomeVsHurdle: number;
  /** The owner's current equity weight in this stock's sector, 0–1. */
  readonly sectorWeight: number;
}

/**
 * Liquidity tier thresholds, in EGP of average daily traded value.
 *
 * ⚠️ HEURISTIC, not an official classification. Tune to taste. Unknown
 * liquidity is treated as `thin` deliberately — never assume a stock is easy
 * to exit.
 */
export const LIQUIDITY_THIN_MAX = egp(2_000_000);
export const LIQUIDITY_LIQUID_MIN = egp(15_000_000);

export function liquidityTier(avgDailyValue: Money | undefined): LiquidityTier {
  if (avgDailyValue === undefined || avgDailyValue < LIQUIDITY_THIN_MAX) return 'thin';
  if (avgDailyValue >= LIQUIDITY_LIQUID_MIN) return 'liquid';
  return 'moderate';
}

// --------------------------------------------------------------- percentile

/**
 * Percentile rank of each item on a metric, aligned with the input order.
 *
 * A missing value scores a neutral 0.5 rather than 0, so one absent P/E does
 * not unfairly sink an otherwise strong stock. When `higherIsBetter` is false
 * (valuation multiples), the rank is inverted so cheaper ranks higher.
 */
function rankScores<T>(
  items: readonly T[],
  accessor: (item: T) => number | undefined,
  higherIsBetter: boolean,
): number[] {
  const values = items.map(accessor);
  const defined = values.filter((v): v is number => v !== undefined);
  const n = defined.length;

  return values.map((value) => {
    if (value === undefined || n === 0) return 0.5;
    const below = defined.filter((v) => v < value).length;
    const equal = defined.filter((v) => v === value).length;
    const pr = (below + 0.5 * equal) / n;
    return higherIsBetter ? pr : 1 - pr;
  });
}

/** Mean of the defined values; undefined when none are defined. */
function meanDefined(values: readonly (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return undefined;
  return defined.reduce((sum, v) => sum + v, 0) / defined.length;
}

// ----------------------------------------------------------------- filtering

export function applyFilters(
  metrics: readonly ScreenMetrics[],
  filters: ScreenFilters,
): ScreenMetrics[] {
  const query = filters.search?.trim().toUpperCase();
  const sectorSet =
    filters.sectors && filters.sectors.length > 0
      ? new Set(filters.sectors)
      : undefined;

  return metrics.filter((m) => {
    if (query && !m.symbol.toUpperCase().includes(query) && !m.name.toUpperCase().includes(query)) {
      return false;
    }
    if (sectorSet && !sectorSet.has(m.sector)) return false;
    if (filters.minLiquidity !== undefined && (m.avgDailyValue ?? 0) < filters.minLiquidity) {
      return false;
    }
    // A missing multiple is not grounds for exclusion — only a known, too-high one.
    if (filters.maxPe !== undefined && m.peRatio !== undefined && m.peRatio > filters.maxPe) {
      return false;
    }
    if (filters.minDividendYield !== undefined && (m.dividendYield ?? 0) < filters.minDividendYield) {
      return false;
    }
    return true;
  });
}

// ------------------------------------------------------------------ scoring

export function totalWeight(weights: ScreenWeights): number {
  return weights.liquidity + weights.value + weights.income + weights.momentum + weights.size;
}

/**
 * The owner's current equity weight per sector, from live holdings.
 *
 * Money-market and cash are excluded: this is about *equity* concentration, the
 * thing the screener warns against before you add to an already-heavy sector.
 */
export function equitySectorWeights(holdings: readonly Holding[]): Map<string, number> {
  const bySector = new Map<string, Money>();
  let equityTotal = 0 as Money;

  for (const h of holdings) {
    if (h.instrument.assetClass === 'money_market' || h.instrument.assetClass === 'cash') continue;
    const sector = h.instrument.sector ?? 'Unclassified';
    bySector.set(sector, ((bySector.get(sector) ?? 0) + h.marketValue) as Money);
    equityTotal = (equityTotal + h.marketValue) as Money;
  }

  const weights = new Map<string, number>();
  for (const [sector, value] of bySector) weights.set(sector, ratio(value, equityTotal));
  return weights;
}

export interface ScreenOptions {
  readonly filters?: ScreenFilters;
  readonly weights?: ScreenWeights;
  /** Money-market rate for the dividend-vs-hurdle column. */
  readonly benchmarkRate?: number;
  /** Current equity sector weights, from `equitySectorWeights`. */
  readonly sectorWeights?: ReadonlyMap<string, number>;
}

/**
 * Filter, score, and rank. The composite is a weighted blend of per-factor
 * percentiles computed *within the filtered set*, so a score always means
 * "relative to the other stocks that passed your filters".
 */
export function runScreen(
  metrics: readonly ScreenMetrics[],
  options: ScreenOptions = {},
): ScreenResult[] {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const benchmarkRate = options.benchmarkRate ?? 0.22;
  const sectorWeights = options.sectorWeights;
  const filtered = applyFilters(metrics, options.filters ?? {});

  // Per-factor percentile ranks over the filtered set.
  const liquidityRank = rankScores(filtered, (m) => m.avgDailyValue, true);
  const peRank = rankScores(filtered, (m) => m.peRatio, false);
  const pbRank = rankScores(filtered, (m) => m.pbRatio, false);
  const incomeRank = rankScores(filtered, (m) => m.dividendYield, true);
  const momentumRank = rankScores(filtered, (m) => m.yearChange, true);
  const sizeRank = rankScores(filtered, (m) => m.marketCap, true);

  const wTotal = totalWeight(weights);

  const results = filtered.map((metrics, i): ScreenResult => {
    // Value blends the two multiples; if a stock has neither, it is neutral.
    const value = meanDefined([
      metrics.peRatio !== undefined ? peRank[i] : undefined,
      metrics.pbRatio !== undefined ? pbRank[i] : undefined,
    ]) ?? 0.5;

    const factors: FactorScores = {
      liquidity: liquidityRank[i] ?? 0.5,
      value,
      income: incomeRank[i] ?? 0.5,
      momentum: momentumRank[i] ?? 0.5,
      size: sizeRank[i] ?? 0.5,
    };

    const weighted =
      weights.liquidity * factors.liquidity +
      weights.value * factors.value +
      weights.income * factors.income +
      weights.momentum * factors.momentum +
      weights.size * factors.size;

    const score = wTotal > 0 ? (weighted / wTotal) * 100 : 0;

    return {
      metrics,
      factors,
      score,
      liquidityTier: liquidityTier(metrics.avgDailyValue),
      incomeVsHurdle: (metrics.dividendYield ?? 0) - benchmarkRate,
      sectorWeight: sectorWeights?.get(metrics.sector) ?? 0,
    };
  });

  // Highest match first; symbol as a stable tie-break for deterministic order.
  return results.sort((a, b) =>
    b.score === a.score
      ? a.metrics.symbol.localeCompare(b.metrics.symbol)
      : b.score - a.score,
  );
}

/** The distinct sectors present in a metrics set, sorted, for filter UIs. */
export function sectorsIn(metrics: readonly ScreenMetrics[]): string[] {
  return [...new Set(metrics.map((m) => m.sector))].sort();
}

export { toEgp };

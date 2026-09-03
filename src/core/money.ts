/**
 * Integer money arithmetic.
 *
 * Floating point is banned for money in this project (CLAUDE.md §4). `0.1 + 0.2`
 * is not `0.3`, and a portfolio that drifts by fractions of a piastre per trade
 * is a portfolio you cannot reconcile against a broker statement.
 *
 * Two scales are used:
 *   Money — integer PIASTRES        (1 EGP = 100 piastres)
 *   Price — integer MILLI-EGP       (1 EGP = 1000 mills) because EGX quotes 3 dp
 *
 * Branded types make the two impossible to mix up by accident.
 */

declare const MoneyBrand: unique symbol;
declare const PriceBrand: unique symbol;

/** An amount of money, in integer piastres. 1 EGP = 100 piastres. */
export type Money = number & { readonly [MoneyBrand]: true };

/** A per-share price, in integer milli-EGP. 1 EGP = 1000 mills. */
export type Price = number & { readonly [PriceBrand]: true };

export const PIASTRES_PER_EGP = 100;
export const MILLS_PER_EGP = 1000;

/** Round half away from zero — symmetric, so gains and losses are treated alike. */
function roundHalfAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

function assertFinite(n: number, what: string): void {
  if (!Number.isFinite(n)) throw new RangeError(`${what} must be finite, got ${n}`);
}

// ---------------------------------------------------------------- constructors

/** Build Money from a decimal EGP figure. `egp(12.34)` -> 1234 piastres. */
export function egp(amount: number): Money {
  assertFinite(amount, 'EGP amount');
  return roundHalfAwayFromZero(amount * PIASTRES_PER_EGP) as Money;
}

/** Build Money directly from an integer piastre count. */
export function piastres(n: number): Money {
  assertFinite(n, 'piastres');
  if (!Number.isInteger(n)) throw new RangeError(`piastres must be an integer, got ${n}`);
  return n as Money;
}

/** Build a Price from a decimal EGP quote. `price(85.5)` -> 85500 mills. */
export function price(egpPerShare: number): Price {
  assertFinite(egpPerShare, 'price');
  if (egpPerShare < 0) throw new RangeError(`price must be >= 0, got ${egpPerShare}`);
  return roundHalfAwayFromZero(egpPerShare * MILLS_PER_EGP) as Price;
}

export const ZERO = 0 as Money;

// ------------------------------------------------------------------ arithmetic

export function add(...amounts: Money[]): Money {
  let total = 0;
  for (const a of amounts) total += a;
  return total as Money;
}

export function sub(a: Money, b: Money): Money {
  return (a - b) as Money;
}

export function neg(a: Money): Money {
  return -a as Money;
}

export function abs(a: Money): Money {
  return Math.abs(a) as Money;
}

/** Scale Money by a plain ratio (e.g. a percentage). Rounds to whole piastres. */
export function scale(a: Money, factor: number): Money {
  assertFinite(factor, 'factor');
  return roundHalfAwayFromZero(a * factor) as Money;
}

/**
 * Apply a rate expressed in basis points. 1 bp = 0.01%.
 * EGX stamp duty of 0.05% is 5 bps.
 */
export function applyBps(a: Money, bps: number): Money {
  assertFinite(bps, 'bps');
  return roundHalfAwayFromZero((a * bps) / 10_000) as Money;
}

/**
 * Market value of a share quantity at a price.
 *
 *   value(EGP) = qty * priceMills / 1000
 *   value(piastres) = qty * priceMills / 10
 *
 * Fractional shares are supported: EGX trades whole shares, but mutual fund
 * units are fractional, and this engine covers both.
 */
export function valueOf(quantity: number, p: Price): Money {
  assertFinite(quantity, 'quantity');
  return roundHalfAwayFromZero((quantity * p) / 10) as Money;
}

/** Ratio of two amounts as a plain number. Returns 0 when the base is 0. */
export function ratio(a: Money, b: Money): number {
  if (b === 0) return 0;
  return a / b;
}

// ------------------------------------------------------------------ formatting

/** Exact decimal EGP value. Safe for display and export; never for arithmetic. */
export function toEgp(a: Money): number {
  return a / PIASTRES_PER_EGP;
}

export function priceToEgp(p: Price): number {
  return p / MILLS_PER_EGP;
}

export interface FormatOptions {
  /** Show a leading + on positive amounts. Useful for P&L. */
  readonly signed?: boolean;
  /** Decimal places. Defaults to 2. */
  readonly decimals?: number;
  /** Append " EGP". Defaults to true. */
  readonly currency?: boolean;
  /** Abbreviate thousands/millions (12.3k, 1.2M). Defaults to false. */
  readonly compact?: boolean;
}

/** Human-readable EGP. Grouping uses en-US separators for consistent width. */
export function format(a: Money, options: FormatOptions = {}): string {
  const { signed = false, decimals = 2, currency = true, compact = false } = options;
  const value = toEgp(a);
  const sign = signed && a > 0 ? '+' : '';

  let body: string;
  if (compact && Math.abs(value) >= 1000) {
    const units: readonly [number, string][] = [
      [1_000_000_000, 'B'],
      [1_000_000, 'M'],
      [1_000, 'k'],
    ];
    const found = units.find(([threshold]) => Math.abs(value) >= threshold);
    // `find` on a non-empty list guarded by the >= 1000 check always hits.
    const [threshold, suffix] = found ?? [1, ''];
    body = (value / threshold).toFixed(1) + suffix;
  } else {
    body = value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  return `${sign}${body}${currency ? ' EGP' : ''}`;
}

/** Format a percentage from a plain ratio. `formatPct(0.1234)` -> "+12.34%". */
export function formatPct(r: number, decimals = 2): string {
  if (!Number.isFinite(r)) return '—';
  const sign = r > 0 ? '+' : '';
  return `${sign}${(r * 100).toFixed(decimals)}%`;
}

/**
 * Percentage without a sign, for shares of a whole (weights, allocations).
 * A portfolio weight of "+79%" is nonsense — weights have no direction.
 */
export function formatShare(r: number, decimals = 0): string {
  if (!Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(decimals)}%`;
}

export function formatPrice(p: Price, decimals = 3): string {
  return priceToEgp(p).toFixed(decimals);
}

/**
 * Curated EGX reference figures — for the OFFLINE DEMO ONLY.
 *
 * These are **approximate, point-in-time** values compiled from public sources
 * around September 2026, so the demo behaves like the real market instead of
 * showing obviously fake numbers. They are NOT a live feed and NOT verified to
 * the piastre — prices move every day and these will drift stale. Never trade
 * on them (CLAUDE.md §1.1, §1.6). For real figures, switch the data source to a
 * live provider with the local server running.
 *
 * Sources (accessed 2026-09): investing.com, stockanalysis.com, tradingview.com,
 * marketscreener.com, african-markets.com. Prices are the most recent quote
 * found per name; market caps and average daily traded values are rounded
 * order-of-magnitude estimates; a couple of prices (ESRS, CIEB) were not
 * directly quotable and are marked as estimates below.
 */

export interface EgxReference {
  readonly symbol: string;
  /** Approximate last price, EGP. */
  readonly price: number;
  /** Approximate market capitalisation, EGP. */
  readonly marketCap: number;
  /** Approximate average daily traded value, EGP/day. */
  readonly avgDailyValue: number;
  readonly peRatio: number;
  readonly pbRatio: number;
  /** Trailing dividend yield, as a ratio. */
  readonly dividendYield: number;
  /** Approximate 52-week price change, as a ratio. */
  readonly yearChange: number;
}

export const EGX_REFERENCE_AS_OF = '2026-09';

const B = 1_000_000_000;
const M = 1_000_000;

/**
 * Keyed by EGX ticker. Only equities appear here; the money-market fund (MMF)
 * is priced flat elsewhere and is not a screenable equity.
 *
 * P/E, P/B, dividend yield and 52-week change reflect each company's known
 * character (banks: low P/E, real dividends; fintech: high P/E, little yield;
 * fertiliser/tobacco: strong cash dividends) at realistic magnitudes.
 */
export const EGX_REFERENCE: Readonly<Record<string, EgxReference>> = {
  // Anchored to a real quote (~138 EGP, ~472B cap, ~4.3% yield, Sep 2026).
  COMI: { symbol: 'COMI', price: 138.11, marketCap: 472 * B, avgDailyValue: 600 * M, peRatio: 6.0, pbRatio: 1.6, dividendYield: 0.043, yearChange: 0.45 },
  // ~111 EGP, 52-week low 41.77 -> a very strong year.
  ETEL: { symbol: 'ETEL', price: 111.00, marketCap: 190 * B, avgDailyValue: 300 * M, peRatio: 5.5, pbRatio: 1.1, dividendYield: 0.060, yearChange: 1.50 },
  HRHO: { symbol: 'HRHO', price: 28.56, marketCap: 54 * B, avgDailyValue: 180 * M, peRatio: 7.0, pbRatio: 1.2, dividendYield: 0.020, yearChange: 0.50 },
  SWDY: { symbol: 'SWDY', price: 109.00, marketCap: 235 * B, avgDailyValue: 150 * M, peRatio: 9.0, pbRatio: 2.0, dividendYield: 0.025, yearChange: 0.60 },
  TMGH: { symbol: 'TMGH', price: 97.23, marketCap: 300 * B, avgDailyValue: 250 * M, peRatio: 11.0, pbRatio: 1.4, dividendYield: 0.015, yearChange: 0.40 },
  // Eastern Company — tobacco cash cow: low P/E, high dividend.
  EAST: { symbol: 'EAST', price: 40.30, marketCap: 90 * B, avgDailyValue: 50 * M, peRatio: 7.0, pbRatio: 3.0, dividendYield: 0.090, yearChange: 0.35 },
  ABUK: { symbol: 'ABUK', price: 69.70, marketCap: 88 * B, avgDailyValue: 40 * M, peRatio: 8.0, pbRatio: 3.5, dividendYield: 0.090, yearChange: 0.20 },
  // Fawry — fintech: high multiples, negligible dividend, near its ATH (~21.66).
  FWRY: { symbol: 'FWRY', price: 20.00, marketCap: 47 * B, avgDailyValue: 120 * M, peRatio: 35.0, pbRatio: 6.0, dividendYield: 0.005, yearChange: 0.30 },
  ORAS: { symbol: 'ORAS', price: 832.00, marketCap: 97 * B, avgDailyValue: 30 * M, peRatio: 10.0, pbRatio: 1.8, dividendYield: 0.040, yearChange: 0.55 },
  MFPC: { symbol: 'MFPC', price: 37.10, marketCap: 47 * B, avgDailyValue: 20 * M, peRatio: 7.0, pbRatio: 2.2, dividendYield: 0.100, yearChange: 0.25 },
  // ESRS price not directly quotable in Sep 2026 — estimate. Steel: cyclical, no dividend.
  ESRS: { symbol: 'ESRS', price: 40.00, marketCap: 55 * B, avgDailyValue: 35 * M, peRatio: 12.0, pbRatio: 1.0, dividendYield: 0.000, yearChange: 0.15 },
  // CIEB price not directly quotable — estimate. Bank: low P/E, high payout, thinner trade.
  CIEB: { symbol: 'CIEB', price: 55.00, marketCap: 30 * B, avgDailyValue: 3 * M, peRatio: 5.0, pbRatio: 1.2, dividendYield: 0.085, yearChange: 0.30 },
  JUFO: { symbol: 'JUFO', price: 29.45, marketCap: 28 * B, avgDailyValue: 15 * M, peRatio: 14.0, pbRatio: 2.5, dividendYield: 0.020, yearChange: 0.45 },
  // AMOC — ~8.3 EGP, ~11.1B cap; energy name that lagged the market.
  AMOC: { symbol: 'AMOC', price: 8.29, marketCap: 11.11 * B, avgDailyValue: 25 * M, peRatio: 9.0, pbRatio: 1.5, dividendYield: 0.060, yearChange: -0.05 },
  PHDC: { symbol: 'PHDC', price: 13.90, marketCap: 33 * B, avgDailyValue: 40 * M, peRatio: 6.0, pbRatio: 0.9, dividendYield: 0.008, yearChange: 0.30 },
};

/** Reference price for a symbol, or undefined if it isn't in the table. */
export function referencePrice(symbol: string): number | undefined {
  return EGX_REFERENCE[symbol.toUpperCase()]?.price;
}

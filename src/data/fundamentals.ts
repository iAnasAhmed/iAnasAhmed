/**
 * Fundamentals data — the inputs the screener ranks on.
 *
 * As with prices, there is no official free EGX fundamentals feed
 * (docs/research/04-data-providers.md), so this sits behind a provider
 * interface with an offline default. The offline set is **illustrative demo
 * data, not real figures** — the UI badges it as such, and nothing here should
 * ever be presented as verified fact (CLAUDE.md §1.1).
 */

import { egp, price } from '../core/money.ts';
import type { ScreenMetrics } from '../core/screener.ts';
import { EGX_INSTRUMENTS } from './symbols.ts';
import { EGX_REFERENCE } from './reference-egx.ts';
import type { MarketDataProvider } from './provider.ts';
import { fromProviderSymbol, toProviderSymbol } from './symbols.ts';
import { fetchYahooQuotes } from './yahoo-shared.ts';

export interface FundamentalsProvider {
  readonly id: string;
  readonly label: string;
  readonly offline: boolean;
  getFundamentals(symbols: readonly string[]): Promise<Map<string, ScreenMetrics>>;
}

// ---------------------------------------------------------------- mock/demo

/**
 * Offline fundamentals, sourced from the curated reference table
 * (reference-egx.ts): approximate real EGX figures for ~Sep 2026, not a live
 * feed and not verified to the piastre. The UI badges them as such. Do not
 * trade on them — switch to a live source for real numbers.
 */
export class MockFundamentalsProvider implements FundamentalsProvider {
  readonly id = 'mock';
  readonly label = 'Demo · approx. real figures (~Sep 2026)';
  readonly offline = true;

  async getFundamentals(symbols: readonly string[]): Promise<Map<string, ScreenMetrics>> {
    const out = new Map<string, ScreenMetrics>();

    for (const symbol of symbols) {
      const ref = EGX_REFERENCE[symbol.toUpperCase()];
      if (!ref) continue;
      const info = EGX_INSTRUMENTS.find((i) => i.symbol === ref.symbol);

      out.set(ref.symbol, {
        symbol: ref.symbol,
        name: info?.name ?? ref.symbol,
        sector: info?.sector ?? 'Unclassified',
        price: price(ref.price),
        marketCap: egp(ref.marketCap),
        avgDailyValue: egp(ref.avgDailyValue),
        peRatio: ref.peRatio,
        pbRatio: ref.pbRatio,
        dividendYield: ref.dividendYield,
        yearChange: ref.yearChange,
      });
    }

    return out;
  }
}

// --------------------------------------------------------------- yahoo (live)

/**
 * Best-effort live fundamentals from Yahoo's batched v7 `quote` endpoint,
 * shared with the price provider and routed through the local proxy that
 * handles Yahoo's crumb/cookie auth (scripts/yahoo.mjs).
 *
 * Yahoo's EGX coverage is uneven, so a name may come back with only some fields
 * — or not at all. That is expected: partial data still screens, and a missing
 * figure scores neutrally rather than sinking a stock.
 */
export class YahooFundamentalsProvider implements FundamentalsProvider {
  readonly id = 'yahoo';
  readonly label = 'Yahoo Finance (live)';
  readonly offline = false;

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: YahooFundamentalsOptions = {}) {
    this.endpoint = options.quotesEndpoint ?? '/api/quotes';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async getFundamentals(symbols: readonly string[]): Promise<Map<string, ScreenMetrics>> {
    const out = new Map<string, ScreenMetrics>();
    if (symbols.length === 0) return out;

    const vendor = symbols.map((s) => toProviderSymbol(s, 'yahoo'));
    const rows = await fetchYahooQuotes(vendor, {
      endpoint: this.endpoint,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });

    for (const row of rows) {
      const symbol = fromProviderSymbol(row.symbol);
      const info = EGX_INSTRUMENTS.find((i) => i.symbol === symbol);
      out.set(symbol, {
        symbol,
        name: info?.name ?? symbol,
        sector: info?.sector ?? 'Unclassified',
        ...(row.price !== undefined ? { price: price(row.price) } : {}),
        ...(row.marketCap !== undefined ? { marketCap: egp(row.marketCap) } : {}),
        ...(row.avgDailyValue !== undefined ? { avgDailyValue: egp(row.avgDailyValue) } : {}),
        ...(row.peRatio !== undefined ? { peRatio: row.peRatio } : {}),
        ...(row.pbRatio !== undefined ? { pbRatio: row.pbRatio } : {}),
        ...(row.dividendYield !== undefined ? { dividendYield: row.dividendYield } : {}),
        ...(row.yearChange !== undefined ? { yearChange: row.yearChange } : {}),
      });
    }

    return out;
  }
}

export interface YahooFundamentalsOptions {
  /** Batched quote endpoint (proxy). Default '/api/quotes'. */
  readonly quotesEndpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export type FundamentalsProviderId = 'mock' | 'yahoo';

export function createFundamentalsProvider(
  id: FundamentalsProviderId,
  options: YahooFundamentalsOptions = {},
): FundamentalsProvider {
  return id === 'yahoo' ? new YahooFundamentalsProvider(options) : new MockFundamentalsProvider();
}

// Keep the price-provider symbol type reachable for callers wiring both together.
export type { MarketDataProvider };

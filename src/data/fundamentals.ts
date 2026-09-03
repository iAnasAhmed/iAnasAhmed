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
import { type MarketDataProvider, ProviderError } from './provider.ts';
import { fromProviderSymbol, toProviderSymbol } from './symbols.ts';

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

interface YahooSummary {
  quoteSummary?: {
    result?: {
      price?: { regularMarketPrice?: { raw?: number }; marketCap?: { raw?: number }; symbol?: string };
      summaryDetail?: {
        trailingPE?: { raw?: number };
        priceToBook?: { raw?: number };
        dividendYield?: { raw?: number };
        averageDailyVolume10Day?: { raw?: number };
      };
      defaultKeyStatistics?: { priceToBook?: { raw?: number }; '52WeekChange'?: { raw?: number } };
    }[];
  };
}

export interface YahooFundamentalsOptions {
  /** Base path; in the browser this points at the local proxy (see serve.mjs). */
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const YAHOO_SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/';

/**
 * Best-effort live fundamentals from Yahoo's quoteSummary endpoint.
 *
 * Undocumented and unguaranteed, exactly like the price adapter: every failure
 * degrades to "this stock has no fundamentals" rather than throwing, so the
 * screener still renders. Cross-origin rules mean the browser must route this
 * through the local proxy.
 */
export class YahooFundamentalsProvider implements FundamentalsProvider {
  readonly id = 'yahoo';
  readonly label = 'Yahoo Finance (live)';
  readonly offline = false;

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: YahooFundamentalsOptions = {}) {
    this.endpoint = options.endpoint ?? YAHOO_SUMMARY;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async getFundamentals(symbols: readonly string[]): Promise<Map<string, ScreenMetrics>> {
    const out = new Map<string, ScreenMetrics>();
    if (symbols.length === 0) return out;

    const results = await Promise.allSettled(symbols.map((s) => this.fetchOne(s)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) out.set(r.value.symbol, r.value);
    }
    return out;
  }

  private async fetchOne(symbol: string): Promise<ScreenMetrics | undefined> {
    const vendor = toProviderSymbol(symbol, 'yahoo');
    const info = EGX_INSTRUMENTS.find((i) => i.symbol === symbol.toUpperCase());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url =
        `${this.endpoint}${encodeURIComponent(vendor)}` +
        `?modules=price,summaryDetail,defaultKeyStatistics`;
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new ProviderError(this.id, `HTTP ${response.status} for ${vendor}`);

      const body = (await response.json()) as YahooSummary;
      const node = body.quoteSummary?.result?.[0];
      if (!node) return undefined;

      const px = node.price?.regularMarketPrice?.raw;
      const marketCapRaw = node.price?.marketCap?.raw;
      const volume = node.summaryDetail?.averageDailyVolume10Day?.raw;
      const pe = node.summaryDetail?.trailingPE?.raw;
      const pb = node.summaryDetail?.priceToBook?.raw ?? node.defaultKeyStatistics?.priceToBook?.raw;
      const dy = node.summaryDetail?.dividendYield?.raw;
      const yc = node.defaultKeyStatistics?.['52WeekChange']?.raw;

      const metrics: ScreenMetrics = {
        symbol: fromProviderSymbol(node.price?.symbol ?? vendor),
        name: info?.name ?? symbol.toUpperCase(),
        sector: info?.sector ?? 'Unclassified',
        ...(typeof px === 'number' ? { price: price(px) } : {}),
        ...(typeof marketCapRaw === 'number' ? { marketCap: egp(marketCapRaw) } : {}),
        // Traded value ≈ average volume × price; a rough but useful liquidity proxy.
        ...(typeof volume === 'number' && typeof px === 'number'
          ? { avgDailyValue: egp(volume * px) }
          : {}),
        ...(typeof pe === 'number' ? { peRatio: pe } : {}),
        ...(typeof pb === 'number' ? { pbRatio: pb } : {}),
        ...(typeof dy === 'number' ? { dividendYield: dy } : {}),
        ...(typeof yc === 'number' ? { yearChange: yc } : {}),
      };
      return metrics;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
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

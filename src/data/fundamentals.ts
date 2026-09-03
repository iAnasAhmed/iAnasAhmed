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
import { type MarketDataProvider, ProviderError } from './provider.ts';
import { fromProviderSymbol, toProviderSymbol } from './symbols.ts';

export interface FundamentalsProvider {
  readonly id: string;
  readonly label: string;
  readonly offline: boolean;
  getFundamentals(symbols: readonly string[]): Promise<Map<string, ScreenMetrics>>;
}

// ---------------------------------------------------------------- mock/demo

/** Deterministic hash in [0,1) so demo figures are stable across reloads. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** A value spread deterministically across [min, max] for a symbol+field. */
function spread(symbol: string, field: string, min: number, max: number): number {
  return min + hash(`${symbol}:${field}`) * (max - min);
}

/**
 * Offline fundamentals.
 *
 * Values are synthesised from the symbol so they are stable and internally
 * plausible, purely to demonstrate the screener. They are **not** real EGX
 * fundamentals. Banks are given lower P/E and P/B and higher yields than
 * growth names, so the demo screen behaves recognisably — but do not trade on
 * these numbers.
 */
export class MockFundamentalsProvider implements FundamentalsProvider {
  readonly id = 'mock';
  readonly label = 'Demo fundamentals (illustrative)';
  readonly offline = true;

  async getFundamentals(symbols: readonly string[]): Promise<Map<string, ScreenMetrics>> {
    const out = new Map<string, ScreenMetrics>();

    for (const symbol of symbols) {
      const info = EGX_INSTRUMENTS.find((i) => i.symbol === symbol.toUpperCase());
      if (!info || info.assetClass !== 'equity') continue;

      const sector = info.sector ?? 'Unclassified';
      const isBank = sector === 'Banking';
      const isTech = sector === 'Technology';

      // Sector-flavoured but synthetic ranges.
      const pe = isBank ? spread(symbol, 'pe', 5, 10)
        : isTech ? spread(symbol, 'pe', 18, 40)
        : spread(symbol, 'pe', 8, 20);
      const pb = isBank ? spread(symbol, 'pb', 0.8, 1.6)
        : spread(symbol, 'pb', 1.2, 4.0);
      const dividendYield = isTech ? spread(symbol, 'dy', 0, 0.02)
        : spread(symbol, 'dy', 0.02, 0.08);
      const yearChange = spread(symbol, 'yc', -0.25, 0.75);
      const priceEgp = spread(symbol, 'px', 6, 120);
      const marketCapEgp = spread(symbol, 'mc', 2, 260) * 1_000_000_000;
      const advEgp = spread(symbol, 'adv', 0.3, 60) * 1_000_000;

      out.set(info.symbol, {
        symbol: info.symbol,
        name: info.name,
        sector,
        price: price(Number(priceEgp.toFixed(3))),
        marketCap: egp(Math.round(marketCapEgp)),
        avgDailyValue: egp(Math.round(advEgp)),
        peRatio: Number(pe.toFixed(1)),
        pbRatio: Number(pb.toFixed(2)),
        dividendYield: Number(dividendYield.toFixed(4)),
        yearChange: Number(yearChange.toFixed(4)),
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

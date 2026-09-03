/**
 * Yahoo Finance provider.
 *
 * Free and key-less, which is why it is the recommended online default. It is
 * an *undocumented* endpoint with no SLA: it can rate-limit, change shape, or
 * disappear. Every failure is therefore contained — a failed fetch yields an
 * empty map, and the dashboard falls back to average cost rather than erroring.
 *
 * EGX symbols carry the `.CA` (Cairo) suffix. See docs/research/04-data-providers.md.
 */

import { price } from '../../core/money.ts';
import type { Quote } from '../../core/types.ts';
import { type MarketDataProvider, ProviderError } from '../provider.ts';
import { fromProviderSymbol, toProviderSymbol } from '../symbols.ts';

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/';

/** The narrow slice of the Yahoo payload this provider relies on. */
interface YahooChartResponse {
  chart?: {
    result?: {
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
    }[];
  };
}

export interface YahooOptions {
  /**
   * Base URL override. Browsers block cross-origin requests to Yahoo, so in the
   * browser this must point at a local proxy — see scripts/serve.ts, which
   * proxies `/api/quote` for exactly this reason.
   */
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class YahooProvider implements MarketDataProvider {
  readonly id = 'yahoo';
  readonly label = 'Yahoo Finance (live)';
  readonly offline = false;

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: YahooOptions = {}) {
    this.endpoint = options.endpoint ?? ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async getQuotes(symbols: readonly string[]): Promise<Map<string, Quote>> {
    const quotes = new Map<string, Quote>();
    if (symbols.length === 0) return quotes;

    // Yahoo's chart endpoint is one symbol per request; run them together and
    // let individual failures fall away rather than sinking the whole refresh.
    const results = await Promise.allSettled(
      symbols.map((symbol) => this.fetchOne(symbol)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        quotes.set(result.value.symbol, result.value);
      }
    }

    return quotes;
  }

  private async fetchOne(symbol: string): Promise<Quote | undefined> {
    const vendorSymbol = toProviderSymbol(symbol, 'yahoo');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(
        `${this.endpoint}${encodeURIComponent(vendorSymbol)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new ProviderError(this.id, `HTTP ${response.status} for ${vendorSymbol}`);
      }

      const body = (await response.json()) as YahooChartResponse;
      const meta = body.chart?.result?.[0]?.meta;
      const last = meta?.regularMarketPrice;
      if (typeof last !== 'number' || !Number.isFinite(last)) return undefined;

      const previous = meta?.chartPreviousClose ?? meta?.previousClose;
      const quote: Quote = {
        symbol: fromProviderSymbol(meta?.symbol ?? vendorSymbol),
        price: price(last),
        asOf: new Date().toISOString(),
      };

      return typeof previous === 'number' && Number.isFinite(previous)
        ? { ...quote, previousClose: price(previous) }
        : quote;
    } finally {
      clearTimeout(timer);
    }
  }
}

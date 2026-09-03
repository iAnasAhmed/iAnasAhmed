/**
 * Yahoo Finance price provider (live).
 *
 * Primary path: the batched v7 `quote` endpoint via the local proxy
 * (`/api/quotes`), which also powers the screener — one request for every held
 * symbol. Fallback: the crumbless v8 `chart` endpoint per symbol, which keeps
 * prices working even if the batch/crumb path is unavailable.
 *
 * Every failure degrades to an empty map rather than throwing, so a flaky feed
 * never blanks the dashboard. EGX symbols carry the `.CA` (Cairo) suffix.
 */

import { price } from '../../core/money.ts';
import type { Quote } from '../../core/types.ts';
import { type MarketDataProvider, ProviderError } from '../provider.ts';
import { fromProviderSymbol, toProviderSymbol } from '../symbols.ts';
import { fetchYahooQuotes } from '../yahoo-shared.ts';

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
  /** Batched quote endpoint (proxy). Default '/api/quotes'. */
  readonly quotesEndpoint?: string;
  /** Per-symbol chart endpoint (proxy), the crumbless fallback. Default '/api/quote/'. */
  readonly chartEndpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const CHART_FALLBACK = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export class YahooProvider implements MarketDataProvider {
  readonly id = 'yahoo';
  readonly label = 'Yahoo Finance (live)';
  readonly offline = false;

  private readonly quotesEndpoint: string;
  private readonly chartEndpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: YahooOptions = {}) {
    this.quotesEndpoint = options.quotesEndpoint ?? '/api/quotes';
    this.chartEndpoint = options.chartEndpoint ?? CHART_FALLBACK;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async getQuotes(symbols: readonly string[]): Promise<Map<string, Quote>> {
    const quotes = new Map<string, Quote>();
    if (symbols.length === 0) return quotes;

    // Primary: one batched request for everything.
    const vendor = symbols.map((s) => toProviderSymbol(s, 'yahoo'));
    const rows = await fetchYahooQuotes(vendor, {
      endpoint: this.quotesEndpoint,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });

    const asOf = new Date().toISOString();
    for (const row of rows) {
      if (row.price === undefined) continue;
      const symbol = fromProviderSymbol(row.symbol);
      quotes.set(symbol, {
        symbol,
        price: price(row.price),
        asOf,
        ...(row.previousClose !== undefined ? { previousClose: price(row.previousClose) } : {}),
      });
    }

    // Fallback: fill any gaps (or a wholesale failure) from the chart endpoint.
    const missing = symbols.filter((s) => !quotes.has(s.toUpperCase()));
    if (missing.length > 0) {
      const results = await Promise.allSettled(missing.map((s) => this.fetchChart(s)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) quotes.set(r.value.symbol, r.value);
      }
    }

    return quotes;
  }

  private async fetchChart(symbol: string): Promise<Quote | undefined> {
    const vendorSymbol = toProviderSymbol(symbol, 'yahoo');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.chartEndpoint}${encodeURIComponent(vendorSymbol)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new ProviderError(this.id, `HTTP ${response.status} for ${vendorSymbol}`);

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
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}

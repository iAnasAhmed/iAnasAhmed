/**
 * Offline provider.
 *
 * The default, and the reason the dashboard always works: no network, no key,
 * no rate limit. Prices are deterministic per symbol and per day, so the UI is
 * stable across reloads and screenshots are reproducible.
 *
 * It is NOT a simulation of the market and must never be presented as real
 * data — the UI badges it clearly as demo pricing.
 */

import { price } from '../../core/money.ts';
import type { Quote } from '../../core/types.ts';
import type { MarketDataProvider } from '../provider.ts';
import { EGX_REFERENCE } from '../reference-egx.ts';

/**
 * Baseline prices, EGP. Equities use the curated reference figures (approximate
 * real Sep-2026 quotes — see reference-egx.ts), so the demo behaves like the
 * real market. The money-market fund is a flat 10.00 accrual unit.
 */
const BASE_PRICES: Readonly<Record<string, number>> = {
  ...Object.fromEntries(Object.values(EGX_REFERENCE).map((r) => [r.symbol, r.price])),
  MMF: 10.0,
};

/** Deterministic hash, so a symbol always drifts the same way on a given day. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export class MockProvider implements MarketDataProvider {
  readonly id = 'mock';
  readonly label = 'Demo data (offline)';
  readonly offline = true;

  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async getQuotes(symbols: readonly string[]): Promise<Map<string, Quote>> {
    const at = this.now();
    const today = dayKey(at);
    const asOf = at.toISOString();
    const quotes = new Map<string, Quote>();

    for (const symbol of symbols) {
      const base = BASE_PRICES[symbol.toUpperCase()];
      if (base === undefined) continue;

      // Money-market units do not fluctuate; they accrue. Keep them flat.
      if (symbol.toUpperCase() === 'MMF') {
        quotes.set(symbol, { symbol, price: price(base), previousClose: price(base), asOf });
        continue;
      }

      // Deterministic drift of at most ±3% from the base.
      const drift = (hash(`${symbol}:${today}`) - 0.5) * 0.06;
      const prevDrift = (hash(`${symbol}:prev:${today}`) - 0.5) * 0.06;

      quotes.set(symbol, {
        symbol,
        price: price(Number((base * (1 + drift)).toFixed(3))),
        previousClose: price(Number((base * (1 + prevDrift)).toFixed(3))),
        asOf,
      });
    }

    return quotes;
  }
}

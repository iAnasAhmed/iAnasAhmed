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

/** Baseline prices, in EGP, for the seeded EGX names. */
const BASE_PRICES: Readonly<Record<string, number>> = {
  COMI: 96.4, ETEL: 47.2, HRHO: 24.85, SWDY: 88.1, TMGH: 62.5,
  EAST: 31.7, ABUK: 71.3, FWRY: 8.42, ORAS: 285.0, MFPC: 118.6,
  ESRS: 96.9, CIEB: 42.15, JUFO: 22.8, AMOC: 12.35, PHDC: 9.87,
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

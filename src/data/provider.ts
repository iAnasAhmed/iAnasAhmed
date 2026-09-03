/**
 * Market-data provider interface.
 *
 * Telda has no public API (docs/research/01-telda-investing.md), so quotes come
 * from third parties. Every provider hides behind this interface so switching
 * one out is a config change, never a UI change.
 *
 * The contract is deliberately forgiving: a provider returns what it can and
 * omits what it cannot. A missing quote degrades one row of the dashboard; it
 * never breaks the page.
 */

import type { Quote } from '../core/types.ts';

export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  /** True when the provider works with no network — used for the offline badge. */
  readonly offline: boolean;
  /** Fetch quotes for the given symbols. Unknown symbols are simply absent. */
  getQuotes(symbols: readonly string[]): Promise<Map<string, Quote>>;
}

export class ProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string, cause?: unknown) {
    super(`[${providerId}] ${message}`, cause === undefined ? undefined : { cause });
    this.name = 'ProviderError';
    this.providerId = providerId;
  }
}

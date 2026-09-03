/** Provider selection. One place that knows which providers exist. */

import type { MarketDataProvider } from './provider.ts';
import { MockProvider } from './providers/mock.ts';
import { YahooProvider, type YahooOptions } from './providers/yahoo.ts';

export type ProviderId = 'mock' | 'yahoo';

export function createProvider(
  id: ProviderId,
  options: YahooOptions = {},
): MarketDataProvider {
  switch (id) {
    case 'yahoo': return new YahooProvider(options);
    case 'mock': return new MockProvider();
  }
}

export const PROVIDER_CHOICES: readonly { id: ProviderId; label: string }[] = [
  { id: 'mock', label: 'Demo data (offline)' },
  { id: 'yahoo', label: 'Yahoo Finance (live)' },
];

export { MockProvider, YahooProvider };

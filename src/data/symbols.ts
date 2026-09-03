/**
 * EGX instrument registry and per-provider symbol mapping.
 *
 * Symbols differ between the exchange and each data vendor: Telda shows `COMI`,
 * Yahoo Finance wants `COMI.CA` (CA = Cairo). This table is the one place that
 * knows about the difference.
 *
 * The list below is a starting set of large, liquid EGX names for autocomplete.
 * It is reference data for the UI — **not a recommendation list**
 * (CLAUDE.md §1.6). Sector labels are best-effort and marked accordingly.
 */

import type { Instrument } from '../core/types.ts';

export interface SymbolInfo extends Instrument {
  /** Suffix-qualified symbol for Yahoo Finance. */
  readonly yahoo?: string;
}

/**
 * Well-known EGX constituents, for symbol lookup only.
 * ⚠️ Verify names and sectors against the EGX listing before relying on them.
 */
export const EGX_INSTRUMENTS: readonly SymbolInfo[] = [
  { symbol: 'COMI', name: 'Commercial International Bank', assetClass: 'equity', sector: 'Banking', yahoo: 'COMI.CA' },
  { symbol: 'ETEL', name: 'Telecom Egypt', assetClass: 'equity', sector: 'Telecom', yahoo: 'ETEL.CA' },
  { symbol: 'HRHO', name: 'EFG Holding', assetClass: 'equity', sector: 'Financial services', yahoo: 'HRHO.CA' },
  { symbol: 'SWDY', name: 'Elsewedy Electric', assetClass: 'equity', sector: 'Industrials', yahoo: 'SWDY.CA' },
  { symbol: 'TMGH', name: 'Talaat Moustafa Group', assetClass: 'equity', sector: 'Real estate', yahoo: 'TMGH.CA' },
  { symbol: 'EAST', name: 'Eastern Company', assetClass: 'equity', sector: 'Consumer', yahoo: 'EAST.CA' },
  { symbol: 'ABUK', name: 'Abu Qir Fertilizers', assetClass: 'equity', sector: 'Chemicals', yahoo: 'ABUK.CA' },
  { symbol: 'FWRY', name: 'Fawry', assetClass: 'equity', sector: 'Technology', yahoo: 'FWRY.CA' },
  { symbol: 'ORAS', name: 'Orascom Construction', assetClass: 'equity', sector: 'Construction', yahoo: 'ORAS.CA' },
  { symbol: 'MFPC', name: 'Misr Fertilizers (MOPCO)', assetClass: 'equity', sector: 'Chemicals', yahoo: 'MFPC.CA' },
  { symbol: 'ESRS', name: 'Ezz Steel', assetClass: 'equity', sector: 'Materials', yahoo: 'ESRS.CA' },
  { symbol: 'CIEB', name: 'Credit Agricole Egypt', assetClass: 'equity', sector: 'Banking', yahoo: 'CIEB.CA' },
  { symbol: 'JUFO', name: 'Juhayna Food Industries', assetClass: 'equity', sector: 'Consumer', yahoo: 'JUFO.CA' },
  { symbol: 'AMOC', name: 'Alexandria Mineral Oils', assetClass: 'equity', sector: 'Energy', yahoo: 'AMOC.CA' },
  { symbol: 'PHDC', name: 'Palm Hills Development', assetClass: 'equity', sector: 'Real estate', yahoo: 'PHDC.CA' },

  // Placeholders for the benchmark sleeve. Replace the symbol and yield with the
  // actual fund the owner subscribes to inside Telda.
  {
    symbol: 'MMF',
    name: 'EGP money-market fund (placeholder)',
    assetClass: 'money_market',
    sector: 'Fixed income',
    annualYield: 0.22,
  },
] as const;

const BY_SYMBOL = new Map(EGX_INSTRUMENTS.map((i) => [i.symbol, i]));

export function lookup(symbol: string): SymbolInfo | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

/** Instrument metadata map for `buildPortfolio`. */
export function instrumentMap(extra: readonly Instrument[] = []): Map<string, Instrument> {
  const map = new Map<string, Instrument>();
  for (const i of EGX_INSTRUMENTS) map.set(i.symbol, i);
  for (const i of extra) map.set(i.symbol, i);
  return map;
}

/** Translate an EGX symbol into a provider's dialect. */
export function toProviderSymbol(symbol: string, provider: 'yahoo' | 'egx'): string {
  const upper = symbol.toUpperCase();
  if (provider === 'egx') return upper;
  return lookup(upper)?.yahoo ?? `${upper}.CA`;
}

/** Reverse a provider symbol back to the EGX ticker. */
export function fromProviderSymbol(symbol: string): string {
  return symbol.replace(/\.CA$/i, '').toUpperCase();
}

/** Case-insensitive prefix search for the symbol autocomplete. */
export function searchInstruments(query: string, limit = 8): SymbolInfo[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  return EGX_INSTRUMENTS.filter(
    (i) => i.symbol.startsWith(q) || i.name.toUpperCase().includes(q),
  ).slice(0, limit);
}

/**
 * Application state and persistence.
 *
 * Financial data never leaves the device: everything lives in `localStorage`,
 * with explicit JSON export/import as the only way out (CLAUDE.md §2). There is
 * no account, no server, no telemetry.
 */

import type { Instrument, Quote, Transaction } from '../core/types.ts';
import type { Snapshot } from '../core/history.ts';
import type { ProviderId } from '../data/registry.ts';
import { MONEY_MARKET_BENCHMARK, INFLATION_ASSUMPTION } from '../core/performance.ts';
import { OTHER_FEES_BPS_ESTIMATE, STAMP_DUTY_BPS, TELDA_COMMISSION_BPS } from '../core/costs.ts';

const STORAGE_KEY = 'telda-tracker/v1';

export interface Settings {
  readonly providerId: ProviderId;
  /** Data source for screener fundamentals: 'mock' or 'yahoo'. */
  readonly fundamentalsId: ProviderId;
  /** Annual money-market rate used as the benchmark, as a ratio. */
  readonly benchmarkRate: number;
  /** Annual inflation assumption, as a ratio. */
  readonly inflation: number;
  readonly commissionBps: number;
  readonly stampDutyBps: number;
  readonly otherFeesBps: number;
  readonly theme: 'system' | 'light' | 'dark';
}

export interface AppState {
  readonly transactions: readonly Transaction[];
  readonly customInstruments: readonly Instrument[];
  /** Observed total-value snapshots, one per day the app was opened. */
  readonly history: readonly Snapshot[];
  /** Symbols shortlisted from the screener, before any money is committed. */
  readonly watchlist: readonly string[];
  readonly settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  providerId: 'mock',
  fundamentalsId: 'mock',
  benchmarkRate: MONEY_MARKET_BENCHMARK,
  inflation: INFLATION_ASSUMPTION,
  commissionBps: TELDA_COMMISSION_BPS,
  stampDutyBps: STAMP_DUTY_BPS,
  otherFeesBps: OTHER_FEES_BPS_ESTIMATE,
  theme: 'system',
};

export const EMPTY_STATE: AppState = {
  transactions: [],
  customInstruments: [],
  history: [],
  watchlist: [],
  settings: DEFAULT_SETTINGS,
};

/** Narrow unknown parsed JSON back into AppState, filling gaps with defaults. */
export function reviveState(raw: unknown): AppState {
  if (typeof raw !== 'object' || raw === null) return EMPTY_STATE;
  const record = raw as Record<string, unknown>;

  const transactions = Array.isArray(record['transactions'])
    ? (record['transactions'].filter(isTransaction) as Transaction[])
    : [];

  const customInstruments = Array.isArray(record['customInstruments'])
    ? (record['customInstruments'].filter(isInstrument) as Instrument[])
    : [];

  const settings =
    typeof record['settings'] === 'object' && record['settings'] !== null
      ? { ...DEFAULT_SETTINGS, ...(record['settings'] as Partial<Settings>) }
      : DEFAULT_SETTINGS;

  const history = Array.isArray(record['history'])
    ? (record['history'].filter(isSnapshot) as Snapshot[])
    : [];

  const watchlist = Array.isArray(record['watchlist'])
    ? (record['watchlist'].filter((s): s is string => typeof s === 'string'))
    : [];

  return { transactions, customInstruments, history, watchlist, settings };
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s['date'] === 'string' && typeof s['value'] === 'number';
}

function isTransaction(value: unknown): value is Transaction {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return typeof t['id'] === 'string' && typeof t['date'] === 'string' && typeof t['kind'] === 'string';
}

function isInstrument(value: unknown): value is Instrument {
  if (typeof value !== 'object' || value === null) return false;
  const i = value as Record<string, unknown>;
  return typeof i['symbol'] === 'string' && typeof i['name'] === 'string';
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadState(storage: Storage): AppState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? reviveState(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    // Corrupt storage must never brick the dashboard — start clean instead.
    return EMPTY_STATE;
  }
}

export function saveState(storage: Storage, state: AppState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private-mode failures are non-fatal; the session still works.
  }
}

/** Portable export payload, versioned so future imports can migrate. */
export interface ExportPayload extends AppState {
  readonly version: 1;
  readonly exportedAt: string;
}

export function toExport(state: AppState): ExportPayload {
  return { version: 1, exportedAt: new Date().toISOString(), ...state };
}

// ------------------------------------------------------------------- mutations

export function addTransaction(state: AppState, tx: Transaction): AppState {
  return { ...state, transactions: [...state.transactions, tx] };
}

export function removeTransaction(state: AppState, id: string): AppState {
  return { ...state, transactions: state.transactions.filter((t) => t.id !== id) };
}

export function updateSettings(state: AppState, patch: Partial<Settings>): AppState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

export function withHistory(state: AppState, history: readonly Snapshot[]): AppState {
  return { ...state, history };
}

export function toggleWatch(state: AppState, symbol: string): AppState {
  const upper = symbol.toUpperCase();
  const watchlist = state.watchlist.includes(upper)
    ? state.watchlist.filter((s) => s !== upper)
    : [...state.watchlist, upper];
  return { ...state, watchlist };
}

/** Collision-resistant id without pulling in a uuid dependency. */
export function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

// ------------------------------------------------------------------- selectors

/** Every symbol the portfolio needs a quote for. */
export function symbolsIn(state: AppState): string[] {
  const symbols = new Set<string>();
  for (const tx of state.transactions) {
    if (tx.symbol) symbols.add(tx.symbol);
  }
  return [...symbols];
}

export type QuoteMap = ReadonlyMap<string, Quote>;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egp } from '../core/money.ts';
import type { Transaction } from '../core/types.ts';
import {
  loadState, saveState, reviveState, addTransaction, removeTransaction,
  updateSettings, toggleWatch, upsertNote, removeNote, newId, symbolsIn, toExport, EMPTY_STATE, DEFAULT_SETTINGS,
  type Storage,
} from './store.ts';

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
  };
};

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: newId(), date: '2026-01-01', kind: 'deposit', amount: egp(1_000), ...over,
});

test('an empty store loads the empty state', () => {
  assert.deepEqual(loadState(memoryStorage()), EMPTY_STATE);
});

test('state round-trips through storage', () => {
  const storage = memoryStorage();
  const state = addTransaction(EMPTY_STATE, tx({ id: 'a' }));
  saveState(storage, state);
  assert.equal(loadState(storage).transactions[0]!.id, 'a');
});

test('corrupt storage falls back to empty rather than crashing', () => {
  assert.deepEqual(loadState(memoryStorage({ 'telda-tracker/v1': '{not json' })), EMPTY_STATE);
  assert.deepEqual(reviveState(null), EMPTY_STATE);
  assert.deepEqual(reviveState('nonsense'), EMPTY_STATE);
});

test('malformed rows are dropped, valid ones kept', () => {
  const revived = reviveState({
    transactions: [{ id: 'ok', date: '2026-01-01', kind: 'deposit' }, { junk: true }, null],
  });
  assert.equal(revived.transactions.length, 1);
  assert.equal(revived.transactions[0]!.id, 'ok');
});

test('missing settings fall back to defaults, partial settings merge', () => {
  assert.deepEqual(reviveState({}).settings, DEFAULT_SETTINGS);
  const merged = reviveState({ settings: { benchmarkRate: 0.25 } }).settings;
  assert.equal(merged.benchmarkRate, 0.25);
  assert.equal(merged.inflation, DEFAULT_SETTINGS.inflation); // untouched
});

test('storage failures are swallowed, not thrown', () => {
  const failing: Storage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceeded'); },
  };
  assert.doesNotThrow(() => saveState(failing, EMPTY_STATE));
});

test('mutations are immutable', () => {
  const before = EMPTY_STATE;
  const after = addTransaction(before, tx({ id: 'x' }));
  assert.equal(before.transactions.length, 0);
  assert.equal(after.transactions.length, 1);

  assert.equal(removeTransaction(after, 'x').transactions.length, 0);
  assert.equal(removeTransaction(after, 'missing').transactions.length, 1);

  assert.equal(updateSettings(before, { inflation: 0.2 }).settings.inflation, 0.2);
  assert.equal(before.settings.inflation, DEFAULT_SETTINGS.inflation);
});

test('symbolsIn collects unique symbols only', () => {
  const state = {
    ...EMPTY_STATE,
    transactions: [
      tx({ kind: 'buy', symbol: 'COMI' }),
      tx({ kind: 'sell', symbol: 'COMI' }),
      tx({ kind: 'buy', symbol: 'ETEL' }),
      tx({ kind: 'deposit' }),
    ],
  };
  assert.deepEqual(symbolsIn(state).sort(), ['COMI', 'ETEL']);
});

test('newId produces unique ids', () => {
  const ids = new Set(Array.from({ length: 500 }, newId));
  assert.equal(ids.size, 500);
});

test('export payload is versioned and timestamped', () => {
  const payload = toExport(EMPTY_STATE);
  assert.equal(payload.version, 1);
  assert.ok(Date.parse(payload.exportedAt) > 0);
  // and it round-trips back through revive
  assert.deepEqual(reviveState(JSON.parse(JSON.stringify(payload))), EMPTY_STATE);
});

test('toggleWatch adds and removes symbols, case-insensitively', () => {
  const a = toggleWatch(EMPTY_STATE, 'comi');
  assert.deepEqual(a.watchlist, ['COMI']);
  const b = toggleWatch(a, 'COMI');
  assert.deepEqual(b.watchlist, []);
});

test('watchlist survives a storage round-trip', () => {
  const storage = memoryStorage();
  saveState(storage, toggleWatch(EMPTY_STATE, 'SWDY'));
  assert.deepEqual(loadState(storage).watchlist, ['SWDY']);
});

test('a malformed watchlist revives as empty', () => {
  assert.deepEqual(reviveState({ watchlist: [1, null, 'OK'] }).watchlist, ['OK']);
  assert.deepEqual(reviveState({ watchlist: 'nope' }).watchlist, []);
});

test('upsertNote inserts then updates in place', () => {
  const n = { id: 'x', createdAt: 't', updatedAt: 't', title: 'A', body: '', kind: 'thesis',
    sentiment: 'bullish', conviction: 4, horizon: 'long', status: 'open', tags: [] } as const;
  const a = upsertNote(EMPTY_STATE, n);
  assert.equal(a.notes.length, 1);
  const b = upsertNote(a, { ...n, title: 'B' });
  assert.equal(b.notes.length, 1);
  assert.equal(b.notes[0]!.title, 'B');
});

test('removeNote deletes by id; notes survive a storage round-trip', () => {
  const n = { id: 'x', createdAt: 't', updatedAt: 't', title: 'A', body: '', kind: 'risk',
    sentiment: 'bearish', conviction: 2, horizon: 'short', status: 'open', tags: ['m'] } as const;
  const storage = memoryStorage();
  saveState(storage, upsertNote(EMPTY_STATE, n));
  assert.equal(loadState(storage).notes[0]!.id, 'x');
  assert.equal(removeNote(upsertNote(EMPTY_STATE, n), 'x').notes.length, 0);
});

test('malformed notes revive as empty', () => {
  assert.deepEqual(reviveState({ notes: [{ nope: true }, null] }).notes, []);
});

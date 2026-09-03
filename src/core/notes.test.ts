import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterNotes, sortNotes, summarizeNotes, staleNotes, dueForReview,
  notesForSymbol, coverageGaps, tagsIn, parseTags, isActive,
  type Note,
} from './notes.ts';

let seq = 0;
const note = (over: Partial<Note> = {}): Note => {
  seq += 1;
  const ts = `2026-08-${String((seq % 28) + 1).padStart(2, '0')}T10:00:00.000Z`;
  return {
    id: `n${seq}`, createdAt: ts, updatedAt: ts,
    title: `Note ${seq}`, body: '', kind: 'observation', sentiment: 'neutral',
    conviction: 3, horizon: 'medium', status: 'open', tags: [], ...over,
  };
};

test('isActive covers open and watching only', () => {
  assert.equal(isActive(note({ status: 'open' })), true);
  assert.equal(isActive(note({ status: 'watching' })), true);
  assert.equal(isActive(note({ status: 'closed' })), false);
  assert.equal(isActive(note({ status: 'acted' })), false);
});

test('filter by search matches title, body, and tags', () => {
  const notes = [
    note({ title: 'CIB thesis', body: 'strong bank' }),
    note({ title: 'random', body: 'nothing here', tags: ['macro'] }),
  ];
  assert.equal(filterNotes(notes, { search: 'bank' }).length, 1);
  assert.equal(filterNotes(notes, { search: 'macro' }).length, 1); // tag hit
  assert.equal(filterNotes(notes, { search: 'zzz' }).length, 0);
});

test('filter by symbol, kind, sentiment, status, tag', () => {
  const notes = [
    note({ symbol: 'COMI', kind: 'thesis', sentiment: 'bullish', status: 'open', tags: ['bank'] }),
    note({ symbol: 'ETEL', kind: 'risk', sentiment: 'bearish', status: 'closed' }),
  ];
  assert.equal(filterNotes(notes, { symbol: 'comi' }).length, 1);
  assert.equal(filterNotes(notes, { kind: 'risk' }).length, 1);
  assert.equal(filterNotes(notes, { sentiment: 'bullish' }).length, 1);
  assert.equal(filterNotes(notes, { status: 'closed' }).length, 1);
  assert.equal(filterNotes(notes, { status: 'active' }).length, 1); // only the open one
  assert.equal(filterNotes(notes, { tag: 'BANK' }).length, 1);      // case-insensitive
  assert.equal(filterNotes(notes, { kind: 'all', status: 'all' }).length, 2);
});

test('sort by conviction, then symbol, then recency', () => {
  const a = note({ conviction: 2, symbol: 'ETEL', updatedAt: '2026-01-01T00:00:00Z' });
  const b = note({ conviction: 5, symbol: 'COMI', updatedAt: '2026-02-01T00:00:00Z' });
  assert.equal(sortNotes([a, b], 'conviction')[0]!.id, b.id);
  assert.equal(sortNotes([a, b], 'symbol')[0]!.symbol, 'COMI');
  assert.equal(sortNotes([a, b], 'updated')[0]!.id, b.id);
});

test('summary counts, average conviction, and conviction-weighted sentiment', () => {
  const notes = [
    note({ kind: 'thesis', sentiment: 'bullish', conviction: 5, status: 'open' }),
    note({ kind: 'risk', sentiment: 'bearish', conviction: 1, status: 'open' }),
    note({ kind: 'lesson', sentiment: 'neutral', conviction: 3, status: 'closed' }),
  ];
  const s = summarizeNotes(notes);
  assert.equal(s.total, 3);
  assert.equal(s.active, 2);
  assert.equal(s.byKind.thesis, 1);
  assert.equal(s.byStatus.open, 2);
  assert.equal(s.bySentiment.bullish, 1);
  assert.equal(s.avgConviction, 3);
  // active net sentiment = (+1*5 + -1*1) / (5+1) = 4/6
  assert.ok(Math.abs(s.netSentiment - 4 / 6) < 1e-9);
});

test('summary of an empty set is all zeros, not NaN', () => {
  const s = summarizeNotes([]);
  assert.equal(s.avgConviction, 0);
  assert.equal(s.netSentiment, 0);
  assert.equal(s.total, 0);
});

test('stale notes: active and untouched beyond the window, oldest first', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const fresh = note({ status: 'open', updatedAt: '2026-08-28T00:00:00Z' });
  const stale = note({ status: 'open', updatedAt: '2026-06-01T00:00:00Z' });
  const staler = note({ status: 'open', updatedAt: '2026-01-01T00:00:00Z' });
  const closed = note({ status: 'closed', updatedAt: '2026-01-01T00:00:00Z' });

  const result = staleNotes([fresh, stale, staler, closed], { days: 30, now });
  assert.deepEqual(result.map((n) => n.id), [staler.id, stale.id]); // oldest first, closed excluded
});

test('due for review: active notes whose review date has arrived', () => {
  const notes = [
    note({ status: 'open', reviewOn: '2026-08-15' }),
    note({ status: 'open', reviewOn: '2026-12-31' }),  // future
    note({ status: 'closed', reviewOn: '2026-01-01' }), // closed, ignored
    note({ status: 'open' }),                            // no review date
  ];
  const due = dueForReview(notes, '2026-09-01');
  assert.equal(due.length, 1);
  assert.equal(due[0]!.reviewOn, '2026-08-15');
});

test('notesForSymbol is case-insensitive and symbol-scoped', () => {
  const notes = [note({ symbol: 'COMI' }), note({ symbol: 'ETEL' }), note({ symbol: 'comi' })];
  assert.equal(notesForSymbol(notes, 'comi').length, 2);
});

test('coverage gaps: held symbols with no active thesis', () => {
  const notes = [
    note({ symbol: 'COMI', kind: 'thesis', status: 'open' }),
    note({ symbol: 'ETEL', kind: 'risk', status: 'open' }),     // risk, not a thesis
    note({ symbol: 'FWRY', kind: 'thesis', status: 'closed' }), // thesis, but closed
  ];
  const gaps = coverageGaps(notes, ['COMI', 'ETEL', 'FWRY', 'SWDY']);
  // COMI covered; ETEL/FWRY/SWDY are gaps.
  assert.deepEqual(gaps, ['ETEL', 'FWRY', 'SWDY']);
});

test('tags: collection and parsing', () => {
  assert.deepEqual(tagsIn([note({ tags: ['b', 'a'] }), note({ tags: ['a', 'c'] })]), ['a', 'b', 'c']);
  assert.deepEqual(parseTags('macro,  Banking , macro ,,'), ['macro', 'Banking']); // trimmed, de-duped
  assert.deepEqual(parseTags('   '), []);
});

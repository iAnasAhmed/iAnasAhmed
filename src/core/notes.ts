/**
 * Research journal — structured notes and insights.
 *
 * Untracked reasoning is how investors fool themselves: you remember the
 * theses that worked and forget the ones that didn't. This module makes the
 * reasoning a first-class, queryable record — every note carries structured
 * fields (what kind of note, how strong the conviction, what horizon, is it
 * still open) so the app can surface what needs attention instead of leaving
 * a wall of free text.
 *
 * Pure: no DOM, no fetch. Sector enrichment and symbol lists live in the view;
 * this module only reasons about Note[] it is given.
 */

import type { IsoDate } from './types.ts';
import type { Price } from './money.ts';

// --- Controlled vocabularies. The UI renders these as dropdowns, so the app
// and the domain never disagree about what a valid value is.

export const NOTE_KINDS = [
  'thesis', 'observation', 'risk', 'catalyst', 'question', 'decision', 'lesson',
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const SENTIMENTS = ['bullish', 'neutral', 'bearish'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** Intended holding horizon. */
export const HORIZONS = ['intraday', 'short', 'medium', 'long'] as const;
export type Horizon = (typeof HORIZONS)[number];

export const NOTE_STATUSES = ['open', 'watching', 'acted', 'closed'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** Conviction is a 1–5 scale; 3 is the neutral default. */
export const MIN_CONVICTION = 1;
export const MAX_CONVICTION = 5;

export interface Note {
  readonly id: string;
  readonly createdAt: string;   // ISO datetime
  readonly updatedAt: string;   // ISO datetime
  readonly title: string;
  readonly body: string;
  readonly kind: NoteKind;
  readonly sentiment: Sentiment;
  readonly conviction: number;  // 1..5
  readonly horizon: Horizon;
  readonly status: NoteStatus;
  /** Optional link to an EGX instrument this note is about. */
  readonly symbol?: string;
  readonly tags: readonly string[];
  /** Optional price levels for a thesis. */
  readonly targetPrice?: Price;
  readonly stopPrice?: Price;
  /** Optional date to revisit this note. */
  readonly reviewOn?: IsoDate;
}

/** A note is "active" — still shaping decisions — while open or being watched. */
export function isActive(note: Note): boolean {
  return note.status === 'open' || note.status === 'watching';
}

// ------------------------------------------------------------------ filtering

export interface NoteFilters {
  readonly search?: string;
  readonly symbol?: string;
  readonly kind?: NoteKind | 'all';
  readonly status?: NoteStatus | 'all' | 'active';
  readonly sentiment?: Sentiment | 'all';
  readonly tag?: string;
}

export function filterNotes(notes: readonly Note[], filters: NoteFilters = {}): Note[] {
  const q = filters.search?.trim().toLowerCase();
  const symbol = filters.symbol?.toUpperCase();

  return notes.filter((n) => {
    if (q && !n.title.toLowerCase().includes(q) && !n.body.toLowerCase().includes(q)
        && !n.tags.some((t) => t.toLowerCase().includes(q))) {
      return false;
    }
    if (symbol && (n.symbol ?? '').toUpperCase() !== symbol) return false;
    if (filters.kind && filters.kind !== 'all' && n.kind !== filters.kind) return false;
    if (filters.sentiment && filters.sentiment !== 'all' && n.sentiment !== filters.sentiment) return false;
    if (filters.status === 'active' && !isActive(n)) return false;
    if (filters.status && filters.status !== 'all' && filters.status !== 'active'
        && n.status !== filters.status) return false;
    if (filters.tag && !n.tags.some((t) => t.toLowerCase() === filters.tag!.toLowerCase())) return false;
    return true;
  });
}

// ------------------------------------------------------------------- sorting

export type NoteSort = 'updated' | 'created' | 'conviction' | 'symbol';

export function sortNotes(notes: readonly Note[], sort: NoteSort = 'updated'): Note[] {
  const copy = [...notes];
  switch (sort) {
    case 'created':
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'conviction':
      return copy.sort((a, b) =>
        b.conviction === a.conviction ? b.updatedAt.localeCompare(a.updatedAt) : b.conviction - a.conviction);
    case 'symbol':
      return copy.sort((a, b) =>
        (a.symbol ?? '~').localeCompare(b.symbol ?? '~') || b.updatedAt.localeCompare(a.updatedAt));
    case 'updated':
    default:
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

// ------------------------------------------------------------------- insights

export interface NoteSummary {
  readonly total: number;
  readonly active: number;
  readonly byKind: Readonly<Record<NoteKind, number>>;
  readonly byStatus: Readonly<Record<NoteStatus, number>>;
  readonly bySentiment: Readonly<Record<Sentiment, number>>;
  readonly avgConviction: number;
  /**
   * Conviction-weighted net sentiment of ACTIVE notes, from -1 (bearish) to
   * +1 (bullish). A crowd of weak bullish notes shouldn't outweigh one strong
   * bearish one, so it is weighted by conviction.
   */
  readonly netSentiment: number;
}

const SENTIMENT_SIGN: Readonly<Record<Sentiment, number>> = { bullish: 1, neutral: 0, bearish: -1 };

export function summarizeNotes(notes: readonly Note[]): NoteSummary {
  const byKind = Object.fromEntries(NOTE_KINDS.map((k) => [k, 0])) as Record<NoteKind, number>;
  const byStatus = Object.fromEntries(NOTE_STATUSES.map((s) => [s, 0])) as Record<NoteStatus, number>;
  const bySentiment = Object.fromEntries(SENTIMENTS.map((s) => [s, 0])) as Record<Sentiment, number>;

  let convictionSum = 0;
  let active = 0;
  let weightedSentiment = 0;
  let activeConviction = 0;

  for (const n of notes) {
    byKind[n.kind] += 1;
    byStatus[n.status] += 1;
    bySentiment[n.sentiment] += 1;
    convictionSum += n.conviction;
    if (isActive(n)) {
      active += 1;
      weightedSentiment += SENTIMENT_SIGN[n.sentiment] * n.conviction;
      activeConviction += n.conviction;
    }
  }

  return {
    total: notes.length,
    active,
    byKind,
    byStatus,
    bySentiment,
    avgConviction: notes.length > 0 ? convictionSum / notes.length : 0,
    netSentiment: activeConviction > 0 ? weightedSentiment / activeConviction : 0,
  };
}

/**
 * Active notes not touched in `days` — the ones most likely to be quietly
 * out of date. Surfacing these is the difference between a journal and a graveyard.
 */
export function staleNotes(
  notes: readonly Note[],
  options: { readonly days?: number; readonly now?: Date } = {},
): Note[] {
  const days = options.days ?? 30;
  const now = (options.now ?? new Date()).getTime();
  const cutoff = days * 86_400_000;
  return sortNotes(
    notes.filter((n) => isActive(n) && now - Date.parse(n.updatedAt) > cutoff),
    'updated',
  ).reverse(); // oldest first — most overdue at the top
}

/** Notes whose review date has arrived. */
export function dueForReview(notes: readonly Note[], today: IsoDate): Note[] {
  return notes
    .filter((n) => isActive(n) && n.reviewOn !== undefined && n.reviewOn <= today)
    .sort((a, b) => (a.reviewOn ?? '').localeCompare(b.reviewOn ?? ''));
}

export function notesForSymbol(notes: readonly Note[], symbol: string): Note[] {
  const upper = symbol.toUpperCase();
  return sortNotes(notes.filter((n) => (n.symbol ?? '').toUpperCase() === upper), 'updated');
}

/**
 * Held symbols with no active thesis on record — "you own this but never wrote
 * down why." The single most useful nudge the journal produces.
 */
export function coverageGaps(notes: readonly Note[], heldSymbols: readonly string[]): string[] {
  const withThesis = new Set(
    notes
      .filter((n) => n.kind === 'thesis' && isActive(n) && n.symbol)
      .map((n) => n.symbol!.toUpperCase()),
  );
  return [...new Set(heldSymbols.map((s) => s.toUpperCase()))]
    .filter((s) => !withThesis.has(s))
    .sort();
}

/** Every distinct tag in use, sorted, for the tag filter and suggestions. */
export function tagsIn(notes: readonly Note[]): string[] {
  const set = new Set<string>();
  for (const n of notes) for (const t of n.tags) set.add(t);
  return [...set].sort();
}

/** Normalise a free-text tag input ("a, b ,,B") into a clean, de-duped list. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(',')) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

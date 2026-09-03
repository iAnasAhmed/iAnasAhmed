/**
 * Journal view — the research notebook.
 *
 * A structured place to record reasoning and let the app surface what needs
 * attention: a summary of your stance, notes gone stale, reviews now due, and
 * holdings you own without a written thesis. The composer uses the same
 * controlled vocabularies the domain enforces, so every entry is queryable.
 */

import { h } from './dom.ts';
import { formatPrice, formatPct } from '../core/money.ts';
import {
  NOTE_KINDS, SENTIMENTS, HORIZONS, NOTE_STATUSES,
  summarizeNotes, filterNotes, sortNotes, staleNotes, dueForReview, coverageGaps, tagsIn,
  type Note, type NoteKind, type NoteStatus, type Sentiment, type NoteSort, type NoteFilters,
} from '../core/notes.ts';
import { EGX_INSTRUMENTS } from '../data/symbols.ts';

export interface JournalHandlers {
  readonly onSave: (form: HTMLFormElement) => void;
  readonly onEdit: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onFilter: (patch: Partial<RawNoteFilters>) => void;
  readonly onSort: (sort: NoteSort) => void;
  readonly onCancelEdit: () => void;
  readonly onComposeFor: (symbol: string) => void;
}

export interface RawNoteFilters {
  readonly search: string;
  readonly kind: string;
  readonly status: string;
  readonly sentiment: string;
  readonly symbol: string;
  readonly tag: string;
}

export interface JournalViewModel {
  readonly notes: readonly Note[];
  readonly filters: RawNoteFilters;
  readonly sort: NoteSort;
  readonly heldSymbols: readonly string[];
  readonly today: string;
  readonly editing?: Note;
  readonly handlers: JournalHandlers;
}

const KIND_LABEL: Record<NoteKind, string> = {
  thesis: 'Thesis', observation: 'Observation', risk: 'Risk', catalyst: 'Catalyst',
  question: 'Question', decision: 'Decision', lesson: 'Lesson',
};

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function journalView(vm: JournalViewModel): HTMLElement {
  return h('main', { class: 'layout' },
    insightsPanel(vm),
    composer(vm),
    filterBar(vm),
    noteList(vm),
  );
}

// ----------------------------------------------------------------- insights

function insightsPanel(vm: JournalViewModel): HTMLElement {
  const summary = summarizeNotes(vm.notes);
  const stale = staleNotes(vm.notes, { days: 30, now: new Date(`${vm.today}T12:00:00Z`) });
  const due = dueForReview(vm.notes, vm.today);
  const gaps = coverageGaps(vm.notes, vm.heldSymbols);

  const stance = summary.netSentiment;
  const stanceLabel = stance > 0.15 ? 'Net bullish' : stance < -0.15 ? 'Net bearish' : 'Balanced';
  const stanceTone = stance > 0.15 ? 'pos' : stance < -0.15 ? 'neg' : 'flat';

  return h('section', { class: 'hero research-hero' },
    h('div', { class: 'hero-label' }, 'Journal · insights'),
    h('div', { class: 'research-headline' },
      `${summary.active} active ${summary.active === 1 ? 'note' : 'notes'} · `,
      h('span', { class: stanceTone }, stanceLabel),
    ),
    h('div', { class: 'kpi-grid journal-kpis' },
      kpi('Total notes', String(summary.total), 'flat'),
      kpi('Open theses', String(summary.byKind.thesis), 'flat'),
      kpi('Open risks', String(summary.byKind.risk), summary.byKind.risk > 0 ? 'neg' : 'flat'),
      kpi('Avg conviction', summary.avgConviction ? summary.avgConviction.toFixed(1) : '—', 'flat'),
      kpi('Net stance', formatPct(stance, 0), stanceTone),
      kpi('Lessons logged', String(summary.byKind.lesson), 'flat'),
    ),
    (due.length > 0 || stale.length > 0 || gaps.length > 0)
      ? h('div', { class: 'nudges' },
          due.length > 0
            ? nudge('warning', `${due.length} ${due.length === 1 ? 'note is' : 'notes are'} due for review`,
                due.map((n) => n.title).slice(0, 3).join(' · '))
            : null,
          stale.length > 0
            ? nudge('serious', `${stale.length} active ${stale.length === 1 ? 'note' : 'notes'} gone stale (30d+)`,
                stale.map((n) => n.title).slice(0, 3).join(' · '))
            : null,
          gaps.length > 0
            ? nudge('critical', `You hold ${gaps.length} ${gaps.length === 1 ? 'name' : 'names'} with no written thesis`,
                gaps.map((sym) =>
                  h('button', { class: 'gap-chip', onClick: () => vm.handlers.onComposeFor(sym) }, sym)))
            : null,
        )
      : h('p', { class: 'fineprint' }, 'No reviews due, nothing stale, and every holding has a thesis. Tidy.'),
  );
}

function kpi(label: string, value: string, tone: string): HTMLElement {
  return h('div', { class: 'kpi' },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: `kpi-value ${tone}` }, value),
  );
}

function nudge(sev: string, title: string, detail: string | HTMLElement[]): HTMLElement {
  return h('div', { class: `nudge ${sev}` },
    h('div', { class: 'nudge-title' }, title),
    Array.isArray(detail)
      ? h('div', { class: 'nudge-chips' }, ...detail)
      : h('div', { class: 'nudge-detail' }, detail),
  );
}

// ------------------------------------------------------------------ composer

function composer(vm: JournalViewModel): HTMLElement {
  const e = vm.editing;
  const val = <K extends keyof Note>(k: K, fallback: string): string =>
    e && e[k] !== undefined ? String(e[k]) : fallback;

  const symbolOptions = h('datalist', { id: 'note-symbols' },
    ...EGX_INSTRUMENTS.map((i) => h('option', { value: i.symbol }, i.name)));

  const select = (name: string, options: readonly string[], selected: string): HTMLElement =>
    h('select', { id: `note-${name}`, name },
      ...options.map((o) => h('option', { value: o, selected: o === selected }, cap(o))));

  const form = h('form', { class: 'note-form' },
    h('input', { type: 'hidden', name: 'id', value: e?.id ?? '' }),

    h('div', { class: 'note-form-top' },
      h('div', { class: 'field grow' },
        h('label', { for: 'note-title' }, 'Title'),
        h('input', { id: 'note-title', name: 'title', required: true,
          placeholder: 'e.g. CIB: cheap, liquid, benefits from high rates', value: val('title', '') }),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-kind' }, 'Kind'),
        select('kind', NOTE_KINDS, e?.kind ?? 'thesis'),
      ),
    ),

    h('div', { class: 'field' },
      h('label', { for: 'note-body' }, 'Insight / reasoning'),
      h('textarea', { id: 'note-body', name: 'body', rows: '4',
        placeholder: 'What do you believe, and why? What would change your mind?' }, val('body', '')),
    ),

    h('div', { class: 'note-form-grid' },
      h('div', { class: 'field' },
        h('label', { for: 'note-symbol' }, 'Symbol (optional)'),
        h('input', { id: 'note-symbol', name: 'symbol', list: 'note-symbols',
          placeholder: 'COMI', autocomplete: 'off', value: val('symbol', '') }),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-sentiment' }, 'Sentiment'),
        select('sentiment', SENTIMENTS, e?.sentiment ?? 'neutral'),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-conviction' }, 'Conviction'),
        h('select', { id: 'note-conviction', name: 'conviction' },
          ...[1, 2, 3, 4, 5].map((c) =>
            h('option', { value: String(c), selected: String(c) === val('conviction', '3') },
              `${c} · ${['—', 'low', 'medium', 'high', 'very high', 'max'][c]}`))),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-horizon' }, 'Horizon'),
        select('horizon', HORIZONS, e?.horizon ?? 'medium'),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-status' }, 'Status'),
        select('status', NOTE_STATUSES, e?.status ?? 'open'),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-review' }, 'Review on (optional)'),
        h('input', { id: 'note-review', name: 'reviewOn', type: 'date', value: e?.reviewOn ?? '' }),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-target' }, 'Target (EGP, optional)'),
        h('input', { id: 'note-target', name: 'targetPrice', type: 'number', step: '0.001', min: '0',
          value: e?.targetPrice !== undefined ? formatPrice(e.targetPrice) : '' }),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'note-stop' }, 'Stop (EGP, optional)'),
        h('input', { id: 'note-stop', name: 'stopPrice', type: 'number', step: '0.001', min: '0',
          value: e?.stopPrice !== undefined ? formatPrice(e.stopPrice) : '' }),
      ),
      h('div', { class: 'field grow' },
        h('label', { for: 'note-tags' }, 'Tags (comma-separated)'),
        h('input', { id: 'note-tags', name: 'tags', placeholder: 'banks, rates, macro',
          value: e ? e.tags.join(', ') : '' }),
      ),
    ),

    h('div', { class: 'button-row' },
      h('button', { class: 'btn primary', type: 'submit' }, e ? 'Save changes' : 'Add note'),
      e ? h('button', { class: 'btn', type: 'button', onClick: vm.handlers.onCancelEdit }, 'Cancel') : null,
    ),
    symbolOptions,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    vm.handlers.onSave(form);
  });

  return h('section', { class: `card note-composer ${e ? 'editing' : ''}` },
    h('h2', { class: 'card-title' }, e ? `Editing note` : 'New note'),
    form,
  );
}

// ----------------------------------------------------------------- filters

function filterBar(vm: JournalViewModel): HTMLElement {
  const { handlers, filters } = vm;
  const tags = tagsIn(vm.notes);

  const sel = (name: keyof RawNoteFilters, label: string, options: [string, string][]): HTMLElement =>
    h('div', { class: 'field' },
      h('label', {}, label),
      h('select', { onChange: (e: Event) => handlers.onFilter({ [name]: (e.target as HTMLSelectElement).value }) },
        ...options.map(([v, l]) => h('option', { value: v, selected: filters[name] === v }, l))));

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Filter & sort'),
    h('div', { class: 'note-filters' },
      h('div', { class: 'field grow' },
        h('label', {}, 'Search'),
        h('input', { type: 'search', placeholder: 'title, text, or tag', value: filters.search,
          onInput: (e: Event) => handlers.onFilter({ search: (e.target as HTMLInputElement).value }) })),
      sel('kind', 'Kind', [['all', 'All kinds'], ...NOTE_KINDS.map((k) => [k, KIND_LABEL[k]] as [string, string])]),
      sel('status', 'Status', [['all', 'All'], ['active', 'Active only'],
        ...NOTE_STATUSES.map((s) => [s, cap(s)] as [string, string])]),
      sel('sentiment', 'Sentiment', [['all', 'All'], ...SENTIMENTS.map((s) => [s, cap(s)] as [string, string])]),
      sel('tag', 'Tag', [['', 'All tags'], ...tags.map((t) => [t, t] as [string, string])]),
      h('div', { class: 'field' },
        h('label', {}, 'Sort by'),
        h('select', { onChange: (e: Event) => handlers.onSort((e.target as HTMLSelectElement).value as NoteSort) },
          ...([['updated', 'Recently updated'], ['created', 'Newest'], ['conviction', 'Conviction'],
            ['symbol', 'Symbol']] as [NoteSort, string][]).map(([v, l]) =>
            h('option', { value: v, selected: vm.sort === v }, l)))),
    ),
  );
}

// ------------------------------------------------------------------ list

function noteList(vm: JournalViewModel): HTMLElement {
  const filtered = sortNotes(filterNotes(vm.notes, toFilters(vm.filters)), vm.sort);

  if (vm.notes.length === 0) {
    return h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Notes'),
      h('p', { class: 'muted' },
        'No notes yet. Start with a thesis for something you hold — what you believe, and what would change your mind.'));
  }

  if (filtered.length === 0) {
    return h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Notes'),
      h('p', { class: 'muted' }, 'No notes match these filters.'));
  }

  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, `Notes (${filtered.length})`),
    h('div', { class: 'note-grid' }, ...filtered.map((n) => noteCard(vm, n))),
  );
}

function noteCard(vm: JournalViewModel, n: Note): HTMLElement {
  const sentimentTone = n.sentiment === 'bullish' ? 'pos' : n.sentiment === 'bearish' ? 'neg' : 'flat';

  return h('article', { class: `note-card kind-${n.kind}` },
    h('div', { class: 'note-card-head' },
      h('span', { class: `note-kind kind-${n.kind}` }, KIND_LABEL[n.kind]),
      n.symbol ? h('span', { class: 'note-symbol' }, n.symbol) : null,
      h('span', { class: `note-status status-${n.status}` }, cap(n.status)),
      h('span', { class: 'note-spacer' }),
      h('button', { class: 'btn icon', title: 'Edit', 'aria-label': `Edit ${n.title}`,
        onClick: () => vm.handlers.onEdit(n.id) }, '✎'),
      h('button', { class: 'btn icon', title: 'Delete', 'aria-label': `Delete ${n.title}`,
        onClick: () => vm.handlers.onDelete(n.id) }, '×'),
    ),
    h('h3', { class: 'note-title' }, n.title),
    n.body ? h('p', { class: 'note-body' }, n.body) : null,
    h('div', { class: 'note-meta' },
      h('span', { class: `note-chip ${sentimentTone}` }, cap(n.sentiment)),
      h('span', { class: 'note-chip' }, '●'.repeat(n.conviction) + '○'.repeat(5 - n.conviction)),
      h('span', { class: 'note-chip' }, cap(n.horizon)),
      n.targetPrice !== undefined ? h('span', { class: 'note-chip' }, `🎯 ${formatPrice(n.targetPrice)}`) : null,
      n.stopPrice !== undefined ? h('span', { class: 'note-chip' }, `⛔ ${formatPrice(n.stopPrice)}`) : null,
      n.reviewOn ? h('span', { class: `note-chip ${n.reviewOn <= vm.today ? 'due' : ''}` }, `↻ ${n.reviewOn}`) : null,
    ),
    n.tags.length > 0
      ? h('div', { class: 'note-tags' }, ...n.tags.map((t) => h('span', { class: 'tag' }, t)))
      : null,
    h('div', { class: 'note-foot' }, `updated ${n.updatedAt.slice(0, 10)}`),
  );
}

function toFilters(raw: RawNoteFilters): NoteFilters {
  return {
    ...(raw.search ? { search: raw.search } : {}),
    ...(raw.symbol ? { symbol: raw.symbol } : {}),
    ...(raw.tag ? { tag: raw.tag } : {}),
    kind: (raw.kind || 'all') as NoteKind | 'all',
    status: (raw.status || 'all') as NoteStatus | 'all' | 'active',
    sentiment: (raw.sentiment || 'all') as Sentiment | 'all',
  };
}

import { graph } from './meta.js';

/**
 * Meta Ad Library research.
 *
 * Reads the public Ad Library through Meta's official `ads_archive` endpoint —
 * the sanctioned path, not a scraper pointed at facebook.com. That choice sets
 * the boundaries of what this module can do:
 *
 *   - it CAN tell you how long every ad has been running, which is what
 *     separates a proven winner from something launched yesterday;
 *   - it CAN export everything to a spreadsheet;
 *   - it CANNOT hand back the image or video files. `ads_archive` returns ad
 *     text, dates and a snapshot link, never the media itself. Bulk-downloading
 *     creative requires scraping the Ad Library web page, which breaks Meta's
 *     terms — so this module links to each ad instead of pulling the files.
 */

const DAY = 86400000;

/** An ad running this long has survived enough optimisation to be worth copying. */
export const WINNER_DAYS = 30;

const FIELDS = [
  'id', 'page_id', 'page_name',
  'ad_creative_bodies', 'ad_creative_link_titles', 'ad_creative_link_descriptions',
  'ad_creation_time', 'ad_delivery_start_time', 'ad_delivery_stop_time',
  'ad_snapshot_url', 'currency', 'publisher_platforms', 'languages',
].join(',');

const firstOf = (v) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Ad Library timestamps arrive as unix seconds or ISO strings depending on field. */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Flattens one Ad Library row and works out how long it has been live. When an
 * ad has stopped, the run length is measured to its stop date rather than to
 * today, so a finished 90-day winner still reads as a 90-day winner.
 */
export function normaliseLibraryAd(row = {}, now = Date.now()) {
  const start = toMillis(row.ad_delivery_start_time);
  const stop = toMillis(row.ad_delivery_stop_time);
  const ranTo = stop && stop < now ? stop : now;
  const daysRunning = start ? Math.max(0, Math.floor((ranTo - start) / DAY)) : null;

  return {
    adId: String(row.id),
    pageId: row.page_id != null ? String(row.page_id) : null,
    pageName: row.page_name || null,
    body: firstOf(row.ad_creative_bodies),
    linkTitle: firstOf(row.ad_creative_link_titles),
    linkDescription: firstOf(row.ad_creative_link_descriptions),
    creationTime: toMillis(row.ad_creation_time),
    deliveryStart: start,
    deliveryStop: stop,
    daysRunning,
    isWinner: daysRunning != null && daysRunning >= WINNER_DAYS,
    stillActive: !stop || stop > now,
    snapshotUrl: row.ad_snapshot_url || (row.id ? `https://www.facebook.com/ads/library/?id=${row.id}` : null),
    currency: row.currency || null,
    platforms: Array.isArray(row.publisher_platforms) ? row.publisher_platforms.join(', ') : null,
    languages: Array.isArray(row.languages) ? row.languages.join(', ') : null,
  };
}

/**
 * One Ad Library query. Deliberately single-page and capped: this is a research
 * tool for a watchlist of competitors, not a crawler, and Meta's terms draw the
 * same line.
 */
export async function searchLibrary({
  searchTerms = null,
  pageIds = null,
  countries = ['EG'],
  activeStatus = 'ACTIVE',
  limit = 50,
} = {}) {
  if (!searchTerms && (!pageIds || !pageIds.length)) {
    throw new Error('Give the Ad Library something to search: a keyword, or at least one page.');
  }

  const params = {
    ad_reached_countries: JSON.stringify(countries),
    ad_active_status: activeStatus,
    ad_type: 'ALL',
    fields: FIELDS,
    limit: Math.min(Math.max(limit, 1), 50),
  };
  if (searchTerms) params.search_terms = searchTerms;
  if (pageIds?.length) params.search_page_ids = JSON.stringify(pageIds.map(String));

  const res = await graph('ads_archive', params);
  const now = Date.now();
  return {
    ads: (res.data || []).map((row) => normaliseLibraryAd(row, now)),
    estimatedTotal: res.data?.length ?? 0,
  };
}

/**
 * A watchlist worth starting from: Egyptian beauty and cosmetics pages that were
 * actively advertising when this was built. Ad Library page ids are public.
 */
export const SUGGESTED_PAGES = [
  { pageId: '303772256148310', pageName: 'The Beauty Nest' },
  { pageId: '106663252359215', pageName: 'Glorious makeup' },
  { pageId: '239119655957830', pageName: 'A&M beauty' },
  { pageId: '369544486246144', pageName: 'Adalina' },
  { pageId: '271123779421695', pageName: 'Merlla' },
  { pageId: '100837201406793', pageName: 'She' },
  { pageId: '178908815303555', pageName: 'Dr. HANAN Elkahky skin care' },
  { pageId: '108022559064590', pageName: 'بوتيك فراشة' },
];

/** RFC 4180 escaping, with the BOM Excel needs to read Arabic as UTF-8. */
export function toCsv(rows, columns) {
  const cell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.get(r))).join(',')).join('\r\n');
  return `﻿${head}\r\n${body}\r\n`;
}

export const CSV_COLUMNS = [
  { label: 'Page', get: (r) => r.page_name },
  { label: 'Page ID', get: (r) => r.page_id },
  { label: 'Ad ID', get: (r) => r.ad_id },
  { label: 'Days running', get: (r) => r.days_running },
  { label: 'Winner (30d+)', get: (r) => (r.days_running >= WINNER_DAYS ? 'yes' : 'no') },
  { label: 'Still active', get: (r) => (r.still_active ? 'yes' : 'no') },
  { label: 'Started', get: (r) => (r.delivery_start ? new Date(r.delivery_start).toISOString().slice(0, 10) : '') },
  { label: 'Stopped', get: (r) => (r.delivery_stop ? new Date(r.delivery_stop).toISOString().slice(0, 10) : '') },
  { label: 'First seen by us', get: (r) => (r.first_seen ? r.first_seen.slice(0, 10) : '') },
  { label: 'Last seen by us', get: (r) => (r.last_seen ? r.last_seen.slice(0, 10) : '') },
  { label: 'Headline', get: (r) => r.link_title },
  { label: 'Body', get: (r) => r.body },
  { label: 'Platforms', get: (r) => r.platforms },
  { label: 'Currency', get: (r) => r.currency },
  { label: 'Ad link', get: (r) => r.snapshot_url },
];

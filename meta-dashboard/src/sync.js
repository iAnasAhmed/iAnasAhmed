import fs from 'node:fs';
import path from 'node:path';
import { config, hasToken } from './config.js';
import * as meta from './meta.js';
import * as store from './store.js';

const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(`[sync ${new Date().toISOString().slice(11, 19)}]`, ...a);

/**
 * Loads the baseline captured from the live account so the dashboard has real
 * history on first boot, before a token is configured. Seed rows are tagged
 * source='seed' and are overwritten by the first successful live sync.
 */
export function loadSeed() {
  const file = path.join(config.dataDir, 'seed.json');
  if (!fs.existsSync(file)) return { loaded: false, reason: 'no seed file' };
  const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const accountId = seed.accountId;
  if (!store.isEmpty(accountId)) return { loaded: false, reason: 'already populated' };

  const [, iSpend, iImp, iReach, iClicks, iLpv, iRoas] = seed.dailyColumns.map((_, i) => i);
  const rows = seed.daily.map((d) => ({
    dateStart: d[0],
    spend: d[iSpend], impressions: d[iImp], reach: d[iReach], clicks: d[iClicks],
    landingPageViews: d[iLpv],
    // ROAS x spend is exactly revenue; per-day purchase counts arrive with live sync.
    revenue: d[iRoas] ? d[iRoas] * d[iSpend] : 0,
    linkClicks: 0, purchases: 0, addToCart: 0, initiateCheckout: 0,
    viewContent: 0, messagingStarted: 0, leads: 0, videoViews: 0,
  }));
  store.upsertDaily(accountId, 'account', rows, 'seed');

  // Entity-level totals in the baseline are lifetime/90-day sums with no daily
  // breakdown. Spreading them evenly across the period the entity was actually
  // live puts them inside the reporting windows, so campaign and ad set views
  // work before a token exists. They are tagged source='seed' and the first live
  // sync replaces them with exact per-day figures.
  const seedLast = seed.daily[seed.daily.length - 1][0];
  const seedFirst = seed.daily[0][0];
  const dayMs = 86400000;
  const clamp = (iso) => (iso < seedFirst ? seedFirst : iso > seedLast ? seedLast : iso);
  const spread = (totals, startIso, endIso) => {
    const start = clamp((startIso || seedFirst).slice(0, 10));
    const end = clamp((endIso || seedLast).slice(0, 10));
    const from = new Date(`${start}T00:00:00Z`).getTime();
    const to = new Date(`${end}T00:00:00Z`).getTime();
    const n = Math.max(1, Math.round((to - from) / dayMs) + 1);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const date = new Date(from + i * dayMs).toISOString().slice(0, 10);
      const share = {};
      for (const [k, v] of Object.entries(totals)) share[k] = (Number(v) || 0) / n;
      out.push({ dateStart: date, ...share });
    }
    return out;
  };

  for (const c of seed.campaigns || []) {
    store.upsertEntity(accountId, 'campaign', {
      id: c.id, name: c.name, objective: c.objective, status: c.status,
      effective_status: c.effective_status,
      daily_budget: c.daily_budget != null ? c.daily_budget * 100 : null,
      created_time: c.created_time,
    });
    const spent = spread({
      spend: c.spend, impressions: c.impressions, reach: c.reach, clicks: c.clicks,
      purchases: c.purchases || 0, revenue: c.roas ? c.roas * c.spend : 0,
      landingPageViews: c.landingPageViews || 0, messagingStarted: c.messagingStarted || 0,
      linkClicks: 0, addToCart: 0, initiateCheckout: 0, viewContent: 0, leads: 0, videoViews: 0,
    }, c.created_time, c.stop_time);
    store.upsertDaily(accountId, 'campaign',
      spent.map((r) => ({ ...r, campaignId: c.id, campaignName: c.name })), 'seed');
  }

  for (const a of seed.adsets || []) {
    store.upsertEntity(accountId, 'adset', {
      id: a.id, name: a.name, campaign_id: a.campaign_id, parent_id: a.campaign_id,
      status: a.status, effective_status: a.effective_status,
      optimization_goal: a.optimization_goal,
      daily_budget: a.daily_budget != null ? a.daily_budget * 100 : null,
      created_time: a.created_time,
      audience_lower: a.audience_lower, audience_upper: a.audience_upper,
    });
    const rows = spread({
      spend: a.spend, impressions: a.impressions, reach: a.reach,
      clicks: Math.round(((a.ctr || 0) * (a.impressions || 0)) / 100),
      purchases: a.purchases || 0, revenue: a.roas ? a.roas * a.spend : 0,
      messagingStarted: a.messagingStarted || 0,
      linkClicks: 0, addToCart: 0, initiateCheckout: 0, viewContent: 0,
      landingPageViews: 0, leads: 0, videoViews: 0,
    }, a.created_time, null);
    store.upsertDaily(accountId, 'adset',
      rows.map((r) => ({ ...r, adsetId: a.id, adsetName: a.name, campaignId: a.campaign_id })), 'seed');
  }

  for (const a of seed.audiences || []) store.upsertAudience(accountId, a);

  store.setState('seed', { loadedAt: nowIso(), capturedAt: seed.capturedAt, source: 'meta-ads-mcp' });
  store.setState('pixel', seed.pixel || null);
  store.setState('account', {
    id: accountId, name: seed.accountName, currency: seed.currency,
    businessName: seed.businessName, businessId: seed.businessId, fromSeed: true,
  });
  log(`seed loaded: ${rows.length} days, ${(seed.campaigns || []).length} campaigns, ${(seed.audiences || []).length} audiences`);
  return { loaded: true, days: rows.length };
}

/** Fields worth watching for edits between syncs. */
const WATCHED = ['name', 'status', 'effective_status', 'daily_budget', 'lifetime_budget', 'optimization_goal', 'bid_strategy'];

function diffEntities(accountId, level, previous, current) {
  const prev = new Map(previous.map((e) => [String(e.id), e]));
  let changes = 0;
  for (const e of current) {
    const before = prev.get(String(e.id));
    if (!before) {
      store.recordChange(accountId, {
        level, entityId: e.id, entityName: e.name, field: 'created',
        oldValue: null, newValue: e.name, note: `New ${level} appeared`,
      });
      changes += 1;
      continue;
    }
    for (const field of WATCHED) {
      const a = before[field] ?? null;
      // Budgets are stored in major units; Meta returns minor units.
      const raw = e[field] ?? null;
      const b = (field === 'daily_budget' || field === 'lifetime_budget') && raw != null ? Number(raw) / 100 : raw;
      if (a == null && b == null) continue;
      if (String(a) === String(b)) continue;
      store.recordChange(accountId, {
        level, entityId: e.id, entityName: e.name, field,
        oldValue: a, newValue: b,
        note: field.includes('budget') && Number(b) && Number(a)
          ? `Budget ${Number(b) > Number(a) ? 'raised' : 'cut'} ${Math.abs(((Number(b) - Number(a)) / Number(a)) * 100).toFixed(0)}%`
          : null,
      });
      changes += 1;
    }
  }
  return changes;
}

/**
 * One full live pull. Safe to call repeatedly; every write is an upsert keyed on
 * (account, date, level, entity), so re-syncing the same window just refreshes it.
 */
export async function syncAccount(accountId = config.accountId, { days = 120, withEstimates = true } = {}) {
  const startedAt = nowIso();
  const stats = { accountId, days };
  try {
    if (!hasToken()) throw new meta.MetaError('No META_ACCESS_TOKEN configured — running on seeded history only.', { code: 'NO_TOKEN' });

    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const account = await meta.fetchAccount(accountId);
    store.setState('account', {
      id: accountId, name: account.name, currency: account.currency,
      timezone: account.timezone_name, status: account.account_status,
      businessName: account.business_name || account.business?.name || null,
      businessId: account.business?.id || null,
      amountSpent: Number(account.amount_spent || 0) / 100,
      spendCap: account.spend_cap ? Number(account.spend_cap) / 100 : null,
      balance: account.balance ? Number(account.balance) / 100 : null,
      disableReason: account.disable_reason ?? null,
      fromSeed: false,
    });

    // Daily account series - the spine of every trend and drift detector.
    const accountDaily = await meta.fetchInsights(accountId, { level: 'account', since, until, timeIncrement: 1 });
    store.upsertDaily(accountId, 'account', accountDaily, 'live');
    stats.accountDays = accountDaily.length;

    // Per-entity daily series.
    for (const level of ['campaign', 'adset']) {
      const rows = await meta.fetchInsights(accountId, { level, since, until, timeIncrement: 1 });
      store.upsertDaily(accountId, level, rows, 'live');
      stats[`${level}Rows`] = rows.length;
    }
    // Ads: a shorter window, since ad-level daily data grows fast and only the
    // recent window drives creative decisions.
    const adSince = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const adRows = await meta.fetchInsights(accountId, { level: 'ad', since: adSince, until, timeIncrement: 1 });
    store.upsertDaily(accountId, 'ad', adRows, 'live');
    stats.adRows = adRows.length;

    // Configuration, with change detection against the previous sync.
    const prevCampaigns = store.getEntities(accountId, 'campaign');
    const prevAdsets = store.getEntities(accountId, 'adset');

    const campaigns = await meta.fetchCampaigns(accountId);
    for (const c of campaigns) store.upsertEntity(accountId, 'campaign', c);
    stats.campaigns = campaigns.length;

    const adsets = await meta.fetchAdsets(accountId);
    for (const a of adsets) {
      store.upsertEntity(accountId, 'adset', {
        ...a, parent_id: a.campaign_id,
        learning_stage: a.learning_stage_info?.status ?? null,
      });
    }
    stats.adsets = adsets.length;

    const ads = await meta.fetchAds(accountId);
    for (const ad of ads) store.upsertEntity(accountId, 'ad', { ...ad, parent_id: ad.adset_id });
    stats.ads = ads.length;

    stats.changes = diffEntities(accountId, 'campaign', prevCampaigns, campaigns)
      + diffEntities(accountId, 'adset', prevAdsets, adsets.map((a) => ({ ...a, parent_id: a.campaign_id })));

    // Audience size estimates for live ad sets - this is what exposes a pool
    // too small to absorb its budget.
    if (withEstimates) {
      let estimated = 0;
      for (const a of adsets.filter((x) => x.effective_status === 'ACTIVE')) {
        try {
          const est = await meta.fetchDeliveryEstimate(a.id);
          if (est) {
            store.upsertEntity(accountId, 'adset', {
              ...a, parent_id: a.campaign_id,
              learning_stage: a.learning_stage_info?.status ?? null,
              audience_lower: est.estimate_mau_lower_bound ?? null,
              audience_upper: est.estimate_mau_upper_bound ?? null,
            });
            estimated += 1;
          }
        } catch { /* estimates are best-effort; a failure must not fail the sync */ }
      }
      stats.estimates = estimated;
    }

    const audiences = await meta.fetchCustomAudiences(accountId);
    for (const a of audiences) store.upsertAudience(accountId, a);
    stats.audiences = audiences.length;

    try {
      const activities = await meta.fetchActivities(accountId, { since });
      for (const act of activities) store.upsertActivity(accountId, act);
      stats.activities = activities.length;
    } catch (e) { stats.activitiesError = e.message; }

    if (config.pixelId) {
      try {
        const pixel = await meta.fetchPixelStats(config.pixelId);
        const existing = store.getState('pixel') || {};
        store.setState('pixel', { ...existing, ...pixel });
      } catch (e) { stats.pixelError = e.message; }
    }

    store.setState('lastSync', { at: nowIso(), ok: true, stats });
    store.recordSync({ startedAt, finishedAt: nowIso(), ok: true, stats });
    log(`ok — ${stats.accountDays} days, ${stats.campaigns} campaigns, ${stats.adsets} ad sets, ${stats.audiences} audiences, ${stats.changes} changes`);
    return { ok: true, stats };
  } catch (err) {
    const detail = { message: err.message, code: err.code, subcode: err.subcode, edge: err.edge };
    store.setState('lastSync', { at: nowIso(), ok: false, error: detail });
    store.recordSync({ startedAt, finishedAt: nowIso(), ok: false, error: err.message, stats });
    log('failed —', err.message);
    return { ok: false, error: detail, stats };
  }
}

let timer = null;
const listeners = new Set();

export const onSync = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function runSync(opts) {
  const result = await syncAccount(config.accountId, opts);
  for (const fn of listeners) { try { fn(result); } catch { /* a bad listener must not break the loop */ } }
  return result;
}

export function startScheduler() {
  if (timer) clearInterval(timer);
  const ms = Math.max(config.syncIntervalMinutes, 1) * 60000;
  timer = setInterval(() => { runSync().catch((e) => log('scheduled sync threw', e.message)); }, ms);
  log(`scheduler on — every ${config.syncIntervalMinutes} min`);
  return () => clearInterval(timer);
}

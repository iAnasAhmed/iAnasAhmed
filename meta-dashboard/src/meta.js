import { config, hasToken } from './config.js';

const BASE = () => `https://graph.facebook.com/${config.apiVersion}`;

export class MetaError extends Error {
  constructor(message, { status, code, subcode, type, fbtrace, edge } = {}) {
    super(message);
    this.name = 'MetaError';
    Object.assign(this, { status, code, subcode, type, fbtrace, edge });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Meta error codes that are worth retrying rather than surfacing. */
const RETRYABLE = new Set([1, 2, 4, 17, 32, 341, 613]);

/**
 * One GET against the Graph API. Retries rate limits and transient failures with
 * exponential backoff, then throws a MetaError carrying Meta's own diagnostics.
 */
export async function graph(edge, params = {}, { attempt = 0, maxAttempts = 5 } = {}) {
  if (!hasToken()) {
    throw new MetaError('No META_ACCESS_TOKEN configured. Copy .env.example to .env and add a token.', { code: 'NO_TOKEN' });
  }
  const url = new URL(`${BASE()}/${edge.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  url.searchParams.set('access_token', config.accessToken);

  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (netErr) {
    if (attempt < maxAttempts) {
      await sleep(2 ** attempt * 1000);
      return graph(edge, params, { attempt: attempt + 1, maxAttempts });
    }
    throw new MetaError(`Network failure calling ${edge}: ${netErr.message}`, { edge });
  }

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

  if (!res.ok || body.error) {
    const err = body.error || {};
    const retryable = RETRYABLE.has(err.code) || res.status >= 500 || res.status === 429;
    if (retryable && attempt < maxAttempts) {
      // Meta rate limits recover on the order of minutes; back off hard but bounded.
      await sleep(Math.min(2 ** attempt * 2000, 30000));
      return graph(edge, params, { attempt: attempt + 1, maxAttempts });
    }
    throw new MetaError(err.message || `Graph API ${res.status} on ${edge}`, {
      status: res.status, code: err.code, subcode: err.error_subcode,
      type: err.type, fbtrace: err.fbtrace_id, edge,
    });
  }
  return body;
}

/** Walk `paging.next` until exhausted or `limitPages` reached. */
export async function graphAll(edge, params = {}, { limitPages = 25 } = {}) {
  const out = [];
  let page = await graph(edge, { limit: 200, ...params });
  out.push(...(page.data || []));
  let pages = 1;
  while (page?.paging?.next && pages < limitPages) {
    const next = new URL(page.paging.next);
    // Re-issue through `graph` so retry/backoff still applies.
    const nextEdge = next.pathname.replace(new RegExp(`^/${config.apiVersion}/`), '');
    const nextParams = Object.fromEntries(next.searchParams.entries());
    delete nextParams.access_token;
    page = await graph(nextEdge, nextParams);
    out.push(...(page.data || []));
    pages += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Action normalisation
// ---------------------------------------------------------------------------

/** Preference order matters: pixel-attributed first, then omni, then generic. */
const ACTION_MAP = {
  purchases: ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'],
  addToCart: ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart', 'add_to_cart'],
  initiateCheckout: ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout', 'initiate_checkout'],
  viewContent: ['offsite_conversion.fb_pixel_view_content', 'omni_view_content', 'view_content'],
  landingPageViews: ['landing_page_view'],
  linkClicks: ['link_click'],
  messagingStarted: ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'],
  leads: ['lead', 'offsite_conversion.fb_pixel_lead'],
  pageEngagement: ['page_engagement'],
  postEngagement: ['post_engagement'],
  videoViews: ['video_view'],
  profileVisits: ['profile_visit_view'],
};

function pickAction(arr, keys) {
  if (!Array.isArray(arr)) return 0;
  for (const key of keys) {
    const hit = arr.find((a) => a.action_type === key);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Flattens one Meta insights row into the shape the rest of the app speaks.
 * Every derived rate is recomputed from raw counts so it stays correct after
 * we aggregate rows across days or entities.
 */
export function normaliseInsight(row = {}) {
  const spend = n(row.spend);
  const impressions = n(row.impressions);
  const reach = n(row.reach);
  const clicks = n(row.clicks);

  const purchases = pickAction(row.actions, ACTION_MAP.purchases);
  const revenue = pickAction(row.action_values, ACTION_MAP.purchases);
  const addToCart = pickAction(row.actions, ACTION_MAP.addToCart);
  const initiateCheckout = pickAction(row.actions, ACTION_MAP.initiateCheckout);
  const viewContent = pickAction(row.actions, ACTION_MAP.viewContent);
  const landingPageViews = pickAction(row.actions, ACTION_MAP.landingPageViews);
  const linkClicks = n(row.inline_link_clicks) || pickAction(row.actions, ACTION_MAP.linkClicks);
  const messagingStarted = pickAction(row.actions, ACTION_MAP.messagingStarted);
  const leads = pickAction(row.actions, ACTION_MAP.leads);
  const videoViews = pickAction(row.actions, ACTION_MAP.videoViews);
  const postEngagement = pickAction(row.actions, ACTION_MAP.postEngagement);
  const profileVisits = pickAction(row.actions, ACTION_MAP.profileVisits);

  return {
    dateStart: row.date_start || null,
    dateStop: row.date_stop || null,
    entityId: row.campaign_id || row.adset_id || row.ad_id || row.account_id || null,
    campaignId: row.campaign_id || null,
    campaignName: row.campaign_name || null,
    adsetId: row.adset_id || null,
    adsetName: row.adset_name || null,
    adId: row.ad_id || null,
    adName: row.ad_name || null,
    objective: row.objective || null,
    optimizationGoal: row.optimization_goal || null,
    attributionSetting: row.attribution_setting || null,
    qualityRanking: row.quality_ranking || null,
    engagementRanking: row.engagement_rate_ranking || null,
    conversionRanking: row.conversion_rate_ranking || null,

    spend, impressions, reach, clicks,
    frequency: reach > 0 ? impressions / reach : 0,
    purchases, revenue, addToCart, initiateCheckout, viewContent,
    landingPageViews, linkClicks, messagingStarted, leads,
    videoViews, postEngagement, profileVisits,

    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    linkCtr: impressions > 0 ? (linkClicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    roas: spend > 0 ? revenue / spend : 0,
    aov: purchases > 0 ? revenue / purchases : 0,
    costPerLinkClick: linkClicks > 0 ? spend / linkClicks : 0,
    costPerMessage: messagingStarted > 0 ? spend / messagingStarted : 0,
    lpvRate: linkClicks > 0 ? (landingPageViews / linkClicks) * 100 : 0,
    atcRate: viewContent > 0 ? (addToCart / viewContent) * 100 : 0,
    checkoutRate: addToCart > 0 ? (initiateCheckout / addToCart) * 100 : 0,
    purchaseRate: initiateCheckout > 0 ? (purchases / initiateCheckout) * 100 : 0,
  };
}

const INSIGHT_FIELDS = [
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpc', 'cpm',
  'inline_link_clicks', 'actions', 'action_values', 'objective',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'attribution_setting', 'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking',
].join(',');

// ---------------------------------------------------------------------------
// High level fetchers
// ---------------------------------------------------------------------------

export async function fetchAccount(accountId = config.accountId) {
  return graph(`act_${accountId}`, {
    fields: [
      'id', 'account_id', 'name', 'account_status', 'currency', 'timezone_name',
      'amount_spent', 'balance', 'spend_cap', 'business_name', 'business',
      'disable_reason', 'funding_source_details', 'min_daily_budget',
    ].join(','),
  });
}

/**
 * Insights at any level. `timeIncrement` of 1 returns one row per day, which is
 * what feeds every trend chart and the drift detectors.
 */
export async function fetchInsights(accountId, { level = 'account', datePreset, since, until, timeIncrement, filtering, limit = 500 } = {}) {
  const params = { level, fields: INSIGHT_FIELDS, limit };
  if (since && until) params.time_range = { since, until };
  else params.date_preset = datePreset || 'last_30d';
  if (timeIncrement) params.time_increment = timeIncrement;
  if (filtering) params.filtering = filtering;
  const rows = await graphAll(`act_${accountId}/insights`, params);
  return rows.map(normaliseInsight);
}

export async function fetchCampaigns(accountId = config.accountId) {
  return graphAll(`act_${accountId}/campaigns`, {
    fields: [
      'id', 'name', 'objective', 'status', 'effective_status', 'buying_type',
      'daily_budget', 'lifetime_budget', 'bid_strategy', 'created_time',
      'updated_time', 'start_time', 'stop_time', 'special_ad_categories',
    ].join(','),
    // Archived campaigns bloat the payload without informing today's decisions.
    effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED']),
  });
}

export async function fetchAdsets(accountId = config.accountId) {
  return graphAll(`act_${accountId}/adsets`, {
    fields: [
      'id', 'name', 'campaign_id', 'status', 'effective_status', 'optimization_goal',
      'billing_event', 'bid_strategy', 'daily_budget', 'lifetime_budget',
      'created_time', 'updated_time', 'start_time', 'end_time',
      'destination_type', 'attribution_spec', 'promoted_object', 'targeting',
      'learning_stage_info',
    ].join(','),
    effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']),
  });
}

export async function fetchAds(accountId = config.accountId) {
  return graphAll(`act_${accountId}/ads`, {
    fields: [
      'id', 'name', 'adset_id', 'campaign_id', 'status', 'effective_status',
      'created_time', 'updated_time', 'creative{id,name,thumbnail_url,object_type,title,body}',
    ].join(','),
    effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'WITH_ISSUES', 'ADSET_PAUSED', 'CAMPAIGN_PAUSED']),
  });
}

export async function fetchCustomAudiences(accountId = config.accountId) {
  return graphAll(`act_${accountId}/customaudiences`, {
    fields: [
      'id', 'name', 'description', 'subtype', 'approximate_count_lower_bound',
      'approximate_count_upper_bound', 'delivery_status', 'operation_status',
      'time_created', 'time_updated', 'retention_days', 'rule_aggregation',
      'lookalike_spec', 'data_source', 'customer_file_source',
    ].join(','),
  });
}

/** Meta's own estimate of how many accounts an ad set's targeting can reach. */
export async function fetchDeliveryEstimate(adsetId) {
  const res = await graph(`${adsetId}/delivery_estimate`, {
    fields: 'estimate_dau,estimate_mau_lower_bound,estimate_mau_upper_bound,estimate_ready',
  });
  return res?.data?.[0] || null;
}

/** The account change log - who changed what, when. Powers the History tab. */
export async function fetchActivities(accountId = config.accountId, { since, until } = {}) {
  const params = {
    fields: 'event_type,event_time,extra_data,object_id,object_name,actor_name,translated_event_type',
    limit: 200,
  };
  if (since) params.since = since;
  if (until) params.until = until;
  return graphAll(`act_${accountId}/activities`, params, { limitPages: 5 });
}

export async function fetchPixelStats(pixelId = config.pixelId) {
  if (!pixelId) return null;
  return graph(`${pixelId}`, {
    fields: 'id,name,last_fired_time,is_created_by_business,data_use_setting,first_party_cookie_status',
  });
}

/** Verifies the token works and reports what it can see. */
export async function ping() {
  const me = await graph('me', { fields: 'id,name' });
  const account = await fetchAccount();
  return { user: me, account };
}

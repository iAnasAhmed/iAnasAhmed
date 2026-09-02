import { config, breakEvenRoas, hasToken } from './config.js';
import * as store from './store.js';
import { aggregate, windowRows, compareWindows, detectGaps, seriesWithRates, rolling, byMonth, addDays } from './engine/metrics.js';
import { runMentor, scoreAccount, scoreVerdict, ruleCount } from './engine/mentor.js';
import { buildAudienceModel, newCustomerPath } from './engine/audiences.js';
import { deriveEconomics, allocateBudget, buildPlan, scenarios, forecast } from './engine/planner.js';

const accountId = () => config.accountId;

function entityMetrics(accountId_, level, since, until) {
  const rows = store.getDaily(accountId_, { level, since, until });
  const byEntity = new Map();
  for (const r of rows) {
    if (!byEntity.has(r.entity_id)) byEntity.set(r.entity_id, []);
    byEntity.get(r.entity_id).push(r);
  }
  const out = new Map();
  for (const [id, rs] of byEntity) out.set(id, { ...aggregate(rs), days: rs.filter((r) => Number(r.spend) > 0).length || rs.length });
  return out;
}

/**
 * Assembles everything the rules and views read from. Built once per request so
 * every tab sees the same numbers.
 */
export function buildContext({ days = 28 } = {}) {
  const acct = accountId();
  const account = store.getState('account') || { id: acct, currency: 'EGP', name: acct };
  const pixel = store.getState('pixel') || null;
  const daily = store.getDaily(acct, { level: 'account' });
  const last = daily.length ? daily[daily.length - 1].date : new Date().toISOString().slice(0, 10);

  const since28 = addDays(last, -27);

  // Account-level aggregates stay exactly as reported - spend and revenue here
  // are authoritative and are never patched from another level.
  const agg7 = aggregate(windowRows(daily, 7));
  const agg28 = aggregate(windowRows(daily, 28));
  const agg90 = aggregate(windowRows(daily, 90));
  const aggAll = aggregate(daily);

  /**
   * The pre-token baseline has no per-day purchase counts at account level, so
   * cost per purchase and average order value cannot be computed from the
   * windows above. Campaign totals do carry them, and summing every campaign row
   * reproduces the exact lifetime figures, so those become the fallback the
   * planner reads until a live sync fills in daily conversions. Clearly labelled
   * rather than silently blended into the windowed numbers.
   */
  const allCampaignRows = store.getDaily(acct, { level: 'campaign' });
  // Only campaigns that actually produced purchases belong in a cost-per-purchase
  // figure. This account also runs messaging campaigns for the photography studio
  // and the dress line, which spend without ever recording a sale - folding their
  // spend in would inflate cost per purchase for the shop by roughly 2x.
  const sellingCampaignIds = new Set(
    Object.entries(allCampaignRows.reduce((acc, r) => {
      acc[r.entity_id] = (acc[r.entity_id] || 0) + Number(r.purchases || 0);
      return acc;
    }, {})).filter(([, purchases]) => purchases > 0).map(([id]) => id),
  );
  const campaignLifetime = aggregate(allCampaignRows.filter((r) => sellingCampaignIds.has(r.entity_id)));
  const fallbackEconomics = campaignLifetime.purchases > 0
    ? {
      aov: campaignLifetime.aov, cpa: campaignLifetime.cpa, roas: campaignLifetime.roas,
      purchases: campaignLifetime.purchases, spend: campaignLifetime.spend,
      sellingCampaigns: sellingCampaignIds.size,
      source: `lifetime totals across ${sellingCampaignIds.size} selling campaigns (baseline)`,
    }
    : null;

  const campaignMetrics = entityMetrics(acct, 'campaign', since28, last);
  const adsetMetrics = entityMetrics(acct, 'adset', since28, last);

  const campaigns = store.getEntities(acct, 'campaign').map((c) => ({
    ...c, metrics: campaignMetrics.get(c.id) || aggregate([]),
  }));
  const adsets = store.getEntities(acct, 'adset').map((a) => ({
    ...a, metrics: adsetMetrics.get(a.id) || aggregate([]),
  }));
  const audiences = store.getAudiences(acct);

  const aov = agg28.aov || agg90.aov || aggAll.aov || 0;

  return {
    accountId: acct, account, currency: account.currency || 'EGP', pixelId: config.pixelId, pixel,
    daily, last,
    windowStart60: addDays(last, -59),
    windowStart28: since28,
    agg7, agg28, agg90, aggAll,
    compare7: compareWindows(daily, 7),
    compare28: compareWindows(daily, 28),
    campaigns, adsets, audiences,
    business: config.business, breakEvenRoas: breakEvenRoas(), aov,
    fallbackEconomics,
    days,
  };
}

// ---------------------------------------------------------------------------
// Endpoint payloads
// ---------------------------------------------------------------------------

export function status() {
  const last = store.getState('lastSync');
  const seed = store.getState('seed');
  const account = store.getState('account');
  const bounds = store.getDateBounds(accountId());
  return {
    ok: true,
    connected: hasToken(),
    tokenConfigured: hasToken(),
    account, seed, lastSync: last, bounds,
    apiVersion: config.apiVersion,
    syncIntervalMinutes: config.syncIntervalMinutes,
    ruleCount: ruleCount(),
    business: config.business,
    breakEvenRoas: breakEvenRoas(),
    recentSyncs: store.getRecentSyncs(8),
    dataMode: hasToken() ? 'live' : 'seeded-baseline',
  };
}

export function overview({ days = 28 } = {}) {
  const ctx = buildContext({ days });
  const window = windowRows(ctx.daily, days);
  const series = seriesWithRates(window);
  const cmp = compareWindows(ctx.daily, Math.min(days, 14) >= 7 ? 7 : days);

  const topCampaigns = [...ctx.campaigns]
    .filter((c) => c.metrics.spend > 0)
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
    .slice(0, 8)
    .map((c) => ({
      id: c.id, name: c.name, objective: c.objective, status: c.effective_status,
      spend: c.metrics.spend, revenue: c.metrics.revenue, roas: c.metrics.roas,
      purchases: c.metrics.purchases, cpa: c.metrics.cpa, cpm: c.metrics.cpm,
      ctr: c.metrics.ctr, frequency: c.metrics.frequency,
    }));

  const liveAdsets = ctx.adsets.filter((a) => a.effective_status === 'ACTIVE');

  return {
    account: ctx.account, currency: ctx.currency,
    window: { days, from: window[0]?.date ?? null, to: ctx.last },
    totals: aggregate(window),
    lifetime: ctx.aggAll,
    compare: cmp,
    series: series.map((s, i) => ({
      date: s.date, spend: s.spend, revenue: s.revenue, roas: s.roas,
      roas7: rolling(series, 'roas', 7)[i],
      impressions: s.impressions, reach: s.reach, clicks: s.clicks,
      ctr: s.ctr, ctr7: rolling(series, 'ctr', 7)[i],
      cpm: s.cpm, cpm7: rolling(series, 'cpm', 7)[i],
      purchases: s.purchases, landingPageViews: s.landingPageViews,
      frequency: s.frequency, source: s.source,
    })),
    gaps: detectGaps(windowRows(ctx.daily, 60)),
    topCampaigns,
    live: {
      campaigns: ctx.campaigns.filter((c) => c.effective_status === 'ACTIVE').length,
      adsets: liveAdsets.length,
      totalCampaigns: ctx.campaigns.length,
      totalAdsets: ctx.adsets.length,
      // Enough per-ad-set detail to judge the live delivery without leaving Pulse.
      adsetDetail: liveAdsets.map((a) => ({
        id: a.id, name: a.name, optimizationGoal: a.optimization_goal,
        dailyBudget: a.daily_budget,
        audienceLower: a.audience_lower, audienceUpper: a.audience_upper,
        spend: a.metrics.spend, revenue: a.metrics.revenue, roas: a.metrics.roas,
        purchases: a.metrics.purchases, cpa: a.metrics.cpa,
        frequency: a.metrics.frequency, ctr: a.metrics.ctr, cpm: a.metrics.cpm,
      })).sort((x, y) => y.spend - x.spend),
    },
    breakEvenRoas: ctx.breakEvenRoas,
    business: ctx.business,
  };
}

export function mentor() {
  const ctx = buildContext({ days: 28 });
  const findings = runMentor(ctx);
  store.persistAlerts(ctx.accountId, findings.filter((f) => f.severity !== 'good'));
  const bySeverity = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    currency: ctx.currency,
    score: scoreAccount(findings),
    verdict: scoreVerdict(scoreAccount(findings)),
    ruleCount: ruleCount(),
    counts: bySeverity,
    findings,
    generatedAt: new Date().toISOString(),
    context: {
      spend28: ctx.agg28.spend, roas28: ctx.agg28.roas, cpa28: ctx.agg28.cpa,
      purchases28: ctx.agg28.purchases, breakEvenRoas: ctx.breakEvenRoas,
      liveAdsets: ctx.adsets.filter((a) => a.effective_status === 'ACTIVE').length,
    },
  };
}

export function campaigns({ days = 28 } = {}) {
  const ctx = buildContext({ days });
  const shape = (e, level) => ({
    id: e.id, level, name: e.name, parentId: e.parent_id || e.campaign_id || null,
    objective: e.objective, optimizationGoal: e.optimization_goal,
    status: e.status, effectiveStatus: e.effective_status,
    dailyBudget: e.daily_budget, lifetimeBudget: e.lifetime_budget,
    bidStrategy: e.bid_strategy, createdTime: e.created_time,
    learningStage: e.learning_stage,
    audienceLower: e.audience_lower, audienceUpper: e.audience_upper,
    attributionSetting: (() => { try { return JSON.parse(e.raw_json || '{}').attribution_spec ? 'set' : null; } catch { return null; } })(),
    ...e.metrics,
  });
  return {
    currency: ctx.currency,
    window: { days, to: ctx.last },
    breakEvenRoas: ctx.breakEvenRoas,
    targetRoas: ctx.business.targetRoas,
    targetCpa: ctx.business.targetCpa,
    campaigns: ctx.campaigns.map((c) => shape(c, 'campaign')).sort((a, b) => b.spend - a.spend),
    adsets: ctx.adsets.map((a) => shape(a, 'adset')).sort((a, b) => b.spend - a.spend),
  };
}

export function audiences() {
  const ctx = buildContext({ days: 28 });
  const model = buildAudienceModel(ctx.audiences, {
    monthlyBudget: ctx.business.monthlyBudget,
    hasCustomerList: ctx.audiences.some((a) => /customer list|crm|offline/i.test(a.name || '') || a.subtype === 'CUSTOM'),
    hasCreator: false,
  });
  return {
    currency: ctx.currency,
    ...model,
    newCustomerPath: newCustomerPath(model),
    pixel: ctx.pixel,
    summary: {
      total: ctx.audiences.length,
      broken: model.healthCounts.broken || 0,
      weak: model.healthCounts.weak || 0,
      usable: (model.healthCounts.ok || 0) + (model.healthCounts.strong || 0),
      liveRungs: model.plan.filter((r) => r.status === 'live').length,
      buildableRungs: model.plan.filter((r) => r.status === 'buildable').length,
      blockedRungs: model.plan.filter((r) => r.status === 'blocked').length,
      totalRungs: model.plan.length,
    },
  };
}

export function planner() {
  const ctx = buildContext({ days: 28 });
  const findings = runMentor(ctx);
  const model = buildAudienceModel(ctx.audiences, {
    monthlyBudget: ctx.business.monthlyBudget,
    hasCustomerList: ctx.audiences.some((a) => a.subtype === 'CUSTOM'),
  });
  const economics = deriveEconomics({
    agg7: ctx.agg7, agg28: ctx.agg28, agg90: ctx.agg90,
    business: ctx.business, breakEvenRoas: ctx.breakEvenRoas,
    fallback: ctx.fallbackEconomics,
  });
  const allocation = allocateBudget({ monthlyBudget: ctx.business.monthlyBudget, audienceModel: model });
  const plan = buildPlan({ economics, audienceModel: model, findings, allocation, currency: ctx.currency });
  return {
    currency: ctx.currency,
    economics,
    allocation,
    plan,
    scenarios: scenarios({ economics, monthlyBudget: ctx.business.monthlyBudget }),
    baseline: forecast({
      monthlySpend: ctx.business.monthlyBudget,
      cpa: economics.currentCpa || economics.targetCpa,
      aov: economics.aov, grossMargin: economics.grossMargin,
    }),
  };
}

export function history() {
  const ctx = buildContext({ days: 28 });
  const monthly = byMonth(ctx.daily);
  return {
    currency: ctx.currency,
    bounds: store.getDateBounds(ctx.accountId),
    monthly,
    gaps: detectGaps(ctx.daily),
    changelog: store.getChangelog(ctx.accountId, 150),
    activities: store.getActivities(ctx.accountId, 150),
    alerts: store.getAlertHistory(ctx.accountId, 120),
    syncs: store.getRecentSyncs(20),
    calendar: ctx.daily.map((r) => ({
      date: r.date, spend: Number(r.spend || 0), revenue: Number(r.revenue || 0),
      roas: Number(r.spend) ? Number(r.revenue) / Number(r.spend) : 0, source: r.source,
    })),
    lifetime: ctx.aggAll,
  };
}

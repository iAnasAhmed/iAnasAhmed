import { aggregate, windowRows, compareWindows, detectGaps, trendSlope, pctChange } from './metrics.js';

/**
 * The mentor: a rules engine that reads the account the way a senior media buyer
 * reads it. Each rule returns findings shaped as
 *   { ruleId, category, severity, title, finding, why, fix, metrics, entity* }
 * `finding` states what is true, `why` states why it costs money, `fix` is the
 * action to take. Severity ranks the queue; nothing is reported without numbers.
 */

export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

const pct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` : 'n/a');
const isLive = (e) => e.effective_status === 'ACTIVE';

/** Meta needs roughly 50 optimisation events per ad set per week to exit learning. */
const LEARNING_EVENTS_PER_WEEK = 50;
/** Practical floor for a custom audience to seed a usable lookalike. */
const LAL_SEED_FLOOR = 1000;
/** Meta's hard minimum for lookalike creation. */
const LAL_HARD_MIN = 100;

function fmtMoney(v, cur = 'EGP') {
  return `${cur} ${Math.round(Number(v) || 0).toLocaleString('en-US')}`;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const rules = [];
const rule = (fn) => rules.push(fn);

/* --- Delivery continuity --------------------------------------------------- */
rule(function deliveryGaps(ctx) {
  const recent = ctx.daily.filter((r) => r.date >= ctx.windowStart60);
  const gaps = detectGaps(recent).filter((g) => g.days >= 2);
  if (!gaps.length) return [];
  const darkDays = gaps.reduce((s, g) => s + g.days, 0);
  const span = recent.length ? recent.length + darkDays : 60;
  const share = (darkDays / Math.max(span, 1)) * 100;
  const severity = darkDays >= 10 ? 'critical' : darkDays >= 5 ? 'high' : 'medium';
  const lostSpend = ctx.agg28.dailySpend * darkDays;
  return [{
    ruleId: 'delivery_gaps', category: 'delivery', severity,
    title: `${darkDays} dark days in the last 60 — delivery keeps stopping and restarting`,
    finding: `Nothing delivered on ${darkDays} days across ${gaps.length} separate stretches: ${gaps.map((g) => `${g.start} → ${g.end} (${g.days}d)`).join(', ')}. That is ${share.toFixed(0)}% of the period with the account switched off.`,
    why: `Every restart drops the ad set back into the learning phase, where Meta pays more per result while it re-finds buyers. At your current pace those dark days also cost roughly ${fmtMoney(lostSpend, ctx.currency)} of unspent budget, and at your ${ctx.agg28.roas.toFixed(1)}x ROAS that is about ${fmtMoney(lostSpend * ctx.agg28.roas, ctx.currency)} of revenue never earned. Stop-start delivery is the single most expensive habit in this account.`,
    fix: `Move to continuous delivery. Set a floor budget you can sustain 30 days a month (even ${fmtMoney(Math.max(ctx.agg28.dailySpend * 0.4, 500), ctx.currency)}/day beats zero) and let the winning ad set run without pausing. If the gaps come from card declines or balance, add a backup payment method in Billing; if they come from manual pausing, use budget cuts instead of pauses so learning survives.`,
    metrics: { darkDays, gaps, sharePct: share, estimatedLostSpend: lostSpend, estimatedLostRevenue: lostSpend * ctx.agg28.roas },
  }];
});

/* --- Concentration risk ---------------------------------------------------- */
rule(function spendConcentration(ctx) {
  const live = ctx.adsets.filter(isLive);
  const spending = ctx.adsets.filter((a) => a.metrics.spend > 0);
  if (!spending.length) return [];
  const total = spending.reduce((s, a) => s + a.metrics.spend, 0);
  if (total <= 0) return [];
  const top = [...spending].sort((x, y) => y.metrics.spend - x.metrics.spend)[0];
  const share = (top.metrics.spend / total) * 100;
  if (share < 65) return [];
  const severity = live.length <= 1 ? 'critical' : share >= 85 ? 'high' : 'medium';
  return [{
    ruleId: 'spend_concentration', category: 'structure', severity,
    entityLevel: 'adset', entityId: top.id, entityName: top.name,
    title: live.length <= 1
      ? `The whole account is riding on one ad set: "${top.name}"`
      : `${share.toFixed(0)}% of spend sits in a single ad set: "${top.name}"`,
    finding: `"${top.name}" took ${fmtMoney(top.metrics.spend, ctx.currency)} of ${fmtMoney(total, ctx.currency)} in the last 28 days (${share.toFixed(0)}%). ${live.length} ad set${live.length === 1 ? ' is' : 's are'} currently delivering across the account.`,
    why: `A single ad set is a single point of failure. When it fatigues, gets disapproved, or its audience saturates, revenue goes to zero the same week with nothing warmed up to catch it. It also means you have no read on any other audience or creative — you cannot scale what you have never tested.`,
    fix: `Keep the winner running untouched, and stand up two parallel ad sets at 20–30% of its budget each: one broad/Advantage+ prospecting set, one fresh-creative set against the same audience. You are not looking for them to beat the winner immediately — you are buying a replacement before you need one.`,
    metrics: { topAdset: top.name, topSpend: top.metrics.spend, totalSpend: total, sharePct: share, liveAdsets: live.length },
  }];
});

/* --- Frequency fatigue ----------------------------------------------------- */
rule(function frequencyFatigue(ctx) {
  const out = [];
  for (const a of ctx.adsets) {
    if (!isLive(a) || a.metrics.spend <= 0) continue;
    const f = a.metrics.frequency;
    if (f < 3.0) continue;
    const severity = f >= 5 ? 'critical' : f >= 4 ? 'high' : 'medium';
    out.push({
      ruleId: 'frequency_fatigue', category: 'creative', severity,
      entityLevel: 'adset', entityId: a.id, entityName: a.name,
      title: `"${a.name}" is showing to the same accounts ${f.toFixed(1)}x — the audience is saturating`,
      finding: `Frequency is ${f.toFixed(2)} over the reporting window on ${fmtMoney(a.metrics.spend, ctx.currency)} of spend, reaching ${Math.round(a.metrics.reach).toLocaleString('en-US')} accounts with ${Math.round(a.metrics.impressions).toLocaleString('en-US')} impressions.${a.audience_upper ? ` Meta estimates the targeting can only reach ${Math.round(a.audience_lower || 0).toLocaleString('en-US')}–${Math.round(a.audience_upper).toLocaleString('en-US')} accounts.` : ''}`,
      why: `Above about 3x on a cold or mid-funnel audience, the people who were going to buy already have. You keep paying rising CPMs to re-show the same creative to the same accounts, so CPA climbs even though nothing about the offer changed. Anything above 5x means you are buying diminishing returns every single day.`,
      fix: `Two moves, in this order. (1) Widen the pool: this ad set's audience is far too small to absorb the budget — go broad (age + country only, or Advantage+ audience with your buyers as a suggestion) so Meta has room to find new accounts. (2) Refresh creative: ship 3 new hooks against the same offer this week. Widening without new creative just fatigues a bigger audience more slowly.`,
      metrics: { frequency: f, reach: a.metrics.reach, impressions: a.metrics.impressions, spend: a.metrics.spend, audienceLower: a.audience_lower, audienceUpper: a.audience_upper },
    });
  }
  return out;
});

/* --- Narrow audience on a converting ad set -------------------------------- */
rule(function narrowAudience(ctx) {
  const out = [];
  for (const a of ctx.adsets) {
    if (!isLive(a) || !a.audience_upper) continue;
    const conversionGoal = ['OFFSITE_CONVERSIONS', 'VALUE', 'QUALITY_LEAD'].includes(a.optimization_goal);
    const floor = conversionGoal ? 500000 : 200000;
    if (a.audience_upper >= floor) continue;
    out.push({
      ruleId: 'narrow_audience', category: 'audience',
      severity: a.audience_upper < 50000 ? 'high' : 'medium',
      entityLevel: 'adset', entityId: a.id, entityName: a.name,
      title: `"${a.name}" is targeting only ${Math.round(a.audience_upper).toLocaleString('en-US')} accounts`,
      finding: `Meta estimates this ad set can reach ${Math.round(a.audience_lower || 0).toLocaleString('en-US')}–${Math.round(a.audience_upper).toLocaleString('en-US')} accounts while optimising for ${a.optimization_goal || 'its goal'}. A conversion ad set wants at least ${floor.toLocaleString('en-US')} to work from.`,
      why: `Conversion optimisation is a search problem: Meta needs a large pool to find the few accounts most likely to buy. On a pool this small it exhausts the good candidates in days, then either spends on weak ones or drives frequency up. That is why the CPA on narrow ad sets always looks great for two weeks and then falls apart.`,
      fix: `Duplicate this ad set with the targeting stripped back to country + age range and let Advantage+ audience use your buyer list as a suggestion rather than a hard constraint. Give the duplicate 30% of the original's budget and compare CPA over 7 days before shifting more.`,
      metrics: { audienceLower: a.audience_lower, audienceUpper: a.audience_upper, optimizationGoal: a.optimization_goal, floor },
    });
  }
  return out;
});

/* --- Learning phase -------------------------------------------------------- */
rule(function learningLimited(ctx) {
  const out = [];
  for (const a of ctx.adsets) {
    if (!isLive(a) || a.metrics.spend <= 0) continue;
    const days = Math.max(a.metrics.days, 1);
    const weekly = (a.metrics.purchases / days) * 7;
    if (a.metrics.purchases === 0 || weekly >= LEARNING_EVENTS_PER_WEEK) continue;
    out.push({
      ruleId: 'learning_limited', category: 'delivery',
      severity: weekly < 15 ? 'high' : 'medium',
      entityLevel: 'adset', entityId: a.id, entityName: a.name,
      title: `"${a.name}" is running below the learning threshold (${weekly.toFixed(0)} purchases/week)`,
      finding: `This ad set is generating about ${weekly.toFixed(0)} purchases per week (${a.metrics.purchases} over ${days} days). Meta needs roughly ${LEARNING_EVENTS_PER_WEEK} optimisation events per week per ad set to leave the learning phase.`,
      why: `Below the threshold the delivery system never gets a stable signal, so it keeps exploring instead of exploiting. You pay a learning tax on every result, and performance stays noisy — a good day and a bad day are indistinguishable from a real trend.`,
      fix: `Consolidate rather than add. Merge overlapping ad sets so events pool into one, and let the campaign hold the budget (CBO) instead of splitting it across small ad sets. If you must run separate ad sets, each needs a daily budget of at least ${fmtMoney((ctx.business.targetCpa * LEARNING_EVENTS_PER_WEEK) / 7, ctx.currency)} to reach ${LEARNING_EVENTS_PER_WEEK} events a week at your ${fmtMoney(ctx.business.targetCpa, ctx.currency)} target CPA.`,
      metrics: { weeklyEvents: weekly, purchases: a.metrics.purchases, days, threshold: LEARNING_EVENTS_PER_WEEK },
    });
  }
  return out;
});

/* --- ROAS decay ------------------------------------------------------------ */
rule(function roasDecay(ctx) {
  const c = ctx.compare7;
  if (!Number.isFinite(c.delta.roas) || c.current.spend <= 0 || c.previous.spend <= 0) return [];
  if (c.delta.roas > -18) return [];
  const severity = c.delta.roas < -40 ? 'critical' : c.delta.roas < -28 ? 'high' : 'medium';
  return [{
    ruleId: 'roas_decay', category: 'efficiency', severity,
    title: `ROAS fell ${pct(c.delta.roas)} week over week (${c.previous.roas.toFixed(2)}x → ${c.current.roas.toFixed(2)}x)`,
    finding: `Last 7 days: ${fmtMoney(c.current.spend, ctx.currency)} spent, ${fmtMoney(c.current.revenue, ctx.currency)} back, ${c.current.roas.toFixed(2)}x. Prior 7 days: ${fmtMoney(c.previous.spend, ctx.currency)} spent, ${fmtMoney(c.previous.revenue, ctx.currency)} back, ${c.previous.roas.toFixed(2)}x. Spend moved ${pct(c.delta.spend)}, CPM ${pct(c.delta.cpm)}, CTR ${pct(c.delta.ctr)}, frequency ${pct(c.delta.frequency)}.`,
    why: `You are still ${c.current.roas >= ctx.breakEvenRoas ? `above break-even (${ctx.breakEvenRoas.toFixed(2)}x)` : `below break-even (${ctx.breakEvenRoas.toFixed(2)}x) — every sale is losing money`}, but the direction matters more than the level. A drop this size in one week is either creative fatigue, audience saturation, or a change you made — and it compounds if left alone.`,
    fix: `Diagnose in this order before touching budget. CTR down and CPM up → creative fatigue, ship new hooks. CTR flat and CPM up → auction pressure or audience too narrow, widen targeting. CTR and CPM flat but ROAS down → the problem is on-site (price, stock, checkout) or in tracking, not in the ads. Check the History tab for budget or audience edits in the last 10 days before concluding anything.`,
    metrics: { current: c.current, previous: c.previous, delta: c.delta },
  }];
});

/* --- CPA drift ------------------------------------------------------------- */
rule(function cpaDrift(ctx) {
  const c = ctx.compare7;
  if (!c.current.purchases || !c.previous.purchases) return [];
  const drift = pctChange(c.current.cpa, c.previous.cpa);
  if (drift < 22) return [];
  const vsTarget = pctChange(c.current.cpa, ctx.business.targetCpa);
  return [{
    ruleId: 'cpa_drift', category: 'efficiency',
    severity: drift > 55 ? 'high' : 'medium',
    title: `Cost per purchase rose ${pct(drift)} in a week, to ${fmtMoney(c.current.cpa, ctx.currency)}`,
    finding: `CPA moved ${fmtMoney(c.previous.cpa, ctx.currency)} → ${fmtMoney(c.current.cpa, ctx.currency)} on ${c.current.purchases} purchases this week versus ${c.previous.purchases} last week. Your target is ${fmtMoney(ctx.business.targetCpa, ctx.currency)}, so you are ${vsTarget > 0 ? `${pct(vsTarget)} over` : `${pct(Math.abs(vsTarget))} under`} it.`,
    why: `CPA is the number your margin is actually built on. At ${fmtMoney(c.current.cpa, ctx.currency)} and an average order of ${fmtMoney(ctx.aov, ctx.currency)}, you keep ${fmtMoney(ctx.aov * ctx.business.grossMargin - c.current.cpa, ctx.currency)} per order after ad cost and COGS. Drift of this size quietly eats the whole margin before it shows up in the bank.`,
    fix: `Do not raise budget while CPA is climbing — it accelerates the drift. Cut spend on the worst-performing ad or ad set first, confirm CPA recovers for 3 days, then resume scaling in 20% steps.`,
    metrics: { currentCpa: c.current.cpa, previousCpa: c.previous.cpa, driftPct: drift, targetCpa: ctx.business.targetCpa, vsTargetPct: vsTarget },
  }];
});

/* --- Creative fatigue via CTR ---------------------------------------------- */
rule(function creativeFatigue(ctx) {
  const recent = ctx.daily.filter((r) => r.date >= ctx.windowStart28);
  const slope = trendSlope(recent.map((r) => ({ ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0 })), 'ctr');
  const c = ctx.compare7;
  if (!(slope < -0.8 && c.delta.ctr < -10)) return [];
  return [{
    ruleId: 'creative_fatigue', category: 'creative',
    severity: c.delta.ctr < -22 ? 'high' : 'medium',
    title: `Click-through rate is trending down ${slope.toFixed(1)}%/day — creative is wearing out`,
    finding: `CTR over the last 7 days is ${c.current.ctr.toFixed(2)}% versus ${c.previous.ctr.toFixed(2)}% the week before (${pct(c.delta.ctr)}), and the 28-day trend line is falling. CPM over the same period moved ${pct(c.delta.cpm)}.`,
    why: `CTR is the earliest honest signal of fatigue — it turns before ROAS does, because the auction punishes low engagement with higher CPMs before your sales dry up. Acting on the CTR signal costs one week of new creative; acting on the ROAS signal costs a month of results.`,
    fix: `Ship 3 new creatives this week against your proven offer, changing the hook rather than the product: a customer-review cut, a before/after or application demo, and a UGC-style talking head. Keep the winning ad running while they get impressions — do not swap it out.`,
    metrics: { ctrSlopePctPerDay: slope, currentCtr: c.current.ctr, previousCtr: c.previous.ctr, deltaCtr: c.delta.ctr, deltaCpm: c.delta.cpm },
  }];
});

/* --- Below break-even ------------------------------------------------------ */
rule(function belowBreakEven(ctx) {
  const out = [];
  for (const c of ctx.campaigns) {
    if (c.metrics.spend < ctx.business.targetCpa * 3) continue;
    if (!c.metrics.revenue) continue;
    if (c.metrics.roas >= ctx.breakEvenRoas) continue;
    const loss = c.metrics.revenue * ctx.business.grossMargin - c.metrics.spend;
    out.push({
      ruleId: 'below_breakeven', category: 'economics',
      severity: isLive(c) ? 'critical' : 'low',
      entityLevel: 'campaign', entityId: c.id, entityName: c.name,
      title: `"${c.name}" is below break-even at ${c.metrics.roas.toFixed(2)}x${isLive(c) ? ' and still running' : ''}`,
      finding: `${fmtMoney(c.metrics.spend, ctx.currency)} spent returned ${fmtMoney(c.metrics.revenue, ctx.currency)} (${c.metrics.roas.toFixed(2)}x). At a ${(ctx.business.grossMargin * 100).toFixed(0)}% gross margin you need ${ctx.breakEvenRoas.toFixed(2)}x just to cover the ad cost, so this campaign is down about ${fmtMoney(Math.abs(loss), ctx.currency)} in gross profit.`,
      why: `Below break-even, every additional sale makes the loss bigger, not smaller. Revenue growth here is not growth.`,
      fix: isLive(c)
        ? `Pause it today, then decide whether the problem is the audience, the offer, or the market. Do not restart it at the same settings.`
        : `Already paused — keep it that way, and treat its settings as a documented negative result rather than something to retry.`,
      metrics: { spend: c.metrics.spend, revenue: c.metrics.revenue, roas: c.metrics.roas, breakEven: ctx.breakEvenRoas, grossProfit: loss },
    });
  }
  return out;
});

/* --- Burning spend with no conversions ------------------------------------- */
rule(function zeroConversionBurn(ctx) {
  const out = [];
  const threshold = ctx.business.targetCpa * 3;
  for (const a of ctx.adsets) {
    if (!isLive(a)) continue;
    if (a.metrics.spend < threshold || a.metrics.purchases > 0) continue;
    if (a.metrics.messagingStarted > 0 || a.metrics.leads > 0) continue;
    out.push({
      ruleId: 'zero_conversion_burn', category: 'efficiency', severity: 'critical',
      entityLevel: 'adset', entityId: a.id, entityName: a.name,
      title: `"${a.name}" has spent ${fmtMoney(a.metrics.spend, ctx.currency)} with zero recorded conversions`,
      finding: `${fmtMoney(a.metrics.spend, ctx.currency)} spent over ${a.metrics.days} days, ${Math.round(a.metrics.clicks).toLocaleString('en-US')} clicks, and no purchases, messages or leads attributed.`,
      why: `Past 3x your target CPA with nothing back, this is either a genuinely bad audience/creative pairing or the conversion event is not reaching Meta. Both are expensive, and you cannot tell them apart from the ad set view alone.`,
      fix: `First confirm tracking: fire a test purchase and check it appears in Events Manager within minutes. If the event lands, the ad set is the problem — pause it. If it does not, fix the pixel or Conversions API before spending another pound.`,
      metrics: { spend: a.metrics.spend, clicks: a.metrics.clicks, days: a.metrics.days, threshold },
    });
  }
  return out;
});

/* --- Landing page drop-off ------------------------------------------------- */
rule(function landingPageDropoff(ctx) {
  const a = ctx.agg28;
  if (!a.linkClicks || a.linkClicks < 200) return [];
  if (a.lpvRate >= 70) return [];
  const lost = a.linkClicks - a.landingPageViews;
  return [{
    ruleId: 'lpv_dropoff', category: 'measurement',
    severity: a.lpvRate < 45 ? 'high' : 'medium',
    title: `Only ${a.lpvRate.toFixed(0)}% of link clicks become landing page views`,
    finding: `${Math.round(a.linkClicks).toLocaleString('en-US')} link clicks produced ${Math.round(a.landingPageViews).toLocaleString('en-US')} landing page views in the last 28 days — about ${Math.round(lost).toLocaleString('en-US')} clicks never loaded the page.`,
    why: `You paid for every one of those clicks. At ${fmtMoney(a.costPerLinkClick, ctx.currency)} per link click that is roughly ${fmtMoney(lost * a.costPerLinkClick, ctx.currency)} spent on visitors who never saw the site. The usual causes are slow mobile load, a redirect chain, or the pixel firing late.`,
    fix: `Run the store's product page through PageSpeed Insights on mobile and target under 3 seconds to first contentful paint. Remove redirects between the ad link and the destination, and make sure the pixel base code fires in the page head rather than after the hero image.`,
    metrics: { lpvRate: a.lpvRate, linkClicks: a.linkClicks, landingPageViews: a.landingPageViews, lostClicks: lost, costPerLinkClick: a.costPerLinkClick, estimatedWaste: lost * a.costPerLinkClick },
  }];
});

/* --- Event match quality --------------------------------------------------- */
rule(function eventMatchQuality(ctx) {
  if (!ctx.pixel?.eventMatchQuality) return [];
  const weak = Object.entries(ctx.pixel.eventMatchQuality)
    .filter(([, score]) => score < 7.0)
    .sort(([, x], [, y]) => x - y);
  if (!weak.length) return [];
  const emails = ctx.pixel.emailCoverage || {};
  return [{
    ruleId: 'emq_weak', category: 'measurement',
    severity: weak.some(([, s]) => s < 6.5) ? 'high' : 'medium',
    title: `Top-of-funnel events have weak match quality (${weak.map(([e, s]) => `${e} ${s}`).join(', ')})`,
    finding: `Your Purchase event scores ${ctx.pixel.eventMatchQuality.Purchase ?? 'n/a'}/10 — excellent — but ${weak.map(([e, s]) => `${e} sits at ${s}/10`).join(', ')}. Email is attached to only ${emails.AddToCart ?? '?'}% of AddToCart and ${emails.ViewContent ?? '?'}% of ViewContent events, against ${emails.Purchase ?? '?'}% on Purchase.`,
    why: `Match quality is how reliably Meta ties an event to a real account. Purchases match well because checkout collects identity, but browse and cart events do not — so the audiences you build from them (viewers, cart abandoners) are far smaller and less accurate than the real traffic, and lookalikes seeded from them inherit that weakness. This is the upstream cause of thin retargeting pools.`,
    fix: `Send identity on the upper-funnel events through the Conversions API: pass hashed email and phone whenever a logged-in or previously-identified visitor views a product or adds to cart, and always pass external_id plus fbp/fbc. Getting AddToCart and ViewContent above 7.0 typically doubles the size of the retargeting audiences you can build from them.`,
    metrics: { weakEvents: Object.fromEntries(weak), emailCoverage: emails },
  }];
});

/* --- Audience: seeds too small --------------------------------------------- */
rule(function seedTooSmall(ctx) {
  const seeds = ctx.audiences.filter((a) => a.subtype !== 'LOOKALIKE');
  const tiny = seeds.filter((a) => (a.size_upper ?? 0) > 0 && (a.size_upper ?? 0) < LAL_SEED_FLOOR);
  if (!tiny.length) return [];
  const belowHardMin = tiny.filter((a) => (a.size_upper ?? 0) < LAL_HARD_MIN);
  return [{
    ruleId: 'seed_too_small', category: 'audience',
    severity: belowHardMin.length ? 'critical' : 'high',
    title: `${tiny.length} source audiences are too small to be usable (${tiny.map((a) => a.name).slice(0, 4).join(', ')}${tiny.length > 4 ? '…' : ''})`,
    finding: `${tiny.map((a) => `"${a.name}" reports ${a.size_upper} accounts`).join('; ')}. Meta needs ${LAL_HARD_MIN}+ to build a lookalike at all and realistically ${LAL_SEED_FLOOR.toLocaleString('en-US')}+ for a good one. ${belowHardMin.length ? `${belowHardMin.length} of these are below the hard minimum.` : ''}`,
    why: `These are your buyer and visitor pools — the most valuable targeting assets the business owns. Empty, they take retargeting and lookalike prospecting off the table entirely, which is why almost all new-customer spend is going to one narrow interest ad set. Given the pixel is firing and the site has real traffic, an audience reporting ~20 accounts usually means it is bound to the wrong dataset, built on an event that is not firing, or filtered by a URL rule that no longer matches.`,
    fix: `Open each audience in Audience Manager and check three things: the data source (it should be ${ctx.pixelId ? `dataset ${ctx.pixelId}` : 'your live shop pixel'}, not an old or duplicate one), the event it filters on, and any URL contains rule. Rebuild them against the live pixel with a 180-day window. In parallel, upload your customer list from Shopify as a Customer List audience — that path does not depend on the pixel at all and will give you a real seed within a day.`,
    metrics: { tiny: tiny.map((a) => ({ id: a.id, name: a.name, size: a.size_upper })), floor: LAL_SEED_FLOOR, hardMin: LAL_HARD_MIN },
  }];
});

/* --- Audience: lookalikes not delivering ----------------------------------- */
rule(function lookalikesInactive(ctx) {
  const lals = ctx.audiences.filter((a) => a.subtype === 'LOOKALIKE');
  const dead = lals.filter((a) => a.delivery_status && a.delivery_status !== 'ACTIVE');
  if (!dead.length) return [];
  return [{
    ruleId: 'lookalike_inactive', category: 'audience',
    severity: dead.length >= lals.length - 1 ? 'critical' : 'high',
    title: `${dead.length} of ${lals.length} lookalike audiences cannot deliver`,
    finding: `${dead.map((a) => `"${a.name}"`).join(', ')} ${dead.length === 1 ? 'is' : 'are'} not in an active delivery state, so ${dead.length === 1 ? 'it' : 'they'} cannot be used to serve ads.`,
    why: `Lookalikes are the main engine for finding new customers at scale — they take the people who already bought and ask Meta for more accounts like them. With these unavailable, the account has no working cold-prospecting asset, which is exactly why growth is stuck inside one small interest audience.`,
    fix: `These are downstream of the seed problem: a lookalike built on an empty source can never activate. Fix the seeds first (rebuild against the live pixel, upload the Shopify customer list), then rebuild the lookalikes from the repaired seeds — 1%, 1–3% and 3–5% for Egypt — and give each its own ad set so you can read them separately.`,
    metrics: { inactive: dead.map((a) => ({ id: a.id, name: a.name, status: a.delivery_status })), total: lals.length },
  }];
});

/* --- Audience: no retargeting live ----------------------------------------- */
rule(function noRetargetingLive(ctx) {
  const live = ctx.adsets.filter(isLive);
  if (!live.length) return [];
  const usable = ctx.audiences.filter((a) => a.subtype !== 'LOOKALIKE' && (a.size_upper ?? 0) >= LAL_SEED_FLOOR);
  const retargetingLive = live.some((a) => {
    const t = a.targeting_json ? JSON.parse(a.targeting_json) : null;
    return Array.isArray(t?.custom_audiences) && t.custom_audiences.length > 0;
  });
  if (retargetingLive) return [];
  return [{
    ruleId: 'no_retargeting_live', category: 'audience', severity: 'high',
    title: `No retargeting ad set is running — warm traffic is being left on the table`,
    finding: `None of the ${live.length} live ad set${live.length === 1 ? '' : 's'} targets a custom audience. Over the last 28 days the account drove ${Math.round(ctx.agg28.landingPageViews).toLocaleString('en-US')} landing page views and ${Math.round(ctx.agg28.addToCart).toLocaleString('en-US')} add-to-carts that nothing is following up.${usable.length ? ` You do have usable warm pools available: ${usable.map((a) => `"${a.name}" (~${Math.round(a.size_upper / 1000)}k)`).join(', ')}.` : ''}`,
    why: `Retargeting is the cheapest revenue in any e-commerce account — these accounts already know the brand and many were one interruption away from checking out. Skipping it means paying cold prices for every single sale.`,
    fix: `Launch one bottom-funnel ad set at 10–15% of total budget targeting ${usable.length ? `${usable.map((a) => `"${a.name}"`).join(' + ')}` : 'your engagement and site-visitor pools'}, excluding purchasers from the last 30 days. Run offer-led creative — restock, bundle, or a reason to come back — not the same prospecting video.`,
    metrics: { liveAdsets: live.length, usablePools: usable.map((a) => ({ name: a.name, size: a.size_upper })), lpv28: ctx.agg28.landingPageViews, atc28: ctx.agg28.addToCart },
  }];
});

/* --- Scaling headroom (the good news, and it is actionable) ---------------- */
rule(function scalingHeadroom(ctx) {
  const out = [];
  for (const a of ctx.adsets) {
    if (!isLive(a) || a.metrics.purchases < 10) continue;
    if (a.metrics.roas < ctx.business.targetRoas * 1.25) continue;
    const surplus = a.metrics.revenue * ctx.business.grossMargin - a.metrics.spend;
    out.push({
      ruleId: 'scaling_headroom', category: 'economics', severity: 'good',
      entityLevel: 'adset', entityId: a.id, entityName: a.name,
      title: `"${a.name}" is beating target at ${a.metrics.roas.toFixed(2)}x — it has room to scale`,
      finding: `${fmtMoney(a.metrics.spend, ctx.currency)} returned ${fmtMoney(a.metrics.revenue, ctx.currency)} at ${a.metrics.roas.toFixed(2)}x against a ${ctx.business.targetRoas.toFixed(1)}x target, on ${a.metrics.purchases} purchases at ${fmtMoney(a.metrics.cpa, ctx.currency)} each. Gross profit after ad cost: about ${fmtMoney(surplus, ctx.currency)}.`,
      why: `Performing this far above target means you are leaving volume unbought. The constraint is not efficiency, it is how fast you can add budget without breaking the ad set${a.metrics.frequency >= 3 ? ` — and at ${a.metrics.frequency.toFixed(1)}x frequency the audience is the binding constraint, not the budget` : ''}.`,
      fix: a.metrics.frequency >= 3
        ? `Do not simply raise the budget here — a saturated audience will convert extra spend into higher frequency, not more sales. Widen the audience first (broad or Advantage+), hold CPA for 3 days, then raise budget 20% every 3rd day while ROAS stays above ${ctx.business.targetRoas.toFixed(1)}x.`
        : `Raise the daily budget 20% every 3rd day while ROAS holds above ${ctx.business.targetRoas.toFixed(1)}x. Change one thing at a time and never mid-day — each edit restarts learning.`,
      metrics: { roas: a.metrics.roas, target: ctx.business.targetRoas, spend: a.metrics.spend, revenue: a.metrics.revenue, purchases: a.metrics.purchases, cpa: a.metrics.cpa, frequency: a.metrics.frequency, grossProfit: surplus },
    });
  }
  return out;
});

/* --- Mixed business lines in one account ----------------------------------- */
rule(function mixedBusinessLines(ctx) {
  const lines = new Map();
  const classify = (name = '') => {
    const n = name.toLowerCase();
    if (/studio|bride|camp|fadwa|sahel|carousel_bride/.test(n)) return 'Studio / photography';
    if (/dress|nadadress/.test(n)) return 'Dresses';
    if (/cosmetic|blush|lip|liptick|review|sales|eid|glow/.test(n)) return 'Cosmetics';
    return null;
  };
  for (const c of ctx.campaigns) {
    const line = classify(c.name);
    if (!line) continue;
    lines.set(line, (lines.get(line) || 0) + c.metrics.spend);
  }
  const active = [...lines.entries()].filter(([, spend]) => spend > 0);
  if (active.length < 2) return [];
  const total = active.reduce((s, [, v]) => s + v, 0);
  return [{
    ruleId: 'mixed_business_lines', category: 'structure', severity: 'medium',
    title: `${active.length} different business lines share one ad account and one pixel`,
    finding: `${active.map(([line, spend]) => `${line} ${fmtMoney(spend, ctx.currency)} (${((spend / total) * 100).toFixed(0)}%)`).join(', ')} all run through account ${ctx.accountId}.`,
    why: `Meta learns from account-level signal. Mixing a cosmetics shop, a photography studio and a dress line means the pixel's purchase and engagement data describes three different buyers, so lookalikes and Advantage+ audiences are blended and less accurate for each. It also makes every account-level number — ROAS, CPA, frequency — an average of things that should never be averaged.`,
    fix: `Keep the shared ad account if billing requires it, but separate the signal: one dataset per business line, distinct campaign name prefixes (AF-COS, AF-STU, AF-DRS), and never build a lookalike from a mixed source. Judge each line against its own targets — the studio's cost per conversation and the shop's ROAS are not comparable numbers.`,
    metrics: { lines: Object.fromEntries(active), total },
  }];
});

/* --- Budget pacing --------------------------------------------------------- */
rule(function budgetPacing(ctx) {
  const budget = ctx.business.monthlyBudget;
  if (!budget) return [];
  const now = ctx.daily.length ? new Date(`${ctx.daily[ctx.daily.length - 1].date}T00:00:00Z`) : new Date();
  const month = ctx.daily[ctx.daily.length - 1]?.date.slice(0, 7);
  if (!month) return [];
  const mtd = ctx.daily.filter((r) => r.date.startsWith(month));
  const spent = mtd.reduce((s, r) => s + Number(r.spend || 0), 0);
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const expected = budget * (dayOfMonth / daysInMonth);
  const variance = pctChange(spent, expected);
  if (Math.abs(variance) < 25) return [];
  const projected = dayOfMonth ? (spent / dayOfMonth) * daysInMonth : 0;
  return [{
    ruleId: 'budget_pacing', category: 'economics',
    severity: Math.abs(variance) > 50 ? 'medium' : 'low',
    title: variance > 0
      ? `Pacing ${pct(variance)} ahead of the monthly budget`
      : `Pacing ${pct(Math.abs(variance))} behind the monthly budget`,
    finding: `${fmtMoney(spent, ctx.currency)} spent by day ${dayOfMonth} of ${daysInMonth}, against ${fmtMoney(expected, ctx.currency)} expected at an even pace on a ${fmtMoney(budget, ctx.currency)} monthly plan. On the current run rate the month lands at about ${fmtMoney(projected, ctx.currency)}.`,
    why: variance > 0
      ? `Overspending is only a problem if efficiency does not hold. At ${ctx.agg28.roas.toFixed(2)}x it is currently paying for itself, but the budget still needs to be a decision rather than an accident.`
      : `Underspending at a profitable ROAS is unbought revenue. At ${ctx.agg28.roas.toFixed(2)}x, the ${fmtMoney(Math.max(budget - projected, 0), ctx.currency)} you will not spend this month is roughly ${fmtMoney(Math.max(budget - projected, 0) * ctx.agg28.roas, ctx.currency)} of revenue skipped.`,
    fix: variance > 0
      ? `Decide deliberately: either raise the plan to match what is working, or cap the campaign budget so the month lands where you intended.`
      : `If the ad set is not audience-constrained, raise budget in 20% steps. If frequency is already high, fix the audience first — spending more into a saturated pool will not convert.`,
    metrics: { spent, expected, budget, variancePct: variance, projected, dayOfMonth, daysInMonth },
  }];
});

/* --- Attribution consistency ----------------------------------------------- */
rule(function attributionMismatch(ctx) {
  const settings = new Map();
  for (const a of ctx.adsets) {
    if (!a.metrics.spend) continue;
    const s = a.attribution_setting;
    if (!s) continue;
    if (!settings.has(s)) settings.set(s, []);
    settings.get(s).push(a.name);
  }
  if (settings.size < 2) return [];
  return [{
    ruleId: 'attribution_mismatch', category: 'measurement', severity: 'low',
    title: `Ad sets are reporting on ${settings.size} different attribution windows`,
    finding: `${[...settings.entries()].map(([s, names]) => `${s}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`).join(' | ')}.`,
    why: `A 7-day-click ad set will always look better than a 1-day-click one for the same real performance, because it is credited with more of the same sales. Comparing them side by side and moving budget on that comparison hands money to whichever ad set has the more generous window.`,
    fix: `Standardise on one window for decisions — 7-day click, 1-day view is the sensible default for this account — and only compare ad sets that share it. Keep a second window as a sanity check, never as the number you optimise on.`,
    metrics: { settings: Object.fromEntries([...settings.entries()].map(([k, v]) => [k, v.length])) },
  }];
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runMentor(ctx) {
  const findings = [];
  for (const fn of rules) {
    try {
      const res = fn(ctx) || [];
      for (const f of res) findings.push({ ...f, ruleName: fn.name });
    } catch (err) {
      findings.push({
        ruleId: `rule_error_${fn.name}`, category: 'system', severity: 'low',
        title: `Rule "${fn.name}" could not run`,
        finding: err.message, why: 'A diagnostic failed, so this check is missing from the report.',
        fix: 'Check the server log; the rest of the report is unaffected.', metrics: {},
      });
    }
  }
  findings.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  return findings;
}

export function scoreAccount(findings) {
  // Start at 100 and subtract for open problems. Repeat findings of the same
  // severity decay, so a fifth "high" does not weigh as much as the first - the
  // score should separate a struggling account from a broken one rather than
  // bottoming out at zero the moment a few checks fire. `good` never subtracts.
  const weight = { critical: 20, high: 11, medium: 5, low: 2, good: 0 };
  const seen = {};
  let penalty = 0;
  for (const f of findings) {
    const w = weight[f.severity] ?? 0;
    if (!w) continue;
    const nth = (seen[f.severity] = (seen[f.severity] || 0) + 1);
    penalty += w * (1 / nth ** 0.6);
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

/** Plain-language read of the score, so the number means something. */
export function scoreVerdict(score) {
  if (score >= 85) return { label: 'Healthy', note: 'No structural problems open. Keep scaling and keep testing creative.' };
  if (score >= 70) return { label: 'Solid, with gaps', note: 'Working, but leaving money on the table. Clear the highs before adding budget.' };
  if (score >= 50) return { label: 'Fragile', note: 'Performing on paper, but the structure underneath it is thin. One bad week away from a problem.' };
  if (score >= 30) return { label: 'At risk', note: 'Serious gaps in audience or measurement. Fix the criticals before spending more.' };
  return { label: 'Critical', note: 'The foundation is broken. Current results are being carried by one thing that will not last.' };
}

export const ruleCount = () => rules.length;

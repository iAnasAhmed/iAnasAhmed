import { TIERS } from './audiences.js';

/**
 * Campaign planning. Everything here is derived from the account's own numbers -
 * no generic benchmarks - so the plan reflects what this brand actually achieves.
 */

const round = (v, dp = 0) => Number(Number(v || 0).toFixed(dp));

/**
 * Pulls the economics the plan is built on out of live performance, preferring
 * the most recent window that has enough conversions to be trustworthy.
 */
export function deriveEconomics({ agg7, agg28, agg90, business, breakEvenRoas, fallback = null }) {
  const label = (w) => (w === agg28 ? 'last 28 days' : w === agg90 ? 'last 90 days' : 'last 7 days');
  const pick = (field) => {
    // Prefer the shortest recent window that has enough conversions to trust.
    for (const w of [agg28, agg90, agg7]) {
      if (w && w.purchases >= 20 && Number.isFinite(w[field]) && w[field] > 0) return { value: w[field], from: label(w) };
    }
    for (const w of [agg28, agg90, agg7]) {
      if (w && w.purchases > 0 && Number.isFinite(w[field]) && w[field] > 0) return { value: w[field], from: `${label(w)} (thin data)` };
    }
    if (fallback && Number.isFinite(fallback[field]) && fallback[field] > 0) {
      return { value: fallback[field], from: fallback.source };
    }
    return { value: 0, from: 'no data' };
  };

  const aovSrc = business.averageOrderValue
    ? { value: business.averageOrderValue, from: 'configured in .env' }
    : pick('aov');
  const cpa = pick('cpa');
  const roas = pick('roas');

  const aov = aovSrc.value;
  const contributionPerOrder = aov * business.grossMargin;
  const maxCpa = contributionPerOrder; // break-even cost per order
  const targetCpaFromRoas = business.targetRoas > 0 ? aov / business.targetRoas : business.targetCpa;

  return {
    aov: round(aov, 2), aovSource: aovSrc.from,
    currentCpa: round(cpa.value, 2), cpaSource: cpa.from,
    currentRoas: round(roas.value, 3), roasSource: roas.from,
    grossMargin: business.grossMargin,
    contributionPerOrder: round(contributionPerOrder, 2),
    breakEvenCpa: round(maxCpa, 2),
    breakEvenRoas: round(breakEvenRoas, 2),
    targetRoas: business.targetRoas,
    targetCpa: round(business.targetCpa, 2),
    targetCpaImpliedByRoas: round(targetCpaFromRoas, 2),
    headroom: round(maxCpa - cpa.value, 2),
  };
}

/** Spend -> orders -> revenue -> gross profit, at a given cost per purchase. */
export function forecast({ monthlySpend, cpa, aov, grossMargin }) {
  const orders = cpa > 0 ? monthlySpend / cpa : 0;
  const revenue = orders * aov;
  const grossProfit = revenue * grossMargin - monthlySpend;
  return {
    monthlySpend: round(monthlySpend),
    orders: round(orders),
    revenue: round(revenue),
    roas: round(monthlySpend > 0 ? revenue / monthlySpend : 0, 2),
    grossProfit: round(grossProfit),
    profitPerOrder: round(orders > 0 ? grossProfit / orders : 0, 2),
  };
}

/**
 * Budget split across the funnel, with the cold tier weighted up when the
 * warm/hot tiers have no working audiences to spend into.
 */
export function allocateBudget({ monthlyBudget, audienceModel }) {
  const buildableByTier = {};
  for (const rung of audienceModel.plan) {
    buildableByTier[rung.tier] = buildableByTier[rung.tier] || { total: 0, ready: 0 };
    buildableByTier[rung.tier].total += 1;
    if (rung.status !== 'blocked') buildableByTier[rung.tier].ready += 1;
  }

  // Tiers with nothing buildable cannot absorb budget today; their share is
  // parked and reported rather than silently redistributed.
  const rows = Object.values(TIERS).map((t) => {
    const b = buildableByTier[t.key] || { total: 0, ready: 0 };
    const spendable = b.ready > 0;
    return {
      tier: t.key, label: t.label, intent: t.intent,
      targetShare: t.budgetShare,
      readyRungs: b.ready, totalRungs: b.total, spendable,
    };
  });

  const spendableShare = rows.filter((r) => r.spendable).reduce((s, r) => s + r.targetShare, 0);
  const parkedShare = 1 - spendableShare;

  return {
    monthlyBudget,
    rows: rows.map((r) => {
      // Today's split: proportional over the tiers that can actually run.
      const todayShare = r.spendable && spendableShare > 0 ? r.targetShare / spendableShare : 0;
      return {
        ...r,
        targetMonthly: round(monthlyBudget * r.targetShare),
        targetDaily: round((monthlyBudget * r.targetShare) / 30),
        todayShare: round(todayShare, 4),
        todayMonthly: round(monthlyBudget * todayShare),
        todayDaily: round((monthlyBudget * todayShare) / 30),
      };
    }),
    parkedShare: round(parkedShare, 4),
    parkedMonthly: round(monthlyBudget * parkedShare),
    note: parkedShare > 0
      ? `${Math.round(parkedShare * 100)}% of the ideal split has nowhere to go until the warm and hot audiences are rebuilt. Until then that budget concentrates in cold prospecting, which is exactly why cost per purchase is higher than it needs to be.`
      : 'Every tier has at least one runnable audience, so the target split can be used as-is.',
  };
}

/**
 * A four-week operating plan. Ordered so that the things which unlock other
 * things happen first, and nothing depends on a rung that is still blocked.
 */
export function buildPlan({ economics, audienceModel, findings, allocation, currency = 'EGP' }) {
  const money = (v) => `${currency} ${Math.round(v).toLocaleString('en-US')}`;
  const critical = findings.filter((f) => f.severity === 'critical');
  const high = findings.filter((f) => f.severity === 'high');
  const blockedCold = audienceModel.plan.filter((r) => r.tier === 'T0' && r.status === 'blocked');
  const readyCold = audienceModel.plan.filter((r) => r.tier === 'T0' && r.status !== 'blocked');
  const daily = allocation.monthlyBudget / 30;

  const weeks = [
    {
      week: 1,
      theme: 'Stop the leaks and rebuild the data foundation',
      goal: 'Nothing scales on a broken base. This week is measurement and continuity, not new spend.',
      actions: [
        ...(critical.length ? [{
          task: `Clear the ${critical.length} critical finding${critical.length === 1 ? '' : 's'} in the Mentor tab first`,
          detail: critical.slice(0, 3).map((f) => f.title).join(' · '),
          owner: 'Media buyer', impact: 'high',
        }] : []),
        {
          task: 'Rebuild the source audiences against the live pixel',
          detail: `Open Audience Manager and repoint Purchasers, Visitors, AddToCart and Checkout audiences at the live shop dataset with 180-day windows. Confirm each reports a real size within 24 hours. Every lookalike in the account is waiting on this.`,
          owner: 'Media buyer', impact: 'critical',
        },
        {
          task: 'Upload the Shopify customer list as a Customer List audience',
          detail: 'Export customers with email, phone, first/last name, city and total spend. This path does not depend on the pixel, so it gives you a working purchaser seed immediately and a value-based lookalike afterwards.',
          owner: 'Media buyer', impact: 'critical',
        },
        {
          task: 'Send identity on upper-funnel events through the Conversions API',
          detail: 'Pass hashed email, phone and external_id on ViewContent and AddToCart, not just Purchase. Target a match quality above 7.0 on both — that is what makes the retargeting pools fill up.',
          owner: 'Developer', impact: 'high',
        },
        {
          task: 'Guarantee continuous delivery',
          detail: `Add a backup payment method and set a sustainable floor budget of about ${money(daily * 0.6)}/day. Cut budgets instead of pausing ad sets — pausing restarts learning and costs a week of efficiency.`,
          owner: 'Owner', impact: 'high',
        },
      ],
    },
    {
      week: 2,
      theme: 'Break the single-ad-set dependency',
      goal: 'Get a second and third source of volume live before the current winner fatigues.',
      actions: [
        {
          task: `Launch broad prospecting alongside the current winner`,
          detail: `New ad set, Egypt, women 18–45, no interests, Advantage+ audience on, optimising for Purchase. Start at ${money(daily * 0.25)}/day. Do not touch the winner while this runs.`,
          owner: 'Media buyer', impact: 'critical',
        },
        ...(readyCold.length ? [{
          task: `Stand up the cold rungs that are already buildable`,
          detail: readyCold.map((r) => r.name).join(', ') + '. One ad set each so you can read them separately.',
          owner: 'Media buyer', impact: 'high',
        }] : []),
        {
          task: 'Launch the warm bridge ad set',
          detail: 'Instagram and Facebook engagers 365 days, excluding purchasers 30 days and site visitors 30 days. This pool already exists and is large — it is the cheapest incremental audience available right now.',
          owner: 'Media buyer', impact: 'high',
        },
        {
          task: 'Ship three new creative hooks',
          detail: 'Customer-review cut, application/before-after demo, and a UGC-style talking head against the same proven offer. New hooks, same product — you are testing the opening three seconds, not the item.',
          owner: 'Creative', impact: 'high',
        },
      ],
    },
    {
      week: 3,
      theme: 'Turn on retargeting and close the funnel',
      goal: 'Stop paying cold prices for people who already know the brand.',
      actions: [
        {
          task: 'Launch the hot-tier ad sets now that the pixel audiences are populated',
          detail: 'InitiateCheckout 7d excluding purchasers, AddToCart 14d excluding purchasers, product viewers 30d excluding cart. Offer-led creative, not prospecting video.',
          owner: 'Media buyer', impact: 'critical',
        },
        {
          task: 'Launch the customer tiers',
          detail: 'Buyers 0–30d for cross-sell and buyers 31–90d for replenishment. On consumables the 31–90 day window is where repeat revenue lives.',
          owner: 'Media buyer', impact: 'high',
        },
        {
          task: 'Apply the exclusion matrix across every ad set',
          detail: 'Cold excludes purchasers 180d. Warm excludes purchasers 30d and site visitors 30d. Hot excludes recent purchasers at its own window. Without this the tiers bid against each other and you pay twice for the same account.',
          owner: 'Media buyer', impact: 'high',
        },
        ...(blockedCold.length ? [{
          task: 'Build the lookalikes that were blocked in week 1',
          detail: `${blockedCold.map((r) => r.name).join(', ')} — buildable now that the seeds are real. Build 1%, then 1–3% for scale.`,
          owner: 'Media buyer', impact: 'critical',
        }] : []),
      ],
    },
    {
      week: 4,
      theme: 'Scale what proved itself',
      goal: 'Add budget only where the numbers earned it, in controlled steps.',
      actions: [
        {
          task: `Raise budget 20% every third day on any ad set holding above ${economics.targetRoas}x`,
          detail: `Never more than one change per ad set per day, and never mid-day. Each edit restarts learning, so a week of impatient edits costs more than a week of patience.`,
          owner: 'Media buyer', impact: 'high',
        },
        {
          task: `Cut anything that spent ${money(economics.breakEvenCpa * 3)} without a purchase`,
          detail: `That is three times your break-even cost per order of ${money(economics.breakEvenCpa)}. Past that point it is not a slow start, it is a result.`,
          owner: 'Media buyer', impact: 'medium',
        },
        {
          task: 'Test a creator partnership ad',
          detail: `Meta's own opportunity model estimates roughly 19% lower cost per result for this account from partnership ads. One creator, one offer, broad targeting.`,
          owner: 'Owner', impact: 'medium',
        },
        {
          task: 'Review the month against the plan',
          detail: 'Compare actual cost per purchase, ROAS and orders against the forecast in this tab. Reset the targets in .env if the economics moved.',
          owner: 'Owner', impact: 'medium',
        },
      ],
    },
  ];

  const rules = {
    scaling: [
      `Raise budget 20% at a time, no more than once every 3 days, only while ROAS holds above ${economics.targetRoas}x.`,
      'If frequency is above 3, widen the audience before adding budget — extra spend into a saturated pool buys impressions, not customers.',
      'Duplicate rather than edit when you want a materially bigger budget (2x or more); the duplicate learns fresh instead of destabilising a working ad set.',
    ],
    killing: [
      `Kill an ad set once it spends ${money(economics.breakEvenCpa * 3)} with zero purchases.`,
      `Kill an ad set whose 7-day ROAS sits below break-even (${economics.breakEvenRoas}x) for 5 consecutive days.`,
      'Kill an ad whose CTR falls more than 35% below the ad set average once it has 5,000 impressions.',
    ],
    testing: [
      'Three new creatives a week, always against the proven offer. Change the hook, not the product.',
      'Test in the winning ad set rather than a separate one — you inherit its learning instead of paying for a new learning phase.',
      'Give a new creative 3 days or 3x your cost per purchase in spend before judging it, whichever comes first.',
    ],
    guardrails: [
      'One change per ad set per day, and never mid-day.',
      'Judge on a single attribution window; keep the second one as a sanity check only.',
      'Never build a lookalike from an audience below 1,000 accounts.',
      'Never let delivery stop — cut budget instead of pausing.',
    ],
  };

  return { weeks, rules };
}

/** Best / expected / stretch cases for the coming month. */
export function scenarios({ economics, monthlyBudget }) {
  const base = economics.currentCpa || economics.targetCpa;
  const defs = [
    { key: 'current', label: 'Hold current efficiency', cpa: base, note: 'Nothing changes. Same cost per purchase, same budget.' },
    { key: 'fixed', label: 'Retargeting + lookalikes live', cpa: base * 0.82, note: 'Warm and hot tiers carry ~25% of spend at roughly half the cold cost per purchase, pulling the blended figure down about 18%.' },
    { key: 'scaled', label: 'Fixed funnel, budget +50%', cpa: base * 0.9, monthlySpend: monthlyBudget * 1.5, note: 'More budget usually costs some efficiency; this assumes a 10% better blended cost per purchase than today rather than 18%, because scale bites.' },
    { key: 'stalled', label: 'Audience saturates, nothing changes', cpa: base * 1.35, note: 'Frequency keeps climbing on one narrow ad set. This is the default outcome if the audience work does not happen.' },
  ];
  return defs.map((d) => ({
    ...d,
    cpa: round(d.cpa, 2),
    ...forecast({
      monthlySpend: d.monthlySpend ?? monthlyBudget,
      cpa: d.cpa, aov: economics.aov, grossMargin: economics.grossMargin,
    }),
  }));
}

/**
 * Audience segmentation and hierarchy design.
 *
 * Two jobs:
 *  1. Read the audiences that exist today, classify them into a funnel tier and
 *     score their health, so you can see what you actually own.
 *  2. Hold the target hierarchy - the ladder this account should be running -
 *     and diff it against reality to produce a build order.
 */

export const LAL_HARD_MIN = 100;
export const LAL_SEED_FLOOR = 1000;
export const LAL_GOOD_SEED = 5000;

export const TIERS = {
  T0: { key: 'T0', label: 'Cold — Discovery', intent: 'Find people who have never heard of the brand', budgetShare: 0.65, colour: 'cold' },
  T1: { key: 'T1', label: 'Warm — Engaged', intent: 'People who engaged on Instagram or Facebook but never visited the site', budgetShare: 0.10, colour: 'warm' },
  T2: { key: 'T2', label: 'Hot — Site intent', intent: 'People who browsed, added to cart or started checkout and did not buy', budgetShare: 0.13, colour: 'hot' },
  T3: { key: 'T3', label: 'Customers — Repeat', intent: 'People who already bought; the cheapest revenue in the account', budgetShare: 0.08, colour: 'customer' },
  T4: { key: 'T4', label: 'Lapsed — Win-back', intent: 'Past buyers who have gone quiet', budgetShare: 0.04, colour: 'lapsed' },
};

/**
 * The target ladder. Each rung is a real ad set you can build, with the rule to
 * build it, what it must exclude so tiers do not bid against each other, and the
 * prerequisite that decides whether it can exist yet.
 */
export const BLUEPRINT = [
  // --- T0 Cold ------------------------------------------------------------
  {
    id: 'C1', matchSegment: null, matchLal: false, tier: 'T0', name: 'Broad EG', priority: 1,
    definition: 'Egypt, women 18–45, no interest targeting. Advantage+ audience on, with your purchaser list as a suggestion.',
    source: 'none (broad)', window: null, excludes: ['Purchasers 180d'],
    purpose: 'The scale engine. With a healthy pixel, broad beats interest stacks on cost per purchase almost everywhere, and it is the only cold audience that cannot saturate.',
    prerequisite: 'Pixel firing Purchase reliably (yours scores 9.3/10 — ready).',
    readyWhen: () => true,
    expectedRole: 'primary',
  },
  {
    id: 'C2', matchSegment: 'purchasers', matchLal: true, tier: 'T0', name: 'LAL 1% — Purchasers 180d', priority: 2,
    definition: 'Lookalike (EG, 1%) from a Purchasers 180-day custom audience.',
    source: 'Purchasers 180d', window: '180d', excludes: ['Purchasers 180d', 'ATC 14d'],
    purpose: 'The highest-quality cold audience you can build: Meta finds accounts resembling people who actually paid you.',
    prerequisite: `Purchasers 180d seed with at least ${LAL_SEED_FLOOR.toLocaleString('en-US')} accounts (${LAL_HARD_MIN} is Meta's hard floor).`,
    readyWhen: (ctx) => ctx.seedSize('purchasers') >= LAL_HARD_MIN,
    expectedRole: 'primary',
  },
  {
    id: 'C3', matchSegment: 'purchasers', matchLal: true, tier: 'T0', name: 'LAL 1–3% — Purchasers 180d', priority: 5,
    definition: 'Lookalike (EG, 1–3%) from the same purchaser seed, excluding the 1% so the two do not overlap.',
    source: 'Purchasers 180d', window: '180d', excludes: ['LAL 1% Purchasers', 'Purchasers 180d'],
    purpose: 'Where you go when the 1% saturates. Wider, slightly weaker, but three times the pool.',
    prerequisite: 'C2 live and holding target ROAS for 7 days.',
    readyWhen: (ctx) => ctx.seedSize('purchasers') >= LAL_SEED_FLOOR,
    expectedRole: 'scale',
  },
  {
    id: 'C4', matchSegment: 'atc', matchLal: true, tier: 'T0', name: 'LAL 1% — Add to cart 180d', priority: 4,
    definition: 'Lookalike (EG, 1%) from an AddToCart 180-day audience.',
    source: 'ATC 180d', window: '180d', excludes: ['Purchasers 180d'],
    purpose: 'A larger seed than purchasers, so it builds sooner and refreshes faster. Slightly lower intent, useful for volume.',
    prerequisite: `AddToCart audience above ${LAL_SEED_FLOOR.toLocaleString('en-US')} accounts — needs AddToCart event match quality above 7.0.`,
    readyWhen: (ctx) => ctx.seedSize('atc') >= LAL_HARD_MIN,
    expectedRole: 'support',
  },
  {
    id: 'C5', matchSegment: null, matchLal: false, tier: 'T0', name: 'LAL 1% — High-value buyers', priority: 6,
    definition: 'Value-based lookalike from a customer list carrying purchase value, top spenders weighted.',
    source: 'Customer list with value', window: 'all time', excludes: ['Purchasers 180d'],
    purpose: 'Optimises toward accounts resembling your best customers rather than any customer. Usually lifts average order value rather than volume.',
    prerequisite: 'Customer list export from Shopify including order value, 1,000+ rows.',
    readyWhen: (ctx) => ctx.hasCustomerList,
    expectedRole: 'margin',
  },
  {
    id: 'C6', matchSegment: null, matchLal: false, tier: 'T0', name: 'Interest stack — Beauty', priority: 8,
    definition: 'Egypt, women 18–45, interests: cosmetics, makeup, skincare, beauty salons, plus competitor brand interests.',
    source: 'interests', window: null, excludes: ['Purchasers 180d', 'ATC 14d'],
    purpose: 'A control, not a strategy. Keep one small interest ad set so you can prove broad is beating it rather than assuming.',
    prerequisite: 'None.',
    readyWhen: () => true,
    expectedRole: 'control',
  },
  {
    id: 'C7', matchSegment: null, matchLal: false, tier: 'T0', name: 'Partnership / creator ads', priority: 7,
    definition: 'Partnership ad running through a creator handle with the creator\'s own signal, targeted broad.',
    source: 'creator', window: null, excludes: ['Purchasers 180d'],
    purpose: 'Borrowed trust plus the creator\'s audience signal. Meta estimates roughly 19% lower cost per result for this account.',
    prerequisite: 'A creator partnership and a partnership ad code.',
    readyWhen: (ctx) => ctx.hasCreator,
    expectedRole: 'test',
  },

  // --- T1 Warm ------------------------------------------------------------
  {
    id: 'W1', matchSegment: 'engaged', matchLal: false, tier: 'T1', name: 'IG + FB engagers 365d', priority: 3,
    definition: 'Everyone who engaged with the Instagram or Facebook account in the last 365 days.',
    source: 'platform engagement', window: '365d', excludes: ['Purchasers 30d', 'ATC 14d', 'Site visitors 30d'],
    purpose: 'They know the brand but have never reached the site. The cheapest bridge from social to shop, and it does not depend on the pixel at all.',
    prerequisite: 'Active social presence — you already hold pools here.',
    readyWhen: (ctx) => ctx.seedSize('engaged') >= LAL_SEED_FLOOR,
    expectedRole: 'primary',
  },
  {
    id: 'W2', matchSegment: 'video', matchLal: false, tier: 'T1', name: 'Video viewers 75% — 180d', priority: 9,
    definition: 'Accounts that watched 75% or more of any video ad in the last 180 days.',
    source: 'video engagement', window: '180d', excludes: ['Purchasers 30d', 'Site visitors 30d'],
    purpose: 'Watching three quarters of a video is a real intent signal, and it is free to collect on every campaign you already run.',
    prerequisite: 'Video creative in market (you run reels — ready).',
    readyWhen: () => true,
    expectedRole: 'support',
  },
  {
    id: 'W3', matchSegment: 'engaged', matchLal: false, tier: 'T1', name: 'IG profile visitors 90d', priority: 12,
    definition: 'Accounts that visited the Instagram profile in the last 90 days.',
    source: 'platform engagement', window: '90d', excludes: ['Purchasers 30d', 'Site visitors 30d'],
    purpose: 'A deliberate profile visit is stronger than a passive like. Small pool, high intent.',
    prerequisite: 'None.',
    readyWhen: () => true,
    expectedRole: 'support',
  },

  // --- T2 Hot -------------------------------------------------------------
  {
    id: 'H1', matchSegment: 'checkout', matchLal: false, tier: 'T2', name: 'Initiate checkout 7d — no purchase', priority: 2,
    definition: 'InitiateCheckout in the last 7 days, excluding Purchase in the last 7 days.',
    source: 'pixel', window: '7d', excludes: ['Purchasers 7d'],
    purpose: 'The single highest-intent audience in any shop. They reached the payment step and stopped — usually price, shipping cost, or a distraction.',
    prerequisite: 'InitiateCheckout firing with good match quality.',
    readyWhen: (ctx) => ctx.seedSize('checkout') >= LAL_HARD_MIN,
    expectedRole: 'primary',
  },
  {
    id: 'H2', matchSegment: 'atc', matchLal: false, tier: 'T2', name: 'Add to cart 14d — no purchase', priority: 3,
    definition: 'AddToCart in the last 14 days, excluding Purchase in the last 14 days.',
    source: 'pixel', window: '14d', excludes: ['Purchasers 14d', 'IC 7d'],
    purpose: 'Chose a product, did not pay. Responds strongly to a reminder plus a small reason to act now.',
    prerequisite: 'AddToCart audience populated.',
    readyWhen: (ctx) => ctx.seedSize('atc') >= LAL_HARD_MIN,
    expectedRole: 'primary',
  },
  {
    id: 'H3', matchSegment: 'viewers', matchLal: false, tier: 'T2', name: 'Product viewers 30d — no ATC', priority: 6,
    definition: 'ViewContent in the last 30 days, excluding AddToCart 30 days and Purchase 30 days.',
    source: 'pixel', window: '30d', excludes: ['ATC 30d', 'Purchasers 30d'],
    purpose: 'Interested but not convinced. This is where reviews, before/after and shade-match content do the work.',
    prerequisite: 'ViewContent match quality above 7.0.',
    readyWhen: (ctx) => ctx.seedSize('viewers') >= LAL_HARD_MIN,
    expectedRole: 'support',
  },
  {
    id: 'H4', matchSegment: 'visitors', matchLal: false, tier: 'T2', name: 'All site visitors 180d', priority: 10,
    definition: 'Anyone who visited the site in the last 180 days.',
    source: 'pixel', window: '180d', excludes: ['Purchasers 90d'],
    purpose: 'The catch-all warm pool and the seed for site-based lookalikes. Broadest of the hot tier.',
    prerequisite: 'Pixel PageView firing (it is).',
    readyWhen: (ctx) => ctx.seedSize('visitors') >= LAL_HARD_MIN,
    expectedRole: 'seed',
  },

  // --- T3 Customers -------------------------------------------------------
  {
    id: 'B1', matchSegment: 'purchasers', matchLal: false, tier: 'T3', name: 'Buyers 0–30d — cross-sell', priority: 7,
    definition: 'Purchase in the last 30 days.',
    source: 'pixel + customer list', window: '30d', excludes: [],
    purpose: 'Just bought and still engaged with the brand. Sell the complement, not the same item.',
    prerequisite: 'Purchase event (9.3/10 — strong).',
    readyWhen: (ctx) => ctx.seedSize('purchasers') >= LAL_HARD_MIN,
    expectedRole: 'margin',
  },
  {
    id: 'B2', matchSegment: 'purchasers', matchLal: false, tier: 'T3', name: 'Buyers 31–90d — replenish', priority: 8,
    definition: 'Purchase 31–90 days ago, excluding Purchase in the last 30 days.',
    source: 'pixel + customer list', window: '31–90d', excludes: ['Purchasers 30d'],
    purpose: 'Consumables run out on a schedule. This is the window where a lipstick or skincare buyer is ready for the next one.',
    prerequisite: 'Purchase history depth of 90+ days (you have 2 years).',
    readyWhen: (ctx) => ctx.seedSize('purchasers') >= LAL_HARD_MIN,
    expectedRole: 'margin',
  },
  {
    id: 'B3', matchSegment: null, matchLal: false, tier: 'T3', name: 'High-value buyers', priority: 11,
    definition: 'Customer list segment: top 25% by lifetime order value.',
    source: 'customer list', window: 'all time', excludes: [],
    purpose: 'Your best customers, and the seed for the value-based lookalike C5. Worth its own creative and its own offer.',
    prerequisite: 'Shopify customer export with order values.',
    readyWhen: (ctx) => ctx.hasCustomerList,
    expectedRole: 'margin',
  },

  // --- T4 Lapsed ----------------------------------------------------------
  {
    id: 'L1', matchSegment: 'purchasers', matchLal: false, tier: 'T4', name: 'Lapsed buyers 90–180d', priority: 13,
    definition: 'Purchase 90–180 days ago, excluding Purchase in the last 90 days.',
    source: 'pixel + customer list', window: '90–180d', excludes: ['Purchasers 90d'],
    purpose: 'Bought once, drifted. Cheaper to win back than to acquire, and a strong offer usually does it.',
    prerequisite: 'Purchase history depth.',
    readyWhen: (ctx) => ctx.seedSize('purchasers') >= LAL_HARD_MIN,
    expectedRole: 'support',
  },
  {
    id: 'L2', matchSegment: 'purchasers', matchLal: false, tier: 'T4', name: 'Lapsed buyers 180–365d', priority: 14,
    definition: 'Purchase 180–365 days ago, excluding Purchase in the last 180 days.',
    source: 'customer list', window: '180–365d', excludes: ['Purchasers 180d'],
    purpose: 'Long-dormant. Low volume, but the only cost is the creative you already have.',
    prerequisite: 'Customer list upload.',
    readyWhen: (ctx) => ctx.hasCustomerList,
    expectedRole: 'support',
  },
];

// ---------------------------------------------------------------------------
// Classification of what exists today
// ---------------------------------------------------------------------------

const RX = {
  purchasers: /purchas|buyer|customer|bought/i,
  atc: /addtocart|add to cart|atc|cart/i,
  checkout: /checkout|initiatecheckout|ic\b/i,
  viewers: /viewcontent|view content|product view|viewer/i,
  visitors: /visitor|website|site|traffic|all users/i,
  engaged: /engag|insta|instagram|facebook|ig\b|fb\b|social|page/i,
  video: /video|reel|thruplay|watch/i,
};

export function classifyAudience(a) {
  const name = a.name || '';
  const isLal = a.subtype === 'LOOKALIKE';
  let segment = 'other';
  for (const [key, rx] of Object.entries(RX)) {
    if (rx.test(name)) { segment = key; break; }
  }
  const tier = isLal ? 'T0'
    : segment === 'purchasers' ? 'T3'
    : segment === 'atc' || segment === 'checkout' || segment === 'viewers' || segment === 'visitors' ? 'T2'
    : segment === 'engaged' || segment === 'video' ? 'T1'
    : 'T2';

  const size = a.size_upper ?? 0;
  const delivering = (a.delivery_status || '').toUpperCase() === 'ACTIVE';

  // A lookalike reports a placeholder size, so judge it on delivery only.
  let health, healthNote;
  if (isLal) {
    health = delivering ? 'ok' : 'broken';
    healthNote = delivering
      ? 'Delivering. Confirm the seed behind it is real before scaling into it.'
      : 'Cannot deliver — almost always because its source audience is empty or below Meta\'s minimum.';
  } else if (size < LAL_HARD_MIN) {
    health = 'broken';
    healthNote = `Only ~${size} accounts. Below Meta's ${LAL_HARD_MIN} minimum, so it cannot seed a lookalike and is useless for retargeting.`;
  } else if (size < LAL_SEED_FLOOR) {
    health = 'weak';
    healthNote = `~${size.toLocaleString('en-US')} accounts. Usable but thin — lookalikes from this will be low quality.`;
  } else if (size < LAL_GOOD_SEED) {
    health = 'ok';
    healthNote = `~${size.toLocaleString('en-US')} accounts. Workable seed.`;
  } else {
    health = 'strong';
    healthNote = `~${size.toLocaleString('en-US')} accounts. Strong enough to seed lookalikes and to retarget directly.`;
  }
  if (!delivering && !isLal && health !== 'broken') {
    health = 'weak';
    healthNote += ' Not currently in an active delivery state.';
  }

  return { tier, segment, isLal, size, delivering, health, healthNote };
}

/** Largest audience found for a segment, used to answer "is this rung buildable". */
function seedSizeFactory(audiences) {
  return (segment) => {
    const matches = audiences.filter((a) => a.classification.segment === segment && !a.classification.isLal);
    return matches.reduce((max, a) => Math.max(max, a.classification.size || 0), 0);
  };
}

export function buildAudienceModel(audiences, { hasCustomerList = false, hasCreator = false, monthlyBudget = 0 } = {}) {
  const enriched = audiences.map((a) => ({ ...a, classification: classifyAudience(a) }));
  const ctx = { seedSize: seedSizeFactory(enriched), hasCustomerList, hasCreator };

  const byTier = {};
  for (const t of Object.keys(TIERS)) {
    byTier[t] = enriched.filter((a) => a.classification.tier === t);
  }

  const plan = BLUEPRINT.map((rung) => {
    let ready = false;
    try { ready = Boolean(rung.readyWhen(ctx)); } catch { ready = false; }
    // Does something matching this rung already exist and work? Rungs that need
    // no saved audience (broad, interests, creator) carry matchSegment: null.
    const existing = rung.matchSegment
      ? enriched.find((a) => a.classification.segment === rung.matchSegment
          && a.classification.isLal === rung.matchLal
          && a.classification.health !== 'broken')
      : null;
    const status = ready && existing && existing.classification.health !== 'broken' ? 'live'
      : ready ? 'buildable'
      : 'blocked';
    return { ...rung, tierLabel: TIERS[rung.tier].label, ready, status, existingId: existing?.id || null, existingName: existing?.name || null };
  }).sort((a, b) => a.priority - b.priority);

  const budgetSplit = Object.values(TIERS).map((t) => ({
    tier: t.key, label: t.label, share: t.budgetShare,
    monthly: Math.round(monthlyBudget * t.budgetShare),
    daily: Math.round((monthlyBudget * t.budgetShare) / 30),
  }));

  const healthCounts = enriched.reduce((acc, a) => {
    acc[a.classification.health] = (acc[a.classification.health] || 0) + 1;
    return acc;
  }, {});

  return {
    audiences: enriched,
    byTier,
    tiers: TIERS,
    plan,
    budgetSplit,
    healthCounts,
    naming: {
      pattern: 'AF-COS | {TIER} | {SEGMENT} | {WINDOW} | {GEO}',
      examples: [
        'AF-COS | T0-COLD | BROAD-ADV+ | – | EG',
        'AF-COS | T0-COLD | LAL1-PUR180 | – | EG',
        'AF-COS | T2-HOT | IC-NOPUR | 7d | EG',
        'AF-COS | T3-CUST | REPLENISH | 31-90d | EG',
      ],
      why: 'Prefix by business line so cosmetics, studio and dresses never blend in reporting. Tier tells you what the ad set is for at a glance, window makes the recency explicit, and geo keeps Egypt and UAE separable — the two behave nothing alike in this account.',
    },
    exclusionMatrix: BLUEPRINT.map((r) => ({ id: r.id, tier: r.tier, name: r.name, excludes: r.excludes })),
  };
}

/**
 * The ordered path to new customers, given what the account can actually build
 * today. Blocked rungs come with the unblocking step rather than being hidden.
 */
export function newCustomerPath(model) {
  const cold = model.plan.filter((r) => r.tier === 'T0');
  const steps = [];
  const buildable = cold.filter((r) => r.status !== 'blocked').sort((a, b) => a.priority - b.priority);
  const blocked = cold.filter((r) => r.status === 'blocked').sort((a, b) => a.priority - b.priority);

  for (const r of buildable) {
    steps.push({
      order: steps.length + 1, id: r.id, name: r.name, kind: 'launch',
      action: `Launch "${r.name}" — ${r.definition}`,
      rationale: r.purpose,
      excludes: r.excludes,
      blocked: false,
    });
  }
  for (const r of blocked) {
    steps.push({
      order: steps.length + 1, id: r.id, name: r.name, kind: 'unblock',
      action: `Unblock "${r.name}" — ${r.prerequisite}`,
      rationale: r.purpose,
      excludes: r.excludes,
      blocked: true,
    });
  }
  return steps;
}

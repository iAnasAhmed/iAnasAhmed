/**
 * Aggregation helpers. Every rate is recomputed from raw counts after summing,
 * never averaged from per-row rates - averaging rates across days with different
 * spend is the single most common way media dashboards lie.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const EMPTY = {
  spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, purchases: 0, revenue: 0,
  addToCart: 0, initiateCheckout: 0, viewContent: 0, landingPageViews: 0,
  messagingStarted: 0, leads: 0, videoViews: 0, days: 0,
};

export function aggregate(rows = []) {
  const t = { ...EMPTY };
  for (const r of rows) {
    t.spend += num(r.spend);
    t.impressions += num(r.impressions);
    t.reach += num(r.reach);            // summed reach over-counts repeat accounts; see reachNote
    t.clicks += num(r.clicks);
    t.linkClicks += num(r.link_clicks ?? r.linkClicks);
    t.purchases += num(r.purchases);
    t.revenue += num(r.revenue);
    t.addToCart += num(r.add_to_cart ?? r.addToCart);
    t.initiateCheckout += num(r.initiate_checkout ?? r.initiateCheckout);
    t.viewContent += num(r.view_content ?? r.viewContent);
    t.landingPageViews += num(r.landing_page_views ?? r.landingPageViews);
    t.messagingStarted += num(r.messaging_started ?? r.messagingStarted);
    t.leads += num(r.leads);
    t.videoViews += num(r.video_views ?? r.videoViews);
    t.days += 1;
  }
  return withRates(t);
}

export function withRates(t) {
  const d = { ...t };
  d.ctr = t.impressions ? (t.clicks / t.impressions) * 100 : 0;
  d.linkCtr = t.impressions ? (t.linkClicks / t.impressions) * 100 : 0;
  d.cpc = t.clicks ? t.spend / t.clicks : 0;
  d.cpm = t.impressions ? (t.spend / t.impressions) * 1000 : 0;
  d.cpa = t.purchases ? t.spend / t.purchases : 0;
  d.roas = t.spend ? t.revenue / t.spend : 0;
  d.aov = t.purchases ? t.revenue / t.purchases : 0;
  d.costPerLinkClick = t.linkClicks ? t.spend / t.linkClicks : 0;
  d.costPerMessage = t.messagingStarted ? t.spend / t.messagingStarted : 0;
  // Frequency across a multi-day window is impressions / summed daily reach.
  // It reads slightly low versus Ads Manager's de-duplicated reach, so treat it
  // as a floor: if this says fatigue, Ads Manager says worse.
  d.frequency = t.reach ? t.impressions / t.reach : 0;
  d.lpvRate = t.linkClicks ? (t.landingPageViews / t.linkClicks) * 100 : 0;
  d.atcRate = t.viewContent ? (t.addToCart / t.viewContent) * 100 : 0;
  d.checkoutRate = t.addToCart ? (t.initiateCheckout / t.addToCart) * 100 : 0;
  d.purchaseRate = t.initiateCheckout ? (t.purchases / t.initiateCheckout) * 100 : 0;
  d.dailySpend = t.days ? t.spend / t.days : 0;
  return d;
}

export const toDate = (s) => new Date(`${s}T00:00:00Z`);
export const isoDay = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => isoDay(new Date(toDate(iso).getTime() + n * 86400000));

/** Rows within the `days`-long window ending `offset` days before the last date. */
export function windowRows(rows, days, offset = 0) {
  if (!rows.length) return [];
  const last = rows[rows.length - 1].date;
  const end = addDays(last, -offset);
  const start = addDays(end, -(days - 1));
  return rows.filter((r) => r.date >= start && r.date <= end);
}

export const pctChange = (current, previous) => {
  if (!Number.isFinite(previous) || previous === 0) return current > 0 ? Infinity : 0;
  return ((current - previous) / previous) * 100;
};

/** Current window vs the window immediately before it. */
export function compareWindows(rows, days = 7) {
  const current = aggregate(windowRows(rows, days, 0));
  const previous = aggregate(windowRows(rows, days, days));
  const delta = {};
  for (const k of ['spend', 'impressions', 'reach', 'clicks', 'purchases', 'revenue', 'ctr', 'cpm', 'cpc', 'cpa', 'roas', 'frequency', 'aov', 'landingPageViews']) {
    delta[k] = pctChange(current[k], previous[k]);
  }
  return { current, previous, delta, days };
}

/**
 * Days inside the observed range where nothing was delivered. Stop-start
 * delivery resets the learning phase, so these gaps are a real finding rather
 * than cosmetic missing data.
 */
export function detectGaps(rows, { minSpend = 1 } = {}) {
  if (rows.length < 2) return [];
  const spendByDate = new Map(rows.map((r) => [r.date, num(r.spend)]));
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  const gaps = [];
  let cursor = first;
  let run = null;
  while (cursor <= last) {
    const spend = spendByDate.get(cursor) ?? 0;
    if (spend < minSpend) {
      if (!run) run = { start: cursor, end: cursor, days: 1 };
      else { run.end = cursor; run.days += 1; }
    } else if (run) { gaps.push(run); run = null; }
    cursor = addDays(cursor, 1);
  }
  if (run) gaps.push(run);
  return gaps;
}

/** Least-squares slope per day, expressed as % of the mean, for trend calls. */
export function trendSlope(rows, key) {
  const pts = rows.map((r, i) => [i, num(r[key])]).filter(([, y]) => Number.isFinite(y));
  const n = pts.length;
  if (n < 3) return 0;
  const sumX = pts.reduce((s, [x]) => s + x, 0);
  const sumY = pts.reduce((s, [, y]) => s + y, 0);
  const sumXY = pts.reduce((s, [x, y]) => s + x * y, 0);
  const sumXX = pts.reduce((s, [x]) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (!denom) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const mean = sumY / n;
  return mean ? (slope / mean) * 100 : 0;
}

/** Daily rows with rates attached, for charting. */
export function seriesWithRates(rows) {
  return rows.map((r) => {
    const base = {
      date: r.date,
      spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach),
      clicks: num(r.clicks), linkClicks: num(r.link_clicks ?? r.linkClicks),
      purchases: num(r.purchases), revenue: num(r.revenue),
      landingPageViews: num(r.landing_page_views ?? r.landingPageViews),
      addToCart: num(r.add_to_cart ?? r.addToCart),
      initiateCheckout: num(r.initiate_checkout ?? r.initiateCheckout),
      messagingStarted: num(r.messaging_started ?? r.messagingStarted),
      source: r.source || 'live',
    };
    base.days = 1;
    return withRates(base);
  });
}

/** Centred rolling mean, used to smooth noisy daily ROAS/CTR lines. */
export function rolling(series, key, window = 7) {
  return series.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = series.slice(from, i + 1);
    const sum = slice.reduce((s, r) => s + num(r[key]), 0);
    return slice.length ? sum / slice.length : 0;
  });
}

/** Group daily rows into calendar months, recomputing rates per month. */
export function byMonth(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month).push(r);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rs]) => ({ month, ...aggregate(rs), activeDays: rs.filter((r) => num(r.spend) > 0).length }));
}

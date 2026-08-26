import type { Env } from './types';
import { hmacBase64, safeEqual, verifyAppProxy } from './hmac';
import { fetchReview, isRewardableReview, reviewTier } from './judgeme';
import {
  createRedemptionDiscount,
  findCustomerByEmail,
  hasQualifyingOrder,
  numericId,
} from './shopify';
import {
  award,
  balanceOf,
  history,
  orderPoints,
  redemptionCode,
  redemptionError,
  redemptionValue,
  reviewPoints,
} from './points';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') return json({ ok: true });
      if (request.method === 'POST' && url.pathname === '/webhooks/judgeme') return judgemeWebhook(request, env);
      if (request.method === 'POST' && url.pathname === '/webhooks/shopify/orders-paid') return shopifyOrderWebhook(request, env);
      if (request.method === 'POST' && url.pathname === '/webhooks/shopify/refunds-create') return shopifyRefundWebhook(request, env);
      if (request.method === 'GET' && url.pathname === '/apps/points') return proxyBalance(request, env, url);
      if (request.method === 'POST' && url.pathname === '/apps/points/redeem') return proxyRedeem(request, env, url);
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('unhandled', String(err));
      return json({ error: 'internal error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// --- Judge.me: award points for a verified-buyer review ---------------------

async function judgemeWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  const header =
    request.headers.get('JUDGEME-HMAC-SHA256') ??
    request.headers.get('X-Judgeme-Hmac-Sha256') ??
    '';
  if (!header || !safeEqual(await hmacBase64(env.JUDGEME_WEBHOOK_SECRET, raw), header)) {
    return json({ error: 'bad signature' }, 401);
  }

  const payload = JSON.parse(raw) as { id?: number; review?: { id?: number } };
  const reviewId = payload.id ?? payload.review?.id;
  if (!reviewId) return json({ skipped: 'no review id' });

  // Never trust the webhook body for entitlement - re-read the review.
  const review = await fetchReview(env, reviewId);
  if (!review) return json({ skipped: 'review not found' });

  const gate = isRewardableReview(review, Number(env.REVIEW_MIN_BODY_CHARS));
  if (!gate.ok) return json({ skipped: gate.why, review_id: reviewId });

  const email = review.reviewer!.email!;
  const customer = await findCustomerByEmail(env, email);
  if (!customer) return json({ skipped: 'no shopify customer for reviewer email', review_id: reviewId });

  const order = await hasQualifyingOrder(env, email, review.product_external_id);
  if (!order.ok) return json({ skipped: order.why, review_id: reviewId });

  const tier = reviewTier(review);
  const result = await award(env, {
    customerId: numericId(customer.id),
    email,
    points: reviewPoints(env, tier),
    reason: tier,
    sourceType: 'judgeme_review',
    sourceId: String(review.id),
    meta: { rating: review.rating, product_external_id: review.product_external_id, order: order.orderName },
  });

  return json({ awarded: result.applied, points: reviewPoints(env, tier), balance: result.balance, review_id: reviewId });
}

// --- Shopify: award points for spend, claw back on refund -------------------

async function verifyShopifyWebhook(request: Request, env: Env): Promise<string | null> {
  const raw = await request.text();
  const header = request.headers.get('X-Shopify-Hmac-Sha256') ?? '';
  if (!header || !safeEqual(await hmacBase64(env.SHOPIFY_WEBHOOK_SECRET, raw), header)) return null;
  return raw;
}

async function shopifyOrderWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await verifyShopifyWebhook(request, env);
  if (raw === null) return json({ error: 'bad signature' }, 401);

  const order = JSON.parse(raw) as {
    id: number; name: string; cancelled_at: string | null;
    current_total_price?: string; total_price?: string;
    customer?: { id: number; email?: string } | null;
  };
  if (order.cancelled_at) return json({ skipped: 'cancelled' });
  if (!order.customer?.id) return json({ skipped: 'guest checkout' });

  const amount = Number(order.current_total_price ?? order.total_price ?? '0');
  const points = orderPoints(env, amount);
  if (points <= 0) return json({ skipped: 'zero points' });

  const result = await award(env, {
    customerId: String(order.customer.id),
    email: order.customer.email ?? null,
    points,
    reason: 'order',
    sourceType: 'shopify_order',
    sourceId: String(order.id),
    meta: { order: order.name, amount, currency: env.STORE_CURRENCY },
  });

  return json({ awarded: result.applied, points, balance: result.balance });
}

async function shopifyRefundWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await verifyShopifyWebhook(request, env);
  if (raw === null) return json({ error: 'bad signature' }, 401);

  const refund = JSON.parse(raw) as {
    id: number; order_id: number;
    transactions?: Array<{ amount: string; kind: string; status: string }>;
  };

  const refunded = (refund.transactions ?? [])
    .filter((t) => t.kind === 'refund' && t.status === 'success')
    .reduce((sum, t) => sum + Number(t.amount), 0);
  if (refunded <= 0) return json({ skipped: 'no refunded amount' });

  const original = await env.DB
    .prepare('SELECT customer_id, email FROM ledger WHERE source_type = ? AND source_id = ?')
    .bind('shopify_order', String(refund.order_id))
    .first<{ customer_id: string; email: string | null }>();
  if (!original) return json({ skipped: 'no points were awarded for this order' });

  const points = orderPoints(env, refunded);
  if (points <= 0) return json({ skipped: 'zero points' });

  const result = await award(env, {
    customerId: original.customer_id,
    email: original.email,
    points: -points,
    reason: 'refund_clawback',
    sourceType: 'shopify_refund',
    sourceId: String(refund.id),
    meta: { order_id: refund.order_id, refunded },
  });

  return json({ applied: result.applied, points: -points, balance: result.balance });
}

// --- Storefront (Shopify App Proxy) ----------------------------------------

async function proxyCustomerId(env: Env, url: URL): Promise<string | null> {
  if (!(await verifyAppProxy(url, env.SHOPIFY_API_SECRET))) return null;
  return url.searchParams.get('logged_in_customer_id');
}

async function proxyBalance(request: Request, env: Env, url: URL): Promise<Response> {
  const customerId = await proxyCustomerId(env, url);
  if (customerId === null) return json({ error: 'unauthorized' }, 401);
  if (!customerId) return json({ logged_in: false, balance: 0, history: [] });

  return json({
    logged_in: true,
    balance: await balanceOf(env, customerId),
    history: await history(env, customerId),
    currency: env.STORE_CURRENCY,
    redeem: {
      min_points: Number(env.REDEEM_MIN_POINTS),
      step_points: Number(env.REDEEM_STEP_POINTS),
      value_per_point: Number(env.REDEEM_EGP_PER_POINT),
    },
  });
}

async function proxyRedeem(request: Request, env: Env, url: URL): Promise<Response> {
  const customerId = await proxyCustomerId(env, url);
  if (customerId === null) return json({ error: 'unauthorized' }, 401);
  if (!customerId) return json({ error: 'log in to redeem' }, 403);

  const body = (await request.json().catch(() => ({}))) as { points?: number };
  const points = Number(body.points ?? 0);
  const balance = await balanceOf(env, customerId);

  const problem = redemptionError(env, points, balance);
  if (problem) return json({ error: problem, balance }, 400);

  // Spend first: if discount creation fails we refund the ledger row, so a
  // crash can never hand out a code that was not paid for in points.
  const code = redemptionCode(env);
  const spent = await award(env, {
    customerId,
    points: -points,
    reason: 'redeem',
    sourceType: 'redemption',
    sourceId: code,
    meta: { code },
  });
  if (!spent.applied) return json({ error: 'redemption already processed' }, 409);

  const amount = redemptionValue(env, points);
  try {
    const gid = await createRedemptionDiscount(env, customerId, code, amount);
    const ttl = Number(env.REDEEM_CODE_TTL_DAYS || '60');
    await env.DB
      .prepare(`INSERT INTO redemptions (customer_id, points_spent, value_amount, currency, code, discount_gid, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(customerId, points, amount, env.STORE_CURRENCY, code, gid,
            new Date(Date.now() + ttl * 86400_000).toISOString())
      .run();
    return json({ code, points_spent: points, value: amount, currency: env.STORE_CURRENCY, balance: spent.balance });
  } catch (err) {
    await award(env, {
      customerId,
      points,
      reason: 'redeem_reversal',
      sourceType: 'redemption_reversal',
      sourceId: code,
      meta: { code, error: String(err) },
    });
    console.error('redeem failed, points returned', String(err));
    return json({ error: 'could not issue discount code, your points were returned' }, 502);
  }
}

import type { Env } from './types';

type Gql = { data?: any; errors?: Array<{ message: string }>; };

export async function adminGraphQL<T = any>(env: Env, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(
    `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  if (!res.ok) throw new Error(`shopify ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Gql;
  if (json.errors?.length) throw new Error(`shopify graphql: ${json.errors.map((e) => e.message).join('; ')}`);
  return json.data as T;
}

export const numericId = (gid: string) => gid.split('/').pop() as string;
export const customerGid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/Customer/${id}`);

export async function findCustomerByEmail(env: Env, email: string): Promise<{ id: string; email: string | null } | null> {
  const data = await adminGraphQL(env, `
    query($q: String!) {
      customers(first: 1, query: $q) { nodes { id defaultEmailAddress { emailAddress } } }
    }
  `, { q: `email:"${email.replace(/"/g, '')}"` });
  const node = data.customers.nodes[0];
  return node ? { id: node.id, email: node.defaultEmailAddress?.emailAddress ?? null } : null;
}

/**
 * The real verified-buyer gate.
 *
 * Judge.me's own `verified: "buyer"` only means "this email has an order".
 * On a COD store that includes orders that were never collected, so we
 * re-check against Shopify: order not cancelled, and either paid (COD money
 * actually collected) or fulfilled, depending on VERIFIED_BUYER_RULE - and,
 * when REQUIRE_SAME_PRODUCT is on, that the order contains the reviewed product.
 */
export async function hasQualifyingOrder(
  env: Env,
  email: string,
  productLegacyId: number | null,
): Promise<{ ok: boolean; orderName?: string; why: string }> {
  const data = await adminGraphQL(env, `
    query($q: String!) {
      orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $q) {
        nodes {
          name
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          lineItems(first: 100) { nodes { product { legacyResourceId } } }
        }
      }
    }
  `, { q: `email:"${email.replace(/"/g, '')}"` });

  const rule = env.VERIFIED_BUYER_RULE === 'fulfilled' ? 'fulfilled' : 'paid';
  const requireProduct = env.REQUIRE_SAME_PRODUCT === 'true' && productLegacyId != null;

  for (const o of data.orders.nodes as any[]) {
    if (o.cancelledAt) continue;
    if (rule === 'paid' && !['PAID', 'PARTIALLY_REFUNDED'].includes(o.displayFinancialStatus)) continue;
    if (rule === 'fulfilled' && o.displayFulfillmentStatus !== 'FULFILLED') continue;
    if (requireProduct) {
      const ids = o.lineItems.nodes.map((li: any) => li.product?.legacyResourceId).filter(Boolean);
      if (!ids.includes(String(productLegacyId))) continue;
    }
    return { ok: true, orderName: o.name, why: '' };
  }
  return { ok: false, why: requireProduct ? `no ${rule} order containing product ${productLegacyId}` : `no ${rule} order` };
}

/** Mirror the balance onto the customer so it shows in admin, Flow and the theme. */
export async function writeBalanceMetafield(env: Env, customerId: string, balance: number): Promise<void> {
  const data = await adminGraphQL(env, `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }
  `, {
    metafields: [{
      ownerId: customerGid(customerId),
      namespace: 'loyalty',
      key: 'points_balance',
      type: 'number_integer',
      value: String(balance),
    }],
  });
  const errs = data.metafieldsSet.userErrors;
  if (errs?.length) throw new Error(`metafieldsSet: ${errs.map((e: any) => e.message).join('; ')}`);
}

export async function createRedemptionDiscount(
  env: Env,
  customerId: string,
  code: string,
  amount: number,
): Promise<string> {
  const ttl = Number(env.REDEEM_CODE_TTL_DAYS || '60');
  const endsAt = new Date(Date.now() + ttl * 86400_000).toISOString();
  const minSubtotal = amount * Number(env.REDEEM_MIN_SUBTOTAL_MULTIPLIER || '2');

  const data = await adminGraphQL(env, `
    mutation($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      title: `Loyalty points redemption - ${code}`,
      code,
      startsAt: new Date().toISOString(),
      endsAt,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerSelection: { customers: { add: [customerGid(customerId)] } },
      customerGets: {
        value: { discountAmount: { amount: amount.toFixed(2), appliesOnEachItem: false } },
        items: { all: true },
      },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: minSubtotal.toFixed(2) } },
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    },
  });

  const errs = data.discountCodeBasicCreate.userErrors;
  if (errs?.length) throw new Error(`discountCodeBasicCreate: ${errs.map((e: any) => e.message).join('; ')}`);
  return data.discountCodeBasicCreate.codeDiscountNode.id as string;
}

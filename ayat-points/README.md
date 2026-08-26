# ayat-points

Loyalty points for **Ayat Fahiem Cosmetics** (`6x4bcd-rk.myshopify.com` / ayatfahiem.com),
earned by Judge.me **verified buyers** and redeemed as customer-locked Shopify
discount codes. Cloudflare Worker + D1. No monthly app fee, no per-order cap.

## Why not just install a loyalty app

Joy, Rivo, Smile and LoyaltyLion all have a native Judge.me "points for reviews"
integration and are a 20-minute install — that is the fast path if you want this
live tomorrow. Two reasons this exists instead:

1. **Their "verified" is not your verified.** Judge.me marks a review
   `verified: "buyer"` when the reviewer's email has *any* order. On a COD store
   that includes orders that were shipped and refused. This service re-checks
   Shopify: order not cancelled, financially **paid** (COD actually collected),
   and containing the product that was reviewed.
2. Step 3 of this project is a design pass. Owning the widget beats theming
   someone else's iframe.

## Earning and redemption

| Action | Points |
|---|---|
| Text review (verified buyer, ≥15 chars) | 50 |
| Photo review | 100 |
| Video review | 150 |
| Every 1 EGP spent | 0.05 (1,000 EGP order → 50 pts) |
| Refund | clawed back pro-rata |

Redemption: 200 pts minimum, in steps of 100, at 0.25 EGP/point → 200 pts = 50 EGP
off, as a single-use code locked to that customer, valid 60 days, requiring a
subtotal of at least 2× the discount. All of it is in `[vars]` in `wrangler.toml`.

## Setup

1. **Custom app** — Shopify admin → Settings → Apps → Develop apps → Create app
   "Ayat Points". Admin API scopes: `read_customers`, `write_customers`,
   `read_orders`, `read_products`, `read_discounts`, `write_discounts`.
   Install it; copy the Admin API access token and the API secret key.

2. **Judge.me** — Judge.me admin → Settings → Integrations → API. Copy the API
   token. Create an OAuth app to get the webhook secret, and point
   `review/created` and `review/published` at
   `https://ayat-points.<subdomain>.workers.dev/webhooks/judgeme`.
   (API + webhooks are paid-plan features.)

3. **Database**
   ```bash
   npx wrangler d1 create ayat-points     # paste database_id into wrangler.toml
   npm run db:init
   ```

4. **Secrets**
   ```bash
   npx wrangler secret put SHOPIFY_ADMIN_TOKEN
   npx wrangler secret put SHOPIFY_API_SECRET
   npx wrangler secret put SHOPIFY_WEBHOOK_SECRET
   npx wrangler secret put JUDGEME_API_TOKEN
   npx wrangler secret put JUDGEME_WEBHOOK_SECRET
   npm run deploy
   ```

5. **Shopify webhooks** — Settings → Notifications → Webhooks:
   - `orders/paid` → `/webhooks/shopify/orders-paid`
   - `refunds/create` → `/webhooks/shopify/refunds-create`
   The signing secret shown on that page is `SHOPIFY_WEBHOOK_SECRET`.

6. **App Proxy** — in the custom app: subpath prefix `apps`, subpath `points`,
   proxy URL `https://ayat-points.<subdomain>.workers.dev/apps/points`.
   That makes `/apps/points` on the storefront hit the Worker with a signed
   `logged_in_customer_id`.

7. **Theme** — drop `theme/points-widget.liquid` into `snippets/` and render it on
   the account page. Unstyled on purpose; that is the next session.

## Endpoints

| Route | Auth |
|---|---|
| `POST /webhooks/judgeme` | `JUDGEME-HMAC-SHA256` |
| `POST /webhooks/shopify/orders-paid` | `X-Shopify-Hmac-Sha256` |
| `POST /webhooks/shopify/refunds-create` | `X-Shopify-Hmac-Sha256` |
| `GET  /apps/points` | App Proxy signature |
| `POST /apps/points/redeem` | App Proxy signature |
| `GET  /health` | none |

## Design notes

- The **ledger is the source of truth**; the balance is `SUM(points)`. The
  customer metafield `loyalty.points_balance` is a mirror for admin, Flow and
  Liquid — if the mirror write fails the points are still banked.
- A unique index on `(source_type, source_id)` makes every webhook idempotent.
  Judge.me fires `review/created` *and* `review/published` for the same review;
  only the first one credits.
- Webhook bodies are never trusted for entitlement. The Judge.me handler re-reads
  the review from the API and re-checks the order in Shopify before crediting.
- Redemption spends points *before* creating the discount and reverses the ledger
  row if Shopify errors, so a crash can never mint an unpaid-for code.

## Not verified here

`npm install` is blocked by this environment's egress policy, so `tsc` has not
been run against this code. The four Admin GraphQL operations were validated
against the live schema. Run `npm run typecheck` before the first deploy.

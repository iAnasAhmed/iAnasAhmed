-- Points ledger. Balance is always SUM(points) over a customer's rows, so a
-- replayed webhook can never silently double-credit: source_type+source_id is
-- unique and the insert is idempotent.
CREATE TABLE IF NOT EXISTS ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   TEXT    NOT NULL,          -- Shopify numeric customer id
  email         TEXT,
  points        INTEGER NOT NULL,          -- positive = earned, negative = spent/clawed back
  reason        TEXT    NOT NULL,          -- review_text | review_photo | review_video | order | redeem | refund_clawback
  source_type   TEXT    NOT NULL,          -- judgeme_review | shopify_order | redemption | shopify_refund
  source_id     TEXT    NOT NULL,
  meta          TEXT,                      -- JSON blob (product id, review rating, order name, discount code...)
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_source_uniq ON ledger (source_type, source_id);
CREATE INDEX IF NOT EXISTS ledger_customer_idx ON ledger (customer_id);

-- Redemptions issued as Shopify discount codes.
CREATE TABLE IF NOT EXISTS redemptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    TEXT NOT NULL,
  points_spent   INTEGER NOT NULL,
  value_amount   REAL NOT NULL,
  currency       TEXT NOT NULL,
  code           TEXT NOT NULL UNIQUE,
  discount_gid   TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS redemptions_customer_idx ON redemptions (customer_id);

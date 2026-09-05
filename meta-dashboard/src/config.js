import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// dotenv leaves already-set process.env vars alone (no `override`), so a real
// environment variable always wins over what's in .env - same semantics the
// hand-rolled parser this replaces had.
dotenv.config({ path: path.join(ROOT, '.env') });

const num = (v, fallback) => {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const list = (v) => String(v || '').split(',').map((s) => s.trim().replace(/^act_/, '')).filter(Boolean);

export const config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),
  dbPath: path.join(ROOT, 'data', 'meta.db'),

  accessToken: process.env.META_ACCESS_TOKEN || '',
  apiVersion: process.env.META_API_VERSION || 'v23.0',
  accountId: String(process.env.META_AD_ACCOUNT_ID || '1119657799748776').replace(/^act_/, ''),
  extraAccounts: list(process.env.META_EXTRA_AD_ACCOUNTS),
  pixelId: process.env.META_PIXEL_ID || '',

  business: {
    grossMargin: num(process.env.BUSINESS_GROSS_MARGIN, 0.55),
    targetRoas: num(process.env.TARGET_ROAS, 4.0),
    targetCpa: num(process.env.TARGET_CPA, 220),
    averageOrderValue: num(process.env.AVERAGE_ORDER_VALUE, null),
    monthlyBudget: num(process.env.MONTHLY_BUDGET, 70000),
  },

  port: num(process.env.PORT, 4300),
  syncIntervalMinutes: num(process.env.SYNC_INTERVAL_MINUTES, 15),
  syncOnBoot: String(process.env.SYNC_ON_BOOT ?? '1') === '1',
};

/** Break-even ROAS implied by gross margin: below this, every sale loses money. */
export const breakEvenRoas = () => (config.business.grossMargin > 0 ? 1 / config.business.grossMargin : 0);

export const hasToken = () => Boolean(config.accessToken);

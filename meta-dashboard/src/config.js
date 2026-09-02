import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader - no dependency, tolerates quotes, comments and blank lines. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

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

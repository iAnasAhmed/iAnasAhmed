import type { Env } from './types';
import { writeBalanceMetafield } from './shopify';

export interface LedgerEntry {
  customerId: string;
  email?: string | null;
  points: number;
  reason: string;
  sourceType: string;
  sourceId: string;
  meta?: Record<string, unknown>;
}

export async function balanceOf(env: Env, customerId: string): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COALESCE(SUM(points), 0) AS balance FROM ledger WHERE customer_id = ?')
    .bind(customerId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}

export async function history(env: Env, customerId: string, limit = 25) {
  const { results } = await env.DB
    .prepare('SELECT points, reason, source_type, source_id, meta, created_at FROM ledger WHERE customer_id = ? ORDER BY id DESC LIMIT ?')
    .bind(customerId, limit)
    .all();
  return results;
}

/**
 * Insert one ledger row. Returns false when the row already existed - the
 * unique index on (source_type, source_id) is what makes webhook retries and
 * duplicate review/created + review/published events safe.
 */
export async function award(env: Env, e: LedgerEntry): Promise<{ applied: boolean; balance: number }> {
  const res = await env.DB
    .prepare(`INSERT OR IGNORE INTO ledger (customer_id, email, points, reason, source_type, source_id, meta)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(e.customerId, e.email ?? null, e.points, e.reason, e.sourceType, e.sourceId, JSON.stringify(e.meta ?? {}))
    .run();

  const applied = (res.meta?.changes ?? 0) > 0;
  const balance = await balanceOf(env, e.customerId);
  if (applied) {
    try {
      await writeBalanceMetafield(env, e.customerId, balance);
    } catch (err) {
      // The ledger is the source of truth; a failed mirror must not lose points.
      console.error('metafield mirror failed', String(err));
    }
  }
  return { applied, balance };
}

export function reviewPoints(env: Env, tier: 'review_text' | 'review_photo' | 'review_video'): number {
  if (tier === 'review_video') return Number(env.REVIEW_VIDEO_POINTS);
  if (tier === 'review_photo') return Number(env.REVIEW_PHOTO_POINTS);
  return Number(env.REVIEW_TEXT_POINTS);
}

export function orderPoints(env: Env, amount: number): number {
  return Math.floor(amount * Number(env.ORDER_POINTS_PER_CURRENCY));
}

export function redemptionValue(env: Env, points: number): number {
  return Math.round(points * Number(env.REDEEM_EGP_PER_POINT) * 100) / 100;
}

export function redemptionError(env: Env, points: number, balance: number): string | null {
  const min = Number(env.REDEEM_MIN_POINTS);
  const step = Number(env.REDEEM_STEP_POINTS);
  if (!Number.isInteger(points) || points <= 0) return 'invalid points amount';
  if (points < min) return `minimum redemption is ${min} points`;
  if (points % step !== 0) return `points must be a multiple of ${step}`;
  if (points > balance) return 'not enough points';
  return null;
}

export function redemptionCode(env: Env): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${env.REDEEM_CODE_PREFIX}-${rand}`;
}

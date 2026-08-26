import type { Env, JudgeMeReview } from './types';

const API = 'https://judge.me/api/v1';

/**
 * Re-read the review from Judge.me instead of trusting the webhook body.
 * The webhook only tells us *which* review changed; entitlement decisions
 * (verified, published, curated) are made on this authoritative copy.
 */
export async function fetchReview(env: Env, id: number | string): Promise<JudgeMeReview | null> {
  const qs = new URLSearchParams({
    api_token: env.JUDGEME_API_TOKEN,
    shop_domain: env.JUDGEME_SHOP_DOMAIN,
  });
  const res = await fetch(`${API}/reviews/${id}?${qs}`, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`judge.me ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { review?: JudgeMeReview };
  return json.review ?? null;
}

export function isRewardableReview(r: JudgeMeReview, minBodyChars: number): { ok: boolean; why: string } {
  if (r.verified !== 'buyer') return { ok: false, why: 'not a verified buyer review' };
  if (!r.published) return { ok: false, why: 'review not published' };
  if (r.hidden) return { ok: false, why: 'review hidden' };
  if (r.curated && r.curated !== 'ok') return { ok: false, why: `curated=${r.curated}` };
  if ((r.body ?? '').trim().length < minBodyChars) return { ok: false, why: 'body too short' };
  if (!r.reviewer?.email) return { ok: false, why: 'no reviewer email' };
  return { ok: true, why: '' };
}

export function reviewTier(r: JudgeMeReview): 'review_video' | 'review_photo' | 'review_text' {
  if (r.has_published_videos) return 'review_video';
  if (r.has_published_pictures || (Array.isArray(r.pictures) && r.pictures.length > 0)) return 'review_photo';
  return 'review_text';
}

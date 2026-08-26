export interface Env {
  DB: D1Database;

  // vars
  SHOPIFY_SHOP_DOMAIN: string;
  SHOPIFY_API_VERSION: string;
  JUDGEME_SHOP_DOMAIN: string;
  STORE_CURRENCY: string;
  REVIEW_TEXT_POINTS: string;
  REVIEW_PHOTO_POINTS: string;
  REVIEW_VIDEO_POINTS: string;
  REVIEW_MIN_BODY_CHARS: string;
  ORDER_POINTS_PER_CURRENCY: string;
  VERIFIED_BUYER_RULE: string;
  REQUIRE_SAME_PRODUCT: string;
  REDEEM_MIN_POINTS: string;
  REDEEM_STEP_POINTS: string;
  REDEEM_EGP_PER_POINT: string;
  REDEEM_CODE_PREFIX: string;
  REDEEM_CODE_TTL_DAYS: string;
  REDEEM_MIN_SUBTOTAL_MULTIPLIER: string;

  // secrets
  SHOPIFY_ADMIN_TOKEN: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_WEBHOOK_SECRET: string;
  JUDGEME_API_TOKEN: string;
  JUDGEME_WEBHOOK_SECRET: string;
}

export interface JudgeMeReview {
  id: number;
  title: string | null;
  body: string | null;
  rating: number;
  product_external_id: number | null;
  reviewer: { id: number; external_id: number | null; email: string | null; name: string | null } | null;
  source: string | null;
  curated: string | null;      // "ok" | "spam" | "pending"
  published: boolean;
  hidden: boolean;
  verified: string | null;     // "buyer" when Judge.me matched the reviewer to an order
  created_at: string;
  pictures?: unknown[];
  has_published_pictures?: boolean;
  has_published_videos?: boolean;
}

export type EarnReason = 'review_text' | 'review_photo' | 'review_video' | 'order';

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacBase64(secret: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-safe, timing-safe string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Shopify App Proxy signature: params sorted by key, each rendered as
 * `key=value` (array values comma-joined), concatenated with no separator,
 * HMAC-SHA256 hex with the app's API secret.
 */
export async function verifyAppProxy(url: URL, secret: string): Promise<boolean> {
  const provided = url.searchParams.get('signature');
  if (!provided) return false;
  const parts: string[] = [];
  const keys = [...new Set([...url.searchParams.keys()])].filter((k) => k !== 'signature').sort();
  for (const k of keys) parts.push(`${k}=${url.searchParams.getAll(k).join(',')}`);
  return safeEqual(await hmacHex(secret, parts.join('')), provided);
}

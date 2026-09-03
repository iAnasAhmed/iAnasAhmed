/**
 * Shared Yahoo session for Cloudflare Pages Functions.
 *
 * Re-exports the same session factory the local dev server uses
 * (scripts/yahoo.mjs), so the crumb/cookie handshake has exactly one
 * implementation. The Workers runtime provides `fetch` and `Headers`
 * (including `getSetCookie`), which is all the factory needs.
 */
import { createYahooSession } from '../scripts/yahoo.mjs';
export { createYahooSession };

const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,20}$/;
const SYMBOL_LIST_RE = /^[A-Za-z0-9.\-]{1,20}(,[A-Za-z0-9.\-]{1,20}){0,49}$/;

export const validators = { SYMBOL_RE, SYMBOL_LIST_RE };

export function json(status, body) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Relay a Yahoo response's status and body verbatim; 502 on failure. */
export async function relay(upstreamPromise) {
  try {
    const upstream = await upstreamPromise;
    return json(upstream.status, await upstream.text());
  } catch (error) {
    return json(502, { error: String(error) });
  }
}

/** One session per warm isolate — env allows overriding the base for testing. */
let cached;
export function session(env) {
  cached ??= createYahooSession({
    base: env?.YAHOO_BASE,
    cookieUrl: env?.YAHOO_COOKIE_URL,
  });
  return cached;
}

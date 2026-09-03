/**
 * Yahoo Finance session + fetch helpers for the local proxy.
 *
 * The v7 `quote` and v10 `quoteSummary` endpoints require a **crumb** obtained
 * with a matching **cookie**, or they return 401. This module performs that
 * handshake once, caches it, and retries a request once on 401 by refreshing.
 * The v8 `chart` endpoint needs neither, so it is a robust crumbless fallback.
 *
 * It is a factory taking an injectable `fetchImpl`, so the whole flow — cookie,
 * crumb, and the 401 refresh-retry — is unit-testable against a fake upstream
 * without touching the network (see scripts/yahoo.test.mjs).
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Extract "name=value" pairs from a response's Set-Cookie header(s). */
function readCookies(response) {
  const headers = response.headers;
  const list =
    typeof headers?.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers?.get?.('set-cookie')
        ? [headers.get('set-cookie')]
        : [];
  return list
    .filter(Boolean)
    .map((c) => String(c).split(';')[0])
    .join('; ');
}

export function createYahooSession(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const base = (options.base ?? 'https://query1.finance.yahoo.com').replace(/\/$/, '');
  const cookieUrl = options.cookieUrl ?? 'https://fc.yahoo.com';
  const ua = options.ua ?? DEFAULT_UA;
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;

  let session = null; // { cookie, crumb, ts }

  async function refresh() {
    let cookie = '';
    try {
      const r = await fetchImpl(cookieUrl, { headers: { 'user-agent': ua, accept: 'text/html' } });
      cookie = readCookies(r);
    } catch {
      // A missing cookie still lets some regions work; carry on with the crumb.
    }
    const r2 = await fetchImpl(`${base}/v1/test/getcrumb`, {
      headers: { 'user-agent': ua, accept: 'text/plain', ...(cookie ? { cookie } : {}) },
    });
    const crumb = (await r2.text()).trim();
    session = { cookie, crumb, ts: Date.now() };
    return session;
  }

  async function ensure(force = false) {
    if (!force && session && session.crumb && Date.now() - session.ts < ttlMs) return session;
    return refresh();
  }

  /** Fetch an authed path (crumb appended, cookie sent), refreshing once on 401/403. */
  async function authed(path) {
    const build = (crumb) => {
      const sep = path.includes('?') ? '&' : '?';
      return `${base}${path}${crumb ? `${sep}crumb=${encodeURIComponent(crumb)}` : ''}`;
    };
    let s = await ensure();
    let resp = await fetchImpl(build(s.crumb), {
      headers: { 'user-agent': ua, accept: 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}) },
    });
    if (resp.status === 401 || resp.status === 403) {
      s = await ensure(true);
      resp = await fetchImpl(build(s.crumb), {
        headers: { 'user-agent': ua, accept: 'application/json', ...(s.cookie ? { cookie: s.cookie } : {}) },
      });
    }
    return resp;
  }

  return {
    ensure,
    /** Batched v7 quote for a comma-separated symbol list (crumb-authed). */
    quote: (symbols) => authed(`/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`),
    /** v10 quoteSummary for one symbol (crumb-authed). */
    summary: (symbol, modules = 'price,summaryDetail,defaultKeyStatistics') =>
      authed(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`),
    /** v8 chart for one symbol — crumbless, the robust fallback. */
    chart: (symbol) =>
      fetchImpl(`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
        headers: { 'user-agent': ua, accept: 'application/json' },
      }),
    _session: () => session,
  };
}

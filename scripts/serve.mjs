/**
 * Zero-dependency static server for dist/, plus a Yahoo Finance proxy.
 *
 * The proxy exists for two reasons: browsers block cross-origin requests to
 * Yahoo, and Yahoo's data endpoints require a crumb+cookie the browser can't
 * mint. Three routes are served, all confined to Yahoo:
 *   /api/quotes?symbols=A.CA,B.CA  -> batched v7 quote (price + fundamentals)
 *   /api/quote/<SYMBOL>            -> v8 chart (crumbless price fallback)
 *   /api/fundamentals/<SYMBOL>     -> v10 quoteSummary (secondary)
 *
 * The Yahoo base URLs are env-overridable (YAHOO_BASE, YAHOO_COOKIE_URL) so the
 * whole path can be exercised against a local fake in tests.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createYahooSession } from './yahoo.mjs';

const PORT = Number(process.env['PORT'] ?? 3000);
const ROOT = resolve('dist');
const SYMBOL_RE = /^[A-Za-z0-9.\-]{1,20}$/;
const SYMBOL_LIST_RE = /^[A-Za-z0-9.\-]{1,20}(,[A-Za-z0-9.\-]{1,20}){0,49}$/;

const yahoo = createYahooSession({
  base: process.env['YAHOO_BASE'] ?? 'https://query1.finance.yahoo.com',
  cookieUrl: process.env['YAHOO_COOKIE_URL'] ?? 'https://fc.yahoo.com',
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

/** Relay a Yahoo response's status and body verbatim, with a 502 on failure. */
async function relay(res, upstreamPromise) {
  try {
    const upstream = await upstreamPromise;
    const body = await upstream.text();
    sendJson(res, upstream.status, body);
  } catch (error) {
    sendJson(res, 502, JSON.stringify({ error: String(error) }));
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // --- batched quote proxy: price AND fundamentals for many symbols at once
  if (url.pathname === '/api/quotes') {
    const symbols = url.searchParams.get('symbols') ?? '';
    if (!SYMBOL_LIST_RE.test(symbols)) {
      sendJson(res, 400, '{"error":"bad symbols"}');
      return;
    }
    await relay(res, yahoo.quote(symbols));
    return;
  }

  // --- crumbless chart proxy (price fallback)
  if (url.pathname.startsWith('/api/quote/')) {
    const symbol = decodeURIComponent(url.pathname.slice('/api/quote/'.length));
    if (!SYMBOL_RE.test(symbol)) {
      sendJson(res, 400, '{"error":"bad symbol"}');
      return;
    }
    await relay(res, yahoo.chart(symbol));
    return;
  }

  // --- quoteSummary proxy (secondary fundamentals source)
  if (url.pathname.startsWith('/api/fundamentals/')) {
    const symbol = decodeURIComponent(url.pathname.slice('/api/fundamentals/'.length));
    if (!SYMBOL_RE.test(symbol)) {
      sendJson(res, 400, '{"error":"bad symbol"}');
      return;
    }
    const modules = url.searchParams.get('modules') ?? 'price,summaryDetail,defaultKeyStatistics';
    if (!/^[A-Za-z,]{1,120}$/.test(modules)) {
      sendJson(res, 400, '{"error":"bad modules"}');
      return;
    }
    await relay(res, yahoo.summary(symbol, modules));
    return;
  }

  // --- static files, confined to dist/
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Telda Investing Tracker  ->  http://localhost:${PORT}`);
});

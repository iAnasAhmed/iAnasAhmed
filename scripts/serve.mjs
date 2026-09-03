/**
 * Zero-dependency static server for dist/, plus a quote proxy.
 *
 * The proxy exists because browsers block cross-origin requests to Yahoo
 * Finance. Requests to /api/quote/<SYMBOL> are forwarded server-side, so the
 * live price source works without a CORS shim or an API key.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env['PORT'] ?? 3000);
const ROOT = resolve('dist');
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // --- quote proxy
  if (url.pathname.startsWith('/api/quote/')) {
    const symbol = decodeURIComponent(url.pathname.slice('/api/quote/'.length));
    // Only exchange tickers: letters, digits, dot, dash. Nothing else reaches Yahoo.
    if (!/^[A-Za-z0-9.\-]{1,20}$/.test(symbol)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end('{"error":"bad symbol"}');
      return;
    }
    try {
      const upstream = await fetch(`${YAHOO}${encodeURIComponent(symbol)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const body = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(body);
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(error) }));
    }
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

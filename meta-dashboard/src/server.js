import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, hasToken } from './config.js';
import * as api from './api.js';
import * as store from './store.js';
import { loadSeed, runSync, startScheduler, onSync } from './sync.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2',
};

const sendJson = (res, body, code = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

function sendStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(config.publicDir, rel);
  // Never serve outside public/.
  if (!file.startsWith(config.publicDir)) { res.writeHead(403).end('Forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(body);
}

// --- Server-sent events: pushes a nudge whenever a sync completes ------------
const clients = new Set();
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch { clients.delete(res); } }
}
onSync((result) => broadcast('sync', { ok: result.ok, at: new Date().toISOString(), stats: result.stats, error: result.error }));

const routes = {
  'GET /api/status': (_req, _res, _url) => api.status(),
  'GET /api/overview': (_req, _res, url) => api.overview({ days: Number(url.searchParams.get('days')) || 28 }),
  'GET /api/mentor': () => api.mentor(),
  'GET /api/campaigns': (_req, _res, url) => api.campaigns({ days: Number(url.searchParams.get('days')) || 28 }),
  'GET /api/audiences': () => api.audiences(),
  'GET /api/planner': () => api.planner(),
  'GET /api/history': () => api.history(),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  if (key === 'GET /api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ connected: hasToken(), at: new Date().toISOString() })}\n\n`);
    clients.add(res);
    // Comment frames keep proxies from closing an idle stream.
    const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  if (key === 'POST /api/sync') {
    const result = await runSync();
    sendJson(res, result, result.ok ? 200 : 502);
    return;
  }

  const handler = routes[key];
  if (handler) {
    try {
      sendJson(res, await handler(req, res, url));
    } catch (err) {
      console.error(`[api] ${key} failed:`, err);
      sendJson(res, { ok: false, error: err.message, where: key }, 500);
    }
    return;
  }

  if (req.method === 'GET') { sendStatic(res, url.pathname); return; }
  res.writeHead(405, { 'content-type': 'text/plain' }).end('Method not allowed');
});

// --- Boot -------------------------------------------------------------------
const banner = () => {
  const bounds = store.getDateBounds(config.accountId);
  console.log('');
  console.log('  Ayat Fahiem Cosmetics — Meta Ads Command Centre');
  console.log('  ' + '-'.repeat(52));
  console.log(`  Dashboard   http://localhost:${config.port}`);
  console.log(`  Ad account  ${config.accountId}`);
  console.log(`  Mode        ${hasToken() ? `LIVE (Graph ${config.apiVersion}, sync every ${config.syncIntervalMinutes} min)` : 'SEEDED BASELINE — add META_ACCESS_TOKEN to .env to go live'}`);
  console.log(`  History     ${bounds.first || 'none'} → ${bounds.last || 'none'} (${bounds.days} days)`);
  console.log('');
};

loadSeed();
server.listen(config.port, () => {
  banner();
  if (hasToken()) {
    startScheduler();
    if (config.syncOnBoot) runSync().catch((e) => console.error('[sync] boot sync failed:', e.message));
  }
});

const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

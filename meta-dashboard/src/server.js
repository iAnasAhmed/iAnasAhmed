import express from 'express';
import { config, hasToken } from './config.js';
import * as api from './api.js';
import * as store from './store.js';
import { loadSeed, runSync, startScheduler, onSync } from './sync.js';
import { toCsv, CSV_COLUMNS } from './adlibrary.js';

const app = express();
app.disable('x-powered-by');

// --- Server-sent events: pushes a nudge whenever a sync completes ------------
const clients = new Set();
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch { clients.delete(res); } }
}
onSync((result) => broadcast('sync', { ok: result.ok, at: new Date().toISOString(), stats: result.stats, error: result.error }));

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream', 'cache-control': 'no-cache',
    connection: 'keep-alive', 'x-accel-buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ connected: hasToken(), at: new Date().toISOString() })}\n\n`);
  clients.add(res);
  // Comment frames keep proxies from closing an idle stream.
  const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(ka); clients.delete(res); });
});

app.post('/api/sync', async (req, res) => {
  const result = await runSync();
  res.status(result.ok ? 200 : 502).json(result);
});

/** Wraps a sync handler so a thrown error becomes a JSON 500 instead of a crash. */
const route = (fn) => (req, res) => {
  try {
    res.set('cache-control', 'no-store').json(fn(req));
  } catch (err) {
    console.error(`[api] ${req.method} ${req.path} failed:`, err);
    res.status(500).json({ ok: false, error: err.message, where: req.path });
  }
};

app.get('/api/status', route(() => api.status()));
app.get('/api/overview', route((req) => api.overview({ days: Number(req.query.days) || 28 })));
app.get('/api/mentor', route(() => api.mentor()));
app.get('/api/campaigns', route((req) => api.campaigns({ days: Number(req.query.days) || 28 })));
app.get('/api/audiences', route(() => api.audiences()));
app.get('/api/planner', route(() => api.planner()));
app.get('/api/history', route(() => api.history()));

// --- Ad Library research ----------------------------------------------------
app.get('/api/research', route((req) => api.research({
  minDays: req.query.minDays ? Number(req.query.minDays) : null,
  pageId: req.query.pageId || null,
})));

app.post('/api/research/refresh', async (req, res) => {
  try {
    const result = await api.refreshResearch({
      searchTerms: req.query.q || null,
      pageIds: req.query.pageId ? [req.query.pageId] : null,
      countries: [req.query.country || 'EG'],
    });
    res.status(result.ok ? 200 : 207).json(result);
  } catch (err) {
    console.error('[api] research refresh failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/research/watch', route((req) => {
  const pageId = String(req.query.pageId || '').trim();
  if (!pageId) throw new Error('A page id is required.');
  store.addWatchedPage(pageId, req.query.pageName || null, req.query.note || null);
  return { ok: true, watchlist: store.getWatchlist() };
}));

app.delete('/api/research/watch', route((req) => {
  const pageId = String(req.query.pageId || '').trim();
  if (!pageId) throw new Error('A page id is required.');
  store.removeWatchedPage(pageId);
  return { ok: true, watchlist: store.getWatchlist() };
}));

// CSV rather than xlsx: Excel and Google Sheets both open it natively, and it
// needs no dependency. The BOM is what makes Excel read the Arabic correctly.
app.get('/api/research/export.csv', (req, res) => {
  try {
    const rows = store.getLibraryAds({
      pageId: req.query.pageId || null,
      minDays: req.query.minDays ? Number(req.query.minDays) : null,
      limit: 5000,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ad-library-${stamp}.csv"`,
      'cache-control': 'no-store',
    }).send(toCsv(rows, CSV_COLUMNS));
  } catch (err) {
    console.error('[api] csv export failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Every static asset served no-cache: this is a live dashboard, not a CDN
// deployment, and a stale app.js after a redeploy is worse than an extra fetch.
app.use(express.static(config.publicDir, { setHeaders: (res) => res.set('cache-control', 'no-cache') }));

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
const server = app.listen(config.port, () => {
  banner();
  if (hasToken()) {
    startScheduler();
    if (config.syncOnBoot) runSync().catch((e) => console.error('[sync] boot sync failed:', e.message));
  }
});

const shutdown = () => {
  server.close(() => { store.closeDb(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

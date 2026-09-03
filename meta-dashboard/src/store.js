import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

// better-sqlite3's synchronous prepare/run/get/all API is what Node's own
// experimental node:sqlite module modelled itself on, so this is a drop-in
// swap - every prepared statement and query below is unchanged.
export const db = new Database(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Small key/value bag for sync state and cached account metadata.
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per entity per day. This is the fact table every trend, drift
-- detector and history view reads from.
CREATE TABLE IF NOT EXISTS daily (
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  level TEXT NOT NULL,            -- account | campaign | adset | ad
  entity_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT,
  spend REAL DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  purchases INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0,
  add_to_cart INTEGER DEFAULT 0,
  initiate_checkout INTEGER DEFAULT 0,
  view_content INTEGER DEFAULT 0,
  landing_page_views INTEGER DEFAULT 0,
  messaging_started INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  video_views INTEGER DEFAULT 0,
  source TEXT DEFAULT 'live',     -- live | seed
  PRIMARY KEY (account_id, date, level, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_lookup ON daily (account_id, level, date);
CREATE INDEX IF NOT EXISTS idx_daily_entity ON daily (account_id, level, entity_id, date);

-- Current configuration of every campaign / ad set / ad we track.
CREATE TABLE IF NOT EXISTS entities (
  account_id TEXT NOT NULL,
  level TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  parent_id TEXT,
  campaign_id TEXT,
  objective TEXT,
  optimization_goal TEXT,
  status TEXT,
  effective_status TEXT,
  bid_strategy TEXT,
  daily_budget REAL,
  lifetime_budget REAL,
  created_time TEXT,
  updated_time TEXT,
  start_time TEXT,
  end_time TEXT,
  learning_stage TEXT,
  audience_lower INTEGER,
  audience_upper INTEGER,
  targeting_json TEXT,
  raw_json TEXT,
  synced_at TEXT,
  PRIMARY KEY (account_id, level, id)
);

CREATE TABLE IF NOT EXISTS audiences (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  subtype TEXT,
  size_lower INTEGER,
  size_upper INTEGER,
  delivery_status TEXT,
  operation_status TEXT,
  retention_days INTEGER,
  time_created TEXT,
  time_updated TEXT,
  lookalike_json TEXT,
  raw_json TEXT,
  synced_at TEXT,
  PRIMARY KEY (account_id, id)
);

-- Our own change detection: diffing each sync against the previous one so the
-- dashboard can answer "what changed, and what happened after".
CREATE TABLE IF NOT EXISTS changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  account_id TEXT NOT NULL,
  level TEXT,
  entity_id TEXT,
  entity_name TEXT,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_changelog_ts ON changelog (account_id, ts DESC);

-- Meta's own activity log, mirrored locally so history survives their 90d window.
CREATE TABLE IF NOT EXISTS activities (
  account_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  event_time TEXT,
  event_type TEXT,
  translated TEXT,
  object_id TEXT,
  object_name TEXT,
  actor_name TEXT,
  extra_json TEXT,
  PRIMARY KEY (account_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_activities_time ON activities (account_id, event_time DESC);

-- Mentor findings. Persisted so you can see when a problem started and whether
-- it is still open after you acted on it.
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,            -- deterministic: ruleId:entityId
  account_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT,
  entity_level TEXT,
  entity_id TEXT,
  entity_name TEXT,
  title TEXT,
  finding TEXT,
  why TEXT,
  fix TEXT,
  metrics_json TEXT,
  first_seen TEXT,
  last_seen TEXT,
  resolved_at TEXT,
  acknowledged INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts (account_id, resolved_at, severity);

CREATE TABLE IF NOT EXISTS syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  finished_at TEXT,
  ok INTEGER,
  error TEXT,
  stats_json TEXT
);
`);

const nowIso = () => new Date().toISOString();

// --- kv ---------------------------------------------------------------------
const kvSet = db.prepare('INSERT INTO kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
const kvGet = db.prepare('SELECT value, updated_at FROM kv WHERE key = ?');

export const setState = (key, value) => kvSet.run(key, JSON.stringify(value), nowIso());
export const getState = (key, fallback = null) => {
  const row = kvGet.get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
};
export const getStateMeta = (key) => kvGet.get(key) || null;

// --- daily facts ------------------------------------------------------------
const upsertDailyStmt = db.prepare(`
INSERT INTO daily (account_id,date,level,entity_id,parent_id,name,spend,impressions,reach,clicks,link_clicks,
  purchases,revenue,add_to_cart,initiate_checkout,view_content,landing_page_views,messaging_started,leads,video_views,source)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(account_id,date,level,entity_id) DO UPDATE SET
  parent_id=excluded.parent_id, name=COALESCE(excluded.name, daily.name),
  spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach,
  clicks=excluded.clicks, link_clicks=excluded.link_clicks, purchases=excluded.purchases,
  revenue=excluded.revenue, add_to_cart=excluded.add_to_cart,
  initiate_checkout=excluded.initiate_checkout, view_content=excluded.view_content,
  landing_page_views=excluded.landing_page_views, messaging_started=excluded.messaging_started,
  leads=excluded.leads, video_views=excluded.video_views, source=excluded.source
`);

// better-sqlite3's own transaction wrapper: it begins, commits, and rolls back
// on a thrown error automatically, and is the idiomatic replacement for the
// hand-rolled BEGIN/COMMIT/ROLLBACK statements this used to run by hand.
const upsertDailyTx = db.transaction((accountId, level, rows, source) => {
  for (const r of rows) {
    const entityId = level === 'account' ? accountId
      : level === 'campaign' ? r.campaignId
      : level === 'adset' ? r.adsetId
      : r.adId;
    if (!entityId || !r.dateStart) continue;
    const parentId = level === 'adset' ? r.campaignId : level === 'ad' ? r.adsetId : null;
    const name = level === 'campaign' ? r.campaignName : level === 'adset' ? r.adsetName : level === 'ad' ? r.adName : null;
    upsertDailyStmt.run(
      accountId, r.dateStart, level, String(entityId), parentId ? String(parentId) : null, name,
      r.spend, r.impressions, r.reach, r.clicks, r.linkClicks,
      r.purchases, r.revenue, r.addToCart, r.initiateCheckout, r.viewContent,
      r.landingPageViews, r.messagingStarted, r.leads, r.videoViews, source,
    );
  }
});

export function upsertDaily(accountId, level, rows, source = 'live') {
  upsertDailyTx(accountId, level, rows, source);
}

export function getDaily(accountId, { level = 'account', since, until, entityId } = {}) {
  let sql = 'SELECT * FROM daily WHERE account_id = ? AND level = ?';
  const args = [accountId, level];
  if (since) { sql += ' AND date >= ?'; args.push(since); }
  if (until) { sql += ' AND date <= ?'; args.push(until); }
  if (entityId) { sql += ' AND entity_id = ?'; args.push(entityId); }
  sql += ' ORDER BY date ASC';
  return db.prepare(sql).all(...args);
}

export function getDateBounds(accountId, level = 'account') {
  return db.prepare('SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS days FROM daily WHERE account_id=? AND level=?').get(accountId, level);
}

// --- entities ---------------------------------------------------------------
const upsertEntityStmt = db.prepare(`
INSERT INTO entities (account_id,level,id,name,parent_id,campaign_id,objective,optimization_goal,status,
  effective_status,bid_strategy,daily_budget,lifetime_budget,created_time,updated_time,start_time,end_time,
  learning_stage,audience_lower,audience_upper,targeting_json,raw_json,synced_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(account_id,level,id) DO UPDATE SET
  name=excluded.name, parent_id=excluded.parent_id, campaign_id=excluded.campaign_id,
  objective=excluded.objective, optimization_goal=excluded.optimization_goal,
  status=excluded.status, effective_status=excluded.effective_status,
  bid_strategy=excluded.bid_strategy, daily_budget=excluded.daily_budget,
  lifetime_budget=excluded.lifetime_budget, updated_time=excluded.updated_time,
  start_time=excluded.start_time, end_time=excluded.end_time,
  learning_stage=excluded.learning_stage,
  audience_lower=COALESCE(excluded.audience_lower, entities.audience_lower),
  audience_upper=COALESCE(excluded.audience_upper, entities.audience_upper),
  targeting_json=excluded.targeting_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at
`);

export function upsertEntity(accountId, level, e) {
  upsertEntityStmt.run(
    accountId, level, String(e.id), e.name ?? null,
    e.parent_id ? String(e.parent_id) : null,
    e.campaign_id ? String(e.campaign_id) : null,
    e.objective ?? null, e.optimization_goal ?? null, e.status ?? null, e.effective_status ?? null,
    e.bid_strategy ?? null,
    e.daily_budget != null ? Number(e.daily_budget) / 100 : null,
    e.lifetime_budget != null ? Number(e.lifetime_budget) / 100 : null,
    e.created_time ?? null, e.updated_time ?? null, e.start_time ?? null, e.end_time ?? null,
    e.learning_stage ?? null,
    e.audience_lower ?? null, e.audience_upper ?? null,
    e.targeting ? JSON.stringify(e.targeting) : null,
    JSON.stringify(e), nowIso(),
  );
}

export const getEntities = (accountId, level) =>
  db.prepare('SELECT * FROM entities WHERE account_id=? AND level=? ORDER BY name').all(accountId, level);

export const getEntity = (accountId, level, id) =>
  db.prepare('SELECT * FROM entities WHERE account_id=? AND level=? AND id=?').get(accountId, level, String(id));

// --- audiences --------------------------------------------------------------
const upsertAudienceStmt = db.prepare(`
INSERT INTO audiences (account_id,id,name,description,subtype,size_lower,size_upper,delivery_status,
  operation_status,retention_days,time_created,time_updated,lookalike_json,raw_json,synced_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(account_id,id) DO UPDATE SET
  name=excluded.name, description=excluded.description, subtype=excluded.subtype,
  size_lower=excluded.size_lower, size_upper=excluded.size_upper,
  delivery_status=excluded.delivery_status, operation_status=excluded.operation_status,
  retention_days=excluded.retention_days, time_updated=excluded.time_updated,
  lookalike_json=excluded.lookalike_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at
`);

export function upsertAudience(accountId, a) {
  const delivery = typeof a.delivery_status === 'object' ? (a.delivery_status?.code === 200 ? 'ACTIVE' : (a.delivery_status?.description || 'INACTIVE')) : a.delivery_status;
  const operation = typeof a.operation_status === 'object' ? (a.operation_status?.description || String(a.operation_status?.code ?? '')) : a.operation_status;
  upsertAudienceStmt.run(
    accountId, String(a.id), a.name ?? null, a.description ?? null, a.subtype ?? null,
    a.approximate_count_lower_bound ?? a.size_lower ?? null,
    a.approximate_count_upper_bound ?? a.size_upper ?? null,
    delivery ?? null, operation ?? null, a.retention_days ?? null,
    a.time_created ?? null, a.time_updated ?? null,
    a.lookalike_spec ? JSON.stringify(a.lookalike_spec) : null,
    JSON.stringify(a), nowIso(),
  );
}

export const getAudiences = (accountId) =>
  db.prepare('SELECT * FROM audiences WHERE account_id=? ORDER BY COALESCE(size_upper,0) DESC').all(accountId);

// --- changelog + activities -------------------------------------------------
const insertChange = db.prepare('INSERT INTO changelog (ts,account_id,level,entity_id,entity_name,field,old_value,new_value,note) VALUES (?,?,?,?,?,?,?,?,?)');
export const recordChange = (accountId, c) =>
  insertChange.run(c.ts || nowIso(), accountId, c.level ?? null, c.entityId ?? null, c.entityName ?? null, c.field ?? null,
    c.oldValue == null ? null : String(c.oldValue), c.newValue == null ? null : String(c.newValue), c.note ?? null);

export const getChangelog = (accountId, limit = 200) =>
  db.prepare('SELECT * FROM changelog WHERE account_id=? ORDER BY ts DESC, id DESC LIMIT ?').all(accountId, limit);

const insertActivity = db.prepare(`
INSERT INTO activities (account_id,fingerprint,event_time,event_type,translated,object_id,object_name,actor_name,extra_json)
VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,fingerprint) DO NOTHING`);

export function upsertActivity(accountId, a) {
  const fingerprint = [a.event_time, a.event_type, a.object_id, a.actor_name].join('|');
  insertActivity.run(accountId, fingerprint, a.event_time ?? null, a.event_type ?? null,
    a.translated_event_type ?? null, a.object_id ?? null, a.object_name ?? null,
    a.actor_name ?? null, a.extra_data ?? null);
}

export const getActivities = (accountId, limit = 200) =>
  db.prepare('SELECT * FROM activities WHERE account_id=? ORDER BY event_time DESC LIMIT ?').all(accountId, limit);

// --- alerts -----------------------------------------------------------------
const upsertAlertStmt = db.prepare(`
INSERT INTO alerts (id,account_id,rule_id,severity,category,entity_level,entity_id,entity_name,title,finding,why,fix,metrics_json,first_seen,last_seen,resolved_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
ON CONFLICT(id) DO UPDATE SET
  severity=excluded.severity, title=excluded.title, finding=excluded.finding,
  why=excluded.why, fix=excluded.fix, metrics_json=excluded.metrics_json,
  last_seen=excluded.last_seen, resolved_at=NULL
`);

const persistAlertsTx = db.transaction((accountId, alerts, ts) => {
  const ids = new Set();
  for (const a of alerts) {
    const id = `${a.ruleId}:${a.entityId || 'account'}`;
    ids.add(id);
    upsertAlertStmt.run(id, accountId, a.ruleId, a.severity, a.category ?? null,
      a.entityLevel ?? null, a.entityId ?? null, a.entityName ?? null,
      a.title, a.finding, a.why, a.fix, JSON.stringify(a.metrics || {}), ts, ts);
  }
  // Anything previously open that no longer fires is resolved as of now.
  const open = db.prepare('SELECT id FROM alerts WHERE account_id=? AND resolved_at IS NULL').all(accountId);
  const close = db.prepare('UPDATE alerts SET resolved_at=? WHERE id=?');
  for (const row of open) if (!ids.has(row.id)) close.run(ts, row.id);
});

export function persistAlerts(accountId, alerts) {
  persistAlertsTx(accountId, alerts, nowIso());
}

export const getAlertHistory = (accountId, limit = 100) =>
  db.prepare('SELECT * FROM alerts WHERE account_id=? ORDER BY (resolved_at IS NOT NULL), first_seen DESC LIMIT ?').all(accountId, limit);

// --- syncs ------------------------------------------------------------------
export function recordSync({ startedAt, finishedAt, ok, error, stats }) {
  db.prepare('INSERT INTO syncs (started_at,finished_at,ok,error,stats_json) VALUES (?,?,?,?,?)')
    .run(startedAt, finishedAt, ok ? 1 : 0, error ?? null, JSON.stringify(stats || {}));
}
export const getRecentSyncs = (limit = 20) =>
  db.prepare('SELECT * FROM syncs ORDER BY id DESC LIMIT ?').all(limit);

export const isEmpty = (accountId) =>
  db.prepare('SELECT COUNT(*) AS c FROM daily WHERE account_id=?').get(accountId).c === 0;

// better-sqlite3 recommends an explicit close so the WAL file checkpoints
// cleanly on shutdown rather than relying on process exit.
export const closeDb = () => db.close();

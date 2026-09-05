import fs from 'node:fs';
import { createRequire } from 'node:module';
import { config } from './config.js';

/**
 * Opens the database, preferring better-sqlite3 and falling back to Node's own
 * built-in `node:sqlite`.
 *
 * better-sqlite3 is a native module. On most machines npm downloads a prebuilt
 * binary and there is nothing to compile; on an unusual platform/Node pairing
 * it falls back to building from source, which needs Python and a C++
 * toolchain. That is a hard wall for anyone who just wants to run a dashboard,
 * so it is declared an optional dependency and this module carries on without
 * it — `node:sqlite` ships inside Node itself and speaks the same
 * prepare/run/get/all API that better-sqlite3 defined.
 *
 * The one thing node:sqlite does not provide is better-sqlite3's
 * `db.transaction()` wrapper, so it is reimplemented below.
 */

// require() rather than import: picking an engine at runtime needs a
// synchronous load that can fail without taking this module down with it.
const require = createRequire(import.meta.url);

fs.mkdirSync(config.dataDir, { recursive: true });

/**
 * Normalises bind values so both engines accept the same arguments.
 *
 * Neither driver will bind `undefined` or a boolean, and they disagree about
 * nothing else we use. A missing metric genuinely means "not reported", so it
 * stores as NULL rather than crashing the sync half way through a day's rows;
 * booleans become the 0/1 SQLite actually has.
 */
const bindable = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
};

/** Applies that normalisation to every statement the database hands back. */
function normaliseBindings(db) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = prepare(sql);
    const wrap = (method) => (...args) => method.apply(stmt, args.map(bindable));
    return {
      run: wrap(stmt.run), get: wrap(stmt.get), all: wrap(stmt.all),
      // Anything else on the statement stays reachable and unwrapped.
      __proto__: stmt,
    };
  };
  return db;
}

/** Wraps a function so it runs inside one transaction, rolling back on throw. */
function addTransaction(db) {
  let depth = 0;
  db.transaction = (fn) => (...args) => {
    // A nested call joins the outer transaction rather than opening a second
    // one, which SQLite would reject.
    if (depth > 0) return fn(...args);
    depth = 1;
    db.exec('BEGIN');
    try {
      const out = fn(...args);
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already unwound */ }
      throw err;
    } finally {
      depth = 0;
    }
  };
  return db;
}

function open() {
  try {
    const Database = require('better-sqlite3');
    return { db: normaliseBindings(new Database(config.dbPath)), engine: 'better-sqlite3' };
  } catch (nativeErr) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = normaliseBindings(addTransaction(new DatabaseSync(config.dbPath)));
      return { db, engine: 'node:sqlite (built into Node)' };
    } catch {
      // Neither is available. The native module's failure is the louder one,
      // but on this project the cause is almost always an old Node.
      const major = Number(process.versions.node.split('.')[0]);
      if (major < 22) {
        throw new Error(
          `This dashboard needs Node 22 or newer — you are running Node ${process.versions.node}. `
          + 'Install the LTS build from https://nodejs.org, close and reopen your terminal, '
          + 'then run "npm install" again.',
        );
      }
      throw nativeErr;
    }
  }
}

const opened = open();

export const db = opened.db;
export const engine = opened.engine;

import { config, hasToken } from './config.js';
import { loadSeed, runSync } from './sync.js';
import * as api from './api.js';

const cmd = process.argv[2] || 'doctor';
loadSeed();

if (cmd === 'sync') {
  if (!hasToken()) { console.error('No META_ACCESS_TOKEN in .env — nothing to sync.'); process.exit(1); }
  const r = await runSync();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'doctor') {
  const s = api.status();
  console.log(`account      ${config.accountId}`);
  console.log(`mode         ${s.dataMode}`);
  console.log(`history      ${s.bounds.first} -> ${s.bounds.last} (${s.bounds.days} days)`);
  console.log(`rules        ${s.ruleCount}`);
  const m = api.mentor();
  console.log(`score        ${m.score}/100 — ${m.verdict.label}`);
  console.log('');
  for (const f of m.findings) {
    console.log(`[${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`   ${f.finding}`);
    console.log(`   FIX: ${f.fix}`);
    console.log('');
  }
  process.exit(0);
}

console.error(`Unknown command "${cmd}". Use: sync | doctor`);
process.exit(1);

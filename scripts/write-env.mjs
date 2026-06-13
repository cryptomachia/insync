#!/usr/bin/env node
// scripts/write-env.mjs — idempotent .env writer used by scripts/deploy.sh.
//
// Given a JSON map of deployed addresses on argv, it writes/updates the
// contract-address keys (and a couple of derived NEXT_PUBLIC_ mirrors) across
// every app's env file WITHOUT clobbering other keys the user already set.
//
//   node scripts/write-env.mjs '{"ESCROW_ADDRESS":"0x..","USDC_ADDRESS":"0x..",...}'
//
// Targets (created if absent, seeded from .env.example when present):
//   <root>/.env
//   <root>/apps/web/.env.local      (NEXT_PUBLIC_* keys)
//   <root>/backend/.env
//   <root>/cre/.env
//
// Pure Node (no deps) so it runs anywhere `node` exists.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const raw = process.argv[2];
if (!raw) {
  console.error('usage: write-env.mjs \'{"ESCROW_ADDRESS":"0x.."}\'');
  process.exit(1);
}

/** @type {Record<string,string>} */
let addrs;
try {
  addrs = JSON.parse(raw);
} catch (e) {
  console.error('write-env: invalid JSON addresses:', e.message);
  process.exit(1);
}

// Drop empty / placeholder values so we never write a blank over a good value.
const isAddr = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
for (const k of Object.keys(addrs)) {
  if (!isAddr(addrs[k])) delete addrs[k];
}

// Plain (node) keys we always have meaningful defaults for.
const plainBase = {
  RPC_URL: process.env.RPC_URL || 'http://127.0.0.1:8545',
  CHAIN_ID: process.env.CHAIN_ID || '31337',
  MOCK: process.env.MOCK || 'true',
};

// NEXT_PUBLIC_ mirrors of the chain config + addresses for the web app.
const nextMirror = (a) => ({
  NEXT_PUBLIC_MOCK: process.env.NEXT_PUBLIC_MOCK || process.env.MOCK || 'true',
  NEXT_PUBLIC_CHAIN_ID: process.env.CHAIN_ID || '31337',
  NEXT_PUBLIC_RPC_URL: process.env.RPC_URL || 'http://127.0.0.1:8545',
  ...(a.ESCROW_ADDRESS ? { NEXT_PUBLIC_ESCROW_ADDRESS: a.ESCROW_ADDRESS } : {}),
  ...(a.REPUTATION_ADDRESS ? { NEXT_PUBLIC_REPUTATION_ADDRESS: a.REPUTATION_ADDRESS } : {}),
  ...(a.USDC_ADDRESS ? { NEXT_PUBLIC_USDC_ADDRESS: a.USDC_ADDRESS } : {}),
});

/**
 * Merge `updates` into an existing dotenv file (or create it), preserving
 * unrelated lines, comments, and ordering. Keys present in `updates` are
 * overwritten in place; new keys are appended.
 */
function upsertEnv(file, updates) {
  mkdirSync(dirname(file), { recursive: true });
  const seed = !existsSync(file) ? '' : readFileSync(file, 'utf8');
  const lines = seed.length ? seed.split(/\r?\n/) : [];
  const seen = new Set();

  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });

  const appended = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) appended.push(`${k}=${v}`);
  }
  let body = out.join('\n');
  if (appended.length) {
    if (body.length && !body.endsWith('\n')) body += '\n';
    body += appended.join('\n') + '\n';
  } else if (body.length && !body.endsWith('\n')) {
    body += '\n';
  }
  writeFileSync(file, body);
}

// ---- write the four targets ------------------------------------------------
const targets = [
  { file: join(ROOT, '.env'), updates: { ...plainBase, ...addrs } },
  { file: join(ROOT, 'apps', 'web', '.env.local'), updates: nextMirror(addrs) },
  { file: join(ROOT, 'backend', '.env'), updates: { ...plainBase, ...addrs, PORT: process.env.PORT || '8787' } },
  { file: join(ROOT, 'cre', '.env'), updates: { ...plainBase, ...addrs, PRIVATE_KEY: process.env.PRIVATE_KEY || '', BACKEND_URL: process.env.BACKEND_URL || 'http://127.0.0.1:8787' } },
];

for (const t of targets) {
  upsertEnv(t.file, t.updates);
  const rel = t.file.replace(ROOT + '/', '');
  console.log(`  wrote ${rel} (${Object.keys(t.updates).length} keys)`);
}

console.log('\nDeployed addresses:');
for (const [k, v] of Object.entries(addrs)) console.log(`  ${k}=${v}`);

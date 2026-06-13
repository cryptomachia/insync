#!/usr/bin/env node
// scripts/parse-deploy.mjs — extract deployed contract addresses after a forge
// deploy, robust to how AGENT 1's Deploy.s.sol surfaces them. It tries, in order:
//
//   1. contracts/deployments/<chainId>.json or contracts/deployments.json
//      (if the deploy script writes a {NAME: address} map — most reliable).
//   2. The Foundry broadcast artifact
//      contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json
//      mapping each CREATE tx's contractName -> contractAddress.
//   3. A captured stdout log (argv[2]) scanned for `KEY=0x..` / `NAME: 0x..`.
//
// It then normalizes names to our frozen env keys and prints a JSON object on
// stdout:  {"ESCROW_ADDRESS":"0x..","USDC_ADDRESS":"0x..", ...}
// Exits non-zero (with a clear message on stderr) if ESCROW is not found.
//
// Pure Node, no deps.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONTRACTS = join(ROOT, 'contracts');
const CHAIN_ID = process.env.CHAIN_ID || '31337';
const stdoutLogPath = process.argv[2]; // optional captured deploy stdout

const isAddr = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

// name (lowercased) -> env key. Heuristic but covers the SPEC's contract set.
function classify(name) {
  const n = String(name).toLowerCase();
  if (n.includes('escrow')) return 'ESCROW_ADDRESS';
  if (n.includes('reputation')) return 'REPUTATION_ADDRESS';
  if (n.includes('verifier')) return 'VERIFIER_PROXY_ADDRESS';
  // USDC / payment stable: MockERC20, USDC, MockUSDC, Stable...
  if (n.includes('usdc') || n.includes('erc20') || n.includes('stable') || n.includes('mocktoken'))
    return 'USDC_ADDRESS';
  return null;
}

const result = {};
const setIfEmpty = (key, addr) => {
  if (key && isAddr(addr) && !result[key]) result[key] = addr;
};
// Direct env-key match takes precedence (deployments.json may already use our keys).
const ENV_KEYS = ['ESCROW_ADDRESS', 'USDC_ADDRESS', 'REPUTATION_ADDRESS', 'VERIFIER_PROXY_ADDRESS'];

// ---- strategy 1: deployments json ----------------------------------------
function tryDeploymentsJson() {
  const candidates = [
    join(CONTRACTS, 'deployments', `${CHAIN_ID}.json`),
    join(CONTRACTS, 'deployments.json'),
    join(CONTRACTS, 'out', 'deployments.json'),
    join(ROOT, 'deployments.json'),
  ];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    try {
      const obj = JSON.parse(readFileSync(f, 'utf8'));
      for (const [k, v] of Object.entries(obj)) {
        // exact env-key wins; otherwise classify by name
        if (ENV_KEYS.includes(k.toUpperCase())) setIfEmpty(k.toUpperCase(), v);
        else setIfEmpty(classify(k), v);
      }
      if (result.ESCROW_ADDRESS) return `deployments file ${f}`;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

// ---- strategy 2: foundry broadcast artifact ------------------------------
function tryBroadcast() {
  const f = join(CONTRACTS, 'broadcast', 'Deploy.s.sol', CHAIN_ID, 'run-latest.json');
  if (!existsSync(f)) return null;
  try {
    const obj = JSON.parse(readFileSync(f, 'utf8'));
    for (const tx of obj.transactions || []) {
      if (tx.transactionType !== 'CREATE' && tx.transactionType !== 'CREATE2') continue;
      setIfEmpty(classify(tx.contractName), tx.contractAddress);
    }
    if (result.ESCROW_ADDRESS) return `broadcast ${f}`;
  } catch {
    /* fall through */
  }
  return null;
}

// ---- strategy 3: scan captured stdout ------------------------------------
function tryStdout() {
  if (!stdoutLogPath || !existsSync(stdoutLogPath)) return null;
  const text = readFileSync(stdoutLogPath, 'utf8');
  // match KEY=0x.. , KEY: 0x.. , "Escrow deployed at 0x.." etc.
  const re = /([A-Za-z_][\w/ ]*?)\s*[:=]\s*(0x[0-9a-fA-F]{40})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].trim();
    if (ENV_KEYS.includes(label.toUpperCase())) setIfEmpty(label.toUpperCase(), m[2]);
    else setIfEmpty(classify(label), m[2]);
  }
  // also catch bare "deployed ... 0x.." preceded by a contract word on the line
  if (result.ESCROW_ADDRESS) return `stdout log ${stdoutLogPath}`;
  return null;
}

const sources = [];
for (const fn of [tryDeploymentsJson, tryBroadcast, tryStdout]) {
  const src = fn();
  if (src) sources.push(src);
  if (result.ESCROW_ADDRESS && result.USDC_ADDRESS) break; // got the essentials
}

if (!result.ESCROW_ADDRESS) {
  console.error(
    'parse-deploy: could not find ESCROW_ADDRESS.\n' +
      '  Looked for: contracts/deployments/<chainId>.json, broadcast/Deploy.s.sol/<chainId>/run-latest.json, deploy stdout.\n' +
      '  Ensure contracts/script/Deploy.s.sol ran with --broadcast, or have it write contracts/deployments/<chainId>.json.',
  );
  process.exit(2);
}

if (process.env.HANDOFF_DEBUG) {
  console.error('parse-deploy sources:', sources.join('; ') || '(none matched)');
}

process.stdout.write(JSON.stringify(result));

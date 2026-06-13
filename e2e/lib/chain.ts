// e2e/lib/chain.ts — shared viem clients, anvil accounts, env loading, and the
// small ERC20/MockVerifier ABIs the script-level e2e needs alongside the frozen
// escrowAbi from @handoff/contracts-abi.
//
// Reads contract addresses from the root .env that scripts/deploy.sh writes
// (ESCROW_ADDRESS, USDC_ADDRESS, VERIFIER_PROXY_ADDRESS). Falls back to
// process.env so CI can inject them.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { escrowAbi, reputationAbi } from '@handoff/contracts-abi';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

/** Minimal dotenv loader (no dep): parse KEY=VALUE lines into process.env unless already set. */
export function loadEnv(file = resolve(ROOT, '.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, '');
  }
}
loadEnv();

export const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
export const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);

function reqAddr(name: string): Address {
  const v = process.env[name] || process.env[`NEXT_PUBLIC_${name}`];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(
      `${name} not set or invalid (got "${v ?? ''}"). Run: make anvil-bg && make deploy first.`,
    );
  }
  return v as Address;
}

export function addresses() {
  return {
    escrow: reqAddr('ESCROW_ADDRESS'),
    usdc: reqAddr('USDC_ADDRESS'),
    // verifier may be address(0) when only stable deals are supported.
    verifier: (process.env.VERIFIER_PROXY_ADDRESS || '') as Address | '',
  };
}

// anvil deterministic accounts (account 0 deployer/seller, 1 buyer, 2 spare).
export const ANVIL_KEYS: Hex[] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // acct 0
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // acct 1
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // acct 2
];

export const chain = {
  id: CHAIN_ID,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
} as const;

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

export function wallet(idx: number) {
  const account = privateKeyToAccount(ANVIL_KEYS[idx]);
  const client = createWalletClient({ account, chain, transport: http(RPC_URL) });
  return { account, client };
}

// ERC20 with the mint helper our MockERC20 exposes (SPEC §3 delivers a MockERC20).
export const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

// MockVerifier helper (best-effort): some mock verifiers let tests set the price
// returned for a report. Used only if present; the script tolerates its absence.
export const mockVerifierAbi = parseAbi([
  'function setPrice(int192 price)',
  'function setAnswer(int192 price)',
]);

export { escrowAbi, reputationAbi };
export type { Address, Hex };

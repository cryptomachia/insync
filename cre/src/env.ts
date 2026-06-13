// Environment loading for the LOCAL keeper + scan scripts (NOT the CRE workflow).
//
// The CRE workflow itself receives its config from `config.json` via the CRE
// runtime (see workflow.ts) and never reads process.env at runtime — the WASM
// sandbox has no env. These helpers are only for the off-chain, Node-side tools
// (keeper.local.ts, scan-deals.ts, the dry-run harness).
//
// SPEC §14 env names are honored exactly. A tiny .env loader is included so we
// don't add a dependency; it is intentionally minimal (KEY=VALUE, # comments).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadDotEnv(): void {
  // Look for .env in cre/ then the repo root; first hit wins per key.
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]
  for (const path of candidates) {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      // Don't override anything already set in the real environment.
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

loadDotEnv()

export const MOCK =
  String(process.env.MOCK ?? '').toLowerCase() === 'true' ||
  String(process.env.NEXT_PUBLIC_MOCK ?? '').toLowerCase() === 'true'

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined || v === '') {
    throw new Error(`Missing required env var ${name} (see cre/.env.example / SPEC §14)`)
  }
  return v
}

export function getKeeperEnv() {
  const rpcUrl = req('RPC_URL', 'http://127.0.0.1:8545')
  const escrowAddress = (process.env.ESCROW_ADDRESS ??
    process.env.NEXT_PUBLIC_ESCROW_ADDRESS) as `0x${string}` | undefined
  if (!escrowAddress || !/^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) {
    throw new Error(
      'ESCROW_ADDRESS is missing/invalid. Deploy the Escrow (scripts agent) and set ESCROW_ADDRESS in .env.',
    )
  }
  // Anvil default account 0 key — safe placeholder for local mode only.
  const privateKey = req(
    'PRIVATE_KEY',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ) as `0x${string}`

  const stableToken = (process.env.USDC_ADDRESS ??
    process.env.NEXT_PUBLIC_USDC_ADDRESS) as `0x${string}` | undefined

  return {
    rpcUrl,
    chainId: Number(process.env.CHAIN_ID ?? 31337),
    escrowAddress,
    privateKey,
    stableToken: stableToken && /^0x[0-9a-fA-F]{40}$/.test(stableToken) ? stableToken : undefined,
    backendUrl: process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL,
    feedEthUsd: process.env.DATASTREAMS_FEED_ETHUSD ?? 'ETH/USD',
    // How many dealIds to scan when iterating on-chain (deals are 1..N).
    maxDealId: BigInt(process.env.CRE_MAX_DEAL_ID ?? 200),
    mock: MOCK,
  }
}

export type KeeperEnv = ReturnType<typeof getKeeperEnv>

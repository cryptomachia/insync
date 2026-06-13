// scan-deals.ts — read-only deal inspector (run with: npm run deals).
//
// SPEC §12 allows reading active deals either directly from the Escrow (viem +
// escrowAbi, iterate dealIds → getDeal) OR from the backend GET /deals. This
// script demonstrates BOTH and prints which deals the keeper would reclaim,
// without sending any transaction. Handy for the demo ("here are the expired
// deals the CRE workflow is about to reclaim").
//
//   npm run deals            read from chain (default)
//   npm run deals -- backend read from BACKEND_URL GET /deals

import { getKeeperEnv } from './env'
import { EscrowClient } from './escrow-client'
import { dealStateName, isReclaimable, type Deal } from './deals'

async function fromChain(): Promise<{ deals: Deal[]; nowSec: bigint }> {
  const env = getKeeperEnv()
  const client = new EscrowClient({
    rpcUrl: env.rpcUrl,
    chainId: env.chainId,
    escrowAddress: env.escrowAddress,
  })
  const nowSec = await client.nowSec()
  const deals: Deal[] = []
  for (let id = 1n; id <= env.maxDealId; id++) {
    try {
      const deal = await client.getDeal(id)
      if (deal.state === 0) break
      deals.push(deal)
    } catch {
      break
    }
  }
  return { deals, nowSec }
}

async function fromBackend(): Promise<{ deals: Deal[]; nowSec: bigint }> {
  const env = getKeeperEnv()
  if (!env.backendUrl) throw new Error('BACKEND_URL not set; cannot read GET /deals')
  const res = await fetch(env.backendUrl.replace(/\/$/, '') + '/deals')
  if (!res.ok) throw new Error(`GET /deals failed: ${res.status}`)
  // Backend wraps the array: GET /deals → { deals: [...] } (SPEC §11). Tolerate a
  // bare array too in case a future endpoint returns one.
  const json = (await res.json()) as { deals?: unknown[] } | unknown[]
  const rows = (Array.isArray(json) ? json : (json.deals ?? [])) as Array<Record<string, unknown>>
  const big = (v: unknown, fallback = 0n): bigint =>
    v === undefined || v === null ? fallback : BigInt(v as string | number | bigint)
  const addr = (v: unknown): `0x${string}` => String(v ?? '') as `0x${string}`
  // Backend rows are expected to expose the same fields as getDeal (SPEC §11).
  const deals: Deal[] = rows.map((r) => ({
    dealId: big(r.dealId ?? r.id),
    state: Number(r.state),
    buyer: addr(r.buyer),
    seller: addr(r.seller),
    payToken: addr(r.payToken),
    priceUsd1e8: big(r.priceUsd1e8),
    tokenAmount: big(r.tokenAmount),
    depositBps: Number(r.depositBps ?? 0),
    freeCancelUntil: big(r.freeCancelUntil),
    expiry: big(r.expiry),
    sellerCheckedIn: Boolean(r.sellerCheckedIn),
  }))
  return { deals, nowSec: BigInt(Math.floor(Date.now() / 1000)) }
}

async function main() {
  const source = process.argv[2] === 'backend' ? 'backend' : 'chain'
  console.log(`=== Handoff deals (source: ${source}) ===`)
  const { deals, nowSec } = source === 'backend' ? await fromBackend() : await fromChain()
  console.log(`now=${nowSec}  total deals=${deals.length}\n`)
  let reclaimable = 0
  for (const d of deals) {
    const r = isReclaimable(d, nowSec)
    if (r) reclaimable++
    console.log(
      `#${d.dealId}  ${dealStateName(d.state).padEnd(16)} ` +
        `expiry=${d.expiry} checkedIn=${d.sellerCheckedIn} ` +
        `${r ? '→ RECLAIMABLE' : ''}`,
    )
  }
  console.log(`\n${reclaimable} deal(s) the keeper/CRE workflow would reclaim now.`)
}

main().catch((e) => {
  console.error('scan-deals fatal:', e)
  process.exit(1)
})

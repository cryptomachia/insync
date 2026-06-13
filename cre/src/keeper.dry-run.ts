// =============================================================================
// keeper.dry-run.ts — exercise the reclaim sweep with NO chain at all.
// =============================================================================
//
// Runs the real `runSweep` algorithm (the same one keeper.local.ts and the CRE
// workflow use) against an in-memory mock Escrow seeded with deals in every
// relevant state. This proves the keeper logic end-to-end — candidate
// selection, stable vs volatile report handling, terminal-state skipping, and
// the reclaimExpired call path — with zero anvil, zero Chainlink, zero RPC.
//
// Run with:  npm run keeper:dry-run   (or: npx tsx src/keeper.dry-run.ts)
//
// Exits non-zero if the observed reclaim set differs from the expected set, so
// it doubles as a self-check in CI.

import { DealState } from '@handoff/contracts-abi'
import type { Deal } from './deals'
import { runSweep, type SweepClient } from './sweep'

const USDC = '0x0000000000000000000000000000000000000abc' as `0x${string}`
const WETH = '0x000000000000000000000000000000000000dEaD' as `0x${string}`
const PAST = 1_000n // expiry in the past
const FUTURE = 9_999_999_999n // expiry far in the future
const NOW = 2_000_000n

function deal(p: Partial<Deal> & Pick<Deal, 'dealId' | 'state'>): Deal {
  return {
    buyer: '0x0000000000000000000000000000000000000001',
    seller: '0x0000000000000000000000000000000000000002',
    payToken: USDC,
    priceUsd1e8: 80_00000000n,
    tokenAmount: 88_000000n,
    depositBps: 1000,
    freeCancelUntil: 0n,
    expiry: PAST,
    sellerCheckedIn: false,
    ...p,
  }
}

// Seeded deal book — id → deal. Designed so exactly ids 1,2,3 are reclaimable.
const BOOK = new Map<bigint, Deal>([
  // 1: Funded, expired, seller not checked in → reclaim (full refund to buyer).
  [1n, deal({ dealId: 1n, state: DealState.Funded, expiry: PAST, sellerCheckedIn: false })],
  // 2: CheckedIn, expired, seller present → reclaim (deposit to seller).
  [2n, deal({ dealId: 2n, state: DealState.SellerCheckedIn, expiry: PAST, sellerCheckedIn: true })],
  // 3: Funded, expired, VOLATILE token (WETH) → reclaim, needs a report.
  [3n, deal({ dealId: 3n, state: DealState.Funded, expiry: PAST, payToken: WETH })],
  // 4: Funded but NOT expired → skip.
  [4n, deal({ dealId: 4n, state: DealState.Funded, expiry: FUTURE })],
  // 5: Completed (terminal) → skip even though "expired".
  [5n, deal({ dealId: 5n, state: DealState.Completed, expiry: PAST })],
  // 6: Refunded (terminal) → skip.
  [6n, deal({ dealId: 6n, state: DealState.Refunded, expiry: PAST })],
  // 7: Forfeited (terminal) → skip.
  [7n, deal({ dealId: 7n, state: DealState.Forfeited, expiry: PAST })],
])

class MockEscrow implements SweepClient {
  public reclaimedReports: { dealId: bigint; report: `0x${string}` }[] = []
  async nowSec() {
    return NOW
  }
  async getDeal(dealId: bigint): Promise<Deal> {
    const d = BOOK.get(dealId)
    if (!d) throw new Error(`no such deal ${dealId}`)
    return d
  }
  async reclaimExpired(dealId: bigint, report: `0x${string}`): Promise<string> {
    this.reclaimedReports.push({ dealId, report })
    // Flip to a terminal state, mimicking the on-chain effect.
    const d = BOOK.get(dealId)!
    BOOK.set(dealId, { ...d, state: DealState.Refunded })
    return `0xMOCKTX_${dealId.toString().padStart(2, '0')}`
  }
}

async function main() {
  const client = new MockEscrow()
  const result = await runSweep(client, {
    maxDealId: 50n,
    stableToken: USDC,
    backendUrl: undefined, // no backend in the pure dry-run
    getReport: async () => '0xDA7A57' as `0x${string}`, // pretend Data Streams blob
    feedId: 'ETH/USD',
    dryRun: false, // we DO exercise the reclaim path against the mock
  })

  const got = result.reclaimed.map((r) => r.dealId).sort((a, b) => Number(a - b))
  const expected = [1n, 2n, 3n]

  console.log('\n=== dry-run assertions ===')
  console.log('expected reclaimed:', expected.map(String))
  console.log('actual   reclaimed:', got.map(String))

  const ok =
    got.length === expected.length && got.every((v, i) => v === expected[i])

  // Volatile deal (3) must have used the non-empty report; stable (1,2) used 0x.
  const r1 = client.reclaimedReports.find((r) => r.dealId === 1n)?.report
  const r3 = client.reclaimedReports.find((r) => r.dealId === 3n)?.report
  const reportsOk = r1 === '0x' && r3 === '0xDA7A57'
  console.log(`stable deal 1 report === 0x         : ${r1 === '0x'}`)
  console.log(`volatile deal 3 report === 0xDA7A57 : ${r3 === '0xDA7A57'}`)

  if (ok && reportsOk && result.failed.length === 0) {
    console.log('\nDRY RUN PASS ✓  (keeper logic verified with no chain)')
    process.exit(0)
  } else {
    console.error('\nDRY RUN FAIL ✗')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('dry-run fatal:', e)
  process.exit(1)
})

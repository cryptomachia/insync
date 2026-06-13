// The reclaim-sweep algorithm, factored out so the LOCAL keeper and the
// dry-run harness share one implementation. It is generic over a minimal
// `SweepClient` interface, which both the real viem EscrowClient and a mocked
// in-memory client satisfy — that's how we unit-exercise the keeper logic with
// zero chain access.

import {
  decodeDeal,
  dealStateName,
  isReclaimable,
  isVolatile,
  reclaimOutcome,
  type Deal,
  type GetDealResult,
} from './deals'
import { notifyBackend } from './notify'

export interface SweepClient {
  nowSec(): Promise<bigint>
  getDeal(dealId: bigint): Promise<Deal>
  reclaimExpired(dealId: bigint, report: `0x${string}`): Promise<string> // returns tx hash
}

export interface SweepOptions {
  maxDealId: bigint
  stableToken?: `0x${string}`
  backendUrl?: string
  /** Resolve the Data Streams report for a volatile deal (mock = `0x`). */
  getReport: (feedId: string) => Promise<`0x${string}`>
  feedId: string
  /** Logger (defaults to console.log). */
  log?: (msg: string) => void
  /** If true, do everything except send the reclaim tx (read-only preview). */
  dryRun?: boolean
}

export interface SweepResult {
  scanned: number
  candidates: bigint[]
  reclaimed: { dealId: bigint; txHash: string; outcome: string }[]
  failed: { dealId: bigint; error: string }[]
}

/** Convenience for the in-memory mock client (decode a raw getDeal tuple). */
export function dealFromTuple(dealId: bigint, t: GetDealResult): Deal {
  return decodeDeal(dealId, t)
}

export async function runSweep(client: SweepClient, opts: SweepOptions): Promise<SweepResult> {
  const log = opts.log ?? ((m: string) => console.log(m))
  const result: SweepResult = { scanned: 0, candidates: [], reclaimed: [], failed: [] }

  const nowSec = await client.nowSec()
  log(
    `[sweep] start: now=${nowSec} maxDealId=${opts.maxDealId} ${
      opts.dryRun ? '(DRY RUN — no tx)' : ''
    }`,
  )
  await notifyBackend(opts.backendUrl, { dealId: '0', event: 'SweepStarted' })

  for (let id = 1n; id <= opts.maxDealId; id++) {
    let deal: Deal
    try {
      deal = await client.getDeal(id)
    } catch (e) {
      // Contiguous ids: first failing read means we've run past the last deal.
      log(`[sweep] getDeal(${id}) failed → end of deals (${String(e)})`)
      break
    }
    result.scanned++

    if (deal.state === 0) {
      // None == unfunded slot; with contiguous ids this also means we're done.
      log(`[sweep] deal ${id} is None → end of deals`)
      break
    }

    const reclaimable = isReclaimable(deal, nowSec)
    log(
      `[sweep] deal ${id}: state=${dealStateName(deal.state)} expiry=${deal.expiry} ` +
        `checkedIn=${deal.sellerCheckedIn} reclaimable=${reclaimable}`,
    )
    if (!reclaimable) continue

    result.candidates.push(id)
    const outcome = reclaimOutcome(deal)
    const volatile = isVolatile(deal, opts.stableToken)
    const report = volatile ? await opts.getReport(opts.feedId) : ('0x' as `0x${string}`)
    log(
      `[sweep] deal ${id} RECLAIMABLE → reclaimExpired (${outcome}) ` +
        `[${volatile ? 'volatile, report=' + report.slice(0, 10) + '…' : 'stable, report=0x'}]`,
    )

    await notifyBackend(opts.backendUrl, {
      dealId: id.toString(),
      event: 'ReclaimAttempt',
      detail: outcome,
    })

    if (opts.dryRun) {
      log(`[sweep] deal ${id} would reclaim now (dry run, skipping tx)`)
      continue
    }

    try {
      const txHash = await client.reclaimExpired(id, report)
      result.reclaimed.push({ dealId: id, txHash, outcome })
      log(`[sweep] deal ${id} RECLAIMED ✓ tx=${txHash} (${outcome})`)
      await notifyBackend(opts.backendUrl, {
        dealId: id.toString(),
        event: 'Reclaimed',
        detail: `${outcome} tx=${txHash}`,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      result.failed.push({ dealId: id, error })
      log(`[sweep] deal ${id} reclaim FAILED: ${error}`)
      await notifyBackend(opts.backendUrl, {
        dealId: id.toString(),
        event: 'ReclaimFailed',
        detail: error,
      })
    }
  }

  log(
    `[sweep] done: scanned=${result.scanned} candidates=${result.candidates.length} ` +
      `reclaimed=${result.reclaimed.length} failed=${result.failed.length}`,
  )
  await notifyBackend(opts.backendUrl, {
    dealId: '0',
    event: 'SweepCompleted',
    detail: `reclaimed=${result.reclaimed.length}`,
  })
  return result
}

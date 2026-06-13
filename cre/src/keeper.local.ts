// =============================================================================
// keeper.local.ts — fully-offline reclaim keeper (run with: npm run keeper:local)
// =============================================================================
//
// This is the demoable, ZERO-CHAINLINK-ACCOUNT twin of the CRE workflow. It
// performs the EXACT same reclaim sweep — find deals past `expiry` not in a
// terminal state and call `Escrow.reclaimExpired(dealId, report)` — but using a
// plain viem wallet (keeper PRIVATE_KEY) against local anvil + the deployed
// Escrow, instead of the Chainlink DON.
//
// It reuses the identical domain rules (src/deals.ts) and sweep algorithm
// (src/sweep.ts) as workflow.ts, so "what the keeper does" and "what CRE does"
// can never drift. The ONLY difference is the transport of the final tx:
//   * CRE:   runtime.report(...) → DON consensus + signature → writeReport
//   * local: viem writeContract from the keeper EOA
//
// Run modes:
//   npm run keeper:local              one sweep, then exit
//   npm run keeper:local -- --watch   sweep on an interval (CRE_INTERVAL_MS)
//   npm run keeper:local -- --dry-run read-only preview, never sends a tx
//
// Env (SPEC §14): RPC_URL, ESCROW_ADDRESS, PRIVATE_KEY, CHAIN_ID, USDC_ADDRESS
// (stable token), BACKEND_URL, DATASTREAMS_FEED_ETHUSD, MOCK.
// =============================================================================

import { getReport } from '@handoff/datastreams'
import { getKeeperEnv } from './env'
import { EscrowClient } from './escrow-client'
import { runSweep } from './sweep'

async function main() {
  const args = new Set(process.argv.slice(2))
  const watch = args.has('--watch')
  const dryRun = args.has('--dry-run')
  const env = getKeeperEnv()

  console.log('=== Handoff local reclaim keeper ===')
  console.log(`  RPC_URL        ${env.rpcUrl}`)
  console.log(`  CHAIN_ID       ${env.chainId}`)
  console.log(`  ESCROW_ADDRESS ${env.escrowAddress}`)
  console.log(`  stableToken    ${env.stableToken ?? '(none → all deals treated as stable)'}`)
  console.log(`  BACKEND_URL    ${env.backendUrl ?? '(none → /notify disabled)'}`)
  console.log(`  MOCK           ${env.mock}`)
  console.log(`  mode           ${dryRun ? 'DRY RUN' : watch ? 'WATCH' : 'one-shot'}`)
  console.log('')

  const client = new EscrowClient({
    rpcUrl: env.rpcUrl,
    chainId: env.chainId,
    escrowAddress: env.escrowAddress,
    privateKey: dryRun ? undefined : env.privateKey,
  })
  if (!dryRun && client.account) {
    console.log(`  keeper EOA     ${client.account.address}`)
  }

  const sweepOnce = () =>
    runSweep(client, {
      maxDealId: env.maxDealId,
      stableToken: env.stableToken,
      backendUrl: env.backendUrl,
      getReport, // @handoff/datastreams: live or mock (`0x`)
      feedId: env.feedEthUsd,
      dryRun,
    })

  if (!watch) {
    await sweepOnce()
    return
  }

  const intervalMs = Number(process.env.CRE_INTERVAL_MS ?? 30_000)
  console.log(`[watch] sweeping every ${intervalMs}ms (Ctrl-C to stop)\n`)
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      await sweepOnce()
    } catch (e) {
      console.error('[watch] sweep error:', e)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

main().catch((e) => {
  console.error('keeper.local fatal:', e)
  process.exit(1)
})

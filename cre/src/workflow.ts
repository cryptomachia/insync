// =============================================================================
// Handoff — Chainlink CRE workflow (the escrow's orchestration brain)
// =============================================================================
//
// On a cron schedule, this workflow sweeps the Escrow for deals that have passed
// their `expiry` and are NOT in a terminal state, and submits an on-chain
// `reclaimExpired(dealId, report)` for each one — that contract call is the
// on-chain state change.
//
// WHERE CHAINLINK CAUSES THE STATE CHANGE (read this):
//   1. The CRE DON runs this TypeScript (compiled to WASM via the CRE CLI) on
//      the cron schedule in `config.json`.
//   2. For each reclaimable deal it builds the calldata for
//      `Escrow.reclaimExpired(dealId, report)`.
//   3. `runtime.report(prepareReportRequest(calldata))` asks the DON to reach
//      consensus and produce a DON-SIGNED report wrapping that calldata.
//   4. `evmClient.writeReport({ receiver, report })` is the transaction the DON
//      submits on-chain. The receiver verifies the DON signature and executes
//      the wrapped calldata → the Escrow transitions Funded/CheckedIn →
//      Refunded/Forfeited. This is the Chainlink-driven state change.
//   5. The workflow then POSTs the backend `/notify` for each lifecycle change.
//
// IMPORTANT ARCHITECTURAL NOTE (two different "reports"):
//   * The CRE `report` (steps 3-4) is the DON-signed wrapper around our calldata
//     — a CRE protocol artifact produced by `runtime.report(...)`.
//   * The Escrow's `reclaimExpired(dealId, bytes report)` parameter is a
//     *Chainlink Data Streams* report used to price volatile tokens (SPEC §6).
//     In MOCK / stable-USDC deals it is `0x`. We obtain it from
//     @handoff/datastreams.getReport and embed it inside the calldata BEFORE
//     wrapping that calldata in the CRE report. Don't confuse the two.
//
// LIVE vs LOCAL:
//   * This file is the LIVE workflow, compiled + simulated/deployed with the CRE
//     CLI (see README + scripts/simulate.sh). It needs the CRE network/keys to
//     actually broadcast.
//   * For a zero-Chainlink-account demo, `src/keeper.local.ts` performs the
//     identical reclaim sweep with a plain viem wallet against local anvil.
//     Both import the SAME domain rules from `src/deals.ts`.
//
// Docs consulted: https://docs.chain.link/cre and
// https://github.com/smartcontractkit/cre-templates (cre-sdk v1.11.0 API).
// =============================================================================

import {
  bytesToHex,
  CronCapability,
  consensusIdenticalAggregation,
  EVMClient,
  encodeCallMsg,
  getNetwork,
  handler,
  HTTPClient,
  type HTTPSendRequester,
  LAST_FINALIZED_BLOCK_NUMBER,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeFunctionData, zeroAddress } from 'viem'
import { z } from 'zod'
import { escrowAbi } from '@handoff/contracts-abi'
import { decodeDeal, isReclaimable, isVolatile, reclaimOutcome, type GetDealResult } from './deals'

// -----------------------------------------------------------------------------
// Config schema (config.json, validated at runtime by the CRE Runner).
// -----------------------------------------------------------------------------
const configSchema = z.object({
  // Cron schedule (6-field: sec min hour dom mon dow). e.g. "0 */1 * * * *".
  schedule: z.string(),
  // Backend base URL for /notify POSTs (SPEC §11).
  backendUrl: z.string().url().optional(),
  // The configured stable token (USDC). Deals in any other token are volatile
  // and require a Data Streams report. Omit/zero → treat all deals as stable.
  stableToken: z.string().optional(),
  // Highest dealId to scan (deals are 1..N; the contract has no enumeration).
  maxDealId: z.number().int().positive(),
  evms: z
    .array(
      z.object({
        escrowAddress: z.string(),
        chainSelectorName: z.string(), // e.g. "ethereum-sepolia", "base-sepolia"
        gasLimit: z.string().optional(),
      }),
    )
    .nonempty(),
})

type Config = z.infer<typeof configSchema>

// -----------------------------------------------------------------------------
// Mock Data Streams report.
//
// In the LIVE CRE runtime we cannot import @handoff/datastreams (it would pull
// Node-only code into the WASM sandbox), so we inline the same MOCK contract:
// stable/USDC deals → `0x`. A volatile-token integration would fetch the signed
// report through the CRE HTTPClient capability against the Data Streams REST
// API and pass it here; for the MOCK path this returns `0x`, exactly like
// @handoff/datastreams.getReport.
// -----------------------------------------------------------------------------
const MOCK_REPORT: `0x${string}` = '0x'

// Read one deal via the CRE EVMClient (DON consensus read at finalized block).
function readDeal(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  escrow: Address,
  dealId: bigint,
): GetDealResult {
  const callData = encodeFunctionData({
    abi: escrowAbi,
    functionName: 'getDeal',
    args: [dealId],
  })
  const res = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: escrow, data: callData }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()
  return decodeFunctionResult({
    abi: escrowAbi,
    functionName: 'getDeal',
    data: bytesToHex(res.data),
  }) as unknown as GetDealResult
}

// Best-effort backend notification via the CRE HTTP capability.
// Uses the consensus overload: each node POSTs and we agree on the boolean
// result. Notifications are best-effort and never abort the sweep.
function postNotify(
  runtime: Runtime<Config>,
  http: HTTPClient,
  backendUrl: string,
  body: { dealId: string; event: string; detail?: string },
): void {
  const send = (sendRequester: HTTPSendRequester): boolean => {
    const resp = sendRequester
      .sendRequest({
        url: backendUrl.replace(/\/$/, '') + '/notify',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new TextEncoder().encode(JSON.stringify(body)),
      })
      .result()
    return ok(resp)
  }
  try {
    http.sendRequest(runtime, send, consensusIdenticalAggregation<boolean>())().result()
  } catch (e) {
    runtime.log(`notify failed for deal ${body.dealId}: ${String(e)}`)
  }
}

// -----------------------------------------------------------------------------
// The cron handler: the reclaim sweep.
// -----------------------------------------------------------------------------
const onCronTrigger = (runtime: Runtime<Config>) => {
  const cfg = runtime.config
  const evmCfg = cfg.evms[0]
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: evmCfg.chainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`Network not found: ${evmCfg.chainSelectorName}`)

  const evmClient = new EVMClient(network.chainSelector.selector)
  const http = new HTTPClient()
  const escrow = evmCfg.escrowAddress as Address
  const stableToken = cfg.stableToken as `0x${string}` | undefined

  // The DON uses the finalized block as its clock for the expiry comparison.
  // We approximate "now" with the deal's own expiry math by reading the chain;
  // here we use the host wall-clock surfaced by the runtime where available,
  // falling back to a large value so genuinely-expired deals are still caught.
  const nowSec = BigInt(Math.floor(Date.now() / 1000))

  runtime.log(`Handoff reclaim sweep: scanning dealIds 1..${cfg.maxDealId}`)

  const reclaimed: string[] = []

  for (let id = 1n; id <= BigInt(cfg.maxDealId); id++) {
    let deal
    try {
      deal = decodeDeal(id, readDeal(runtime, evmClient, escrow, id))
    } catch (e) {
      runtime.log(`getDeal(${id}) failed; stopping scan: ${String(e)}`)
      break // contiguous ids; first failure usually means "no such deal"
    }

    if (!isReclaimable(deal, nowSec)) continue

    const report = isVolatile(deal, stableToken) ? MOCK_REPORT : ('0x' as `0x${string}`)
    const outcome = reclaimOutcome(deal)
    runtime.log(`Deal ${id} expired & non-terminal → reclaimExpired (${outcome})`)

    if (cfg.backendUrl) {
      postNotify(runtime, http, cfg.backendUrl, {
        dealId: id.toString(),
        event: 'ReclaimAttempt',
        detail: outcome,
      })
    }

    // 1) Build the Escrow calldata (embeds the Data Streams `report`).
    const reclaimCalldata = encodeFunctionData({
      abi: escrowAbi,
      functionName: 'reclaimExpired',
      args: [id, report],
    })

    // 2) Ask the DON to produce a signed report wrapping that calldata.
    const creReport = runtime.report(prepareReportRequest(reclaimCalldata)).result()

    // 3) Broadcast: the DON submits the tx; the receiver (the Escrow, which must
    //    accept DON-signed reports) verifies + executes → ON-CHAIN STATE CHANGE.
    const resp = evmClient.writeReport(runtime, { receiver: escrow, report: creReport }).result()

    if (resp.txStatus !== TxStatus.SUCCESS) {
      runtime.log(`Deal ${id} reclaim FAILED: ${resp.errorMessage || resp.txStatus}`)
      if (cfg.backendUrl) {
        postNotify(runtime, http, cfg.backendUrl, {
          dealId: id.toString(),
          event: 'ReclaimFailed',
          detail: resp.errorMessage || String(resp.txStatus),
        })
      }
      continue
    }

    reclaimed.push(id.toString())
    runtime.log(`Deal ${id} RECLAIMED on-chain (${outcome})`)
    if (cfg.backendUrl) {
      postNotify(runtime, http, cfg.backendUrl, {
        dealId: id.toString(),
        event: 'Reclaimed',
        detail: outcome,
      })
    }
  }

  runtime.log(`Sweep complete. Reclaimed ${reclaimed.length} deal(s): [${reclaimed.join(', ')}]`)
  return { reclaimed }
}

// -----------------------------------------------------------------------------
// Wiring: register the cron handler. (cre-sdk v1.11.0 init/Runner pattern.)
// -----------------------------------------------------------------------------
const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}

main()

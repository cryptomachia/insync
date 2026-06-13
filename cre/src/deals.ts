// Shared, transport-agnostic deal logic for the Handoff escrow orchestration.
//
// This module deliberately knows NOTHING about *how* we talk to the chain (viem
// PublicClient in local mode, CRE EVMClient in workflow mode, or the backend
// REST API). It only knows the escrow's domain rules:
//
//   - which DealState values are terminal,
//   - which deals are "reclaimable" (past `expiry` and not terminal),
//   - which deals are "volatile" (need a Data Streams `report`).
//
// Both `keeper.local.ts` (offline, viem) and `workflow.ts` (live CRE) import
// the predicates here so the reclaim sweep behaves identically in every mode.

import { DealState } from '@handoff/contracts-abi'

/** A normalized deal, decoded from `getDeal(dealId)` (SPEC §3 tuple order). */
export interface Deal {
  dealId: bigint
  state: DealState
  buyer: `0x${string}`
  seller: `0x${string}`
  payToken: `0x${string}`
  priceUsd1e8: bigint
  tokenAmount: bigint
  depositBps: number
  freeCancelUntil: bigint
  expiry: bigint
  sellerCheckedIn: boolean
}

/** The raw 10-tuple returned by `getDeal` (viem decodes to this shape). */
export type GetDealResult = readonly [
  number, // state (uint8)
  `0x${string}`, // buyer
  `0x${string}`, // seller
  `0x${string}`, // payToken
  bigint, // priceUsd1e8
  bigint, // tokenAmount
  number, // depositBps (uint16)
  bigint, // freeCancelUntil (uint64)
  bigint, // expiry (uint64)
  boolean, // sellerCheckedIn
]

export function decodeDeal(dealId: bigint, t: GetDealResult): Deal {
  return {
    dealId,
    state: t[0] as DealState,
    buyer: t[1],
    seller: t[2],
    payToken: t[3],
    priceUsd1e8: t[4],
    tokenAmount: t[5],
    depositBps: t[6],
    freeCancelUntil: t[7],
    expiry: t[8],
    sellerCheckedIn: t[9],
  }
}

/**
 * Terminal states never change again, so the keeper must skip them.
 * Completed / Refunded / Forfeited are the three on-chain end states (SPEC §3).
 */
export function isTerminal(state: DealState): boolean {
  return (
    state === DealState.Completed ||
    state === DealState.Refunded ||
    state === DealState.Forfeited
  )
}

/** A deal exists (was funded) if it is not in the `None` state. */
export function exists(deal: Deal): boolean {
  return deal.state !== DealState.None
}

/**
 * The single predicate that defines a reclaim candidate (SPEC §12):
 * a live (non-terminal, existing) deal whose `expiry` has passed.
 *
 * `nowSec` is injected so callers control the clock (chain time in CRE,
 * wall clock locally) — this keeps the function pure and testable.
 */
export function isReclaimable(deal: Deal, nowSec: bigint): boolean {
  return exists(deal) && !isTerminal(deal.state) && deal.expiry <= nowSec
}

/**
 * A deal is "volatile" when its payToken is NOT the configured stable (USDC).
 * Volatile deals require a signed Data Streams `report` so the contract can
 * price the token in USD at reclaim time (SPEC §4, §6). Stable deals pass `0x`.
 */
export function isVolatile(deal: Deal, stableToken?: `0x${string}`): boolean {
  if (!stableToken) return false // no stable configured → treat all as stable (report = 0x)
  return deal.payToken.toLowerCase() !== stableToken.toLowerCase()
}

/**
 * Predict the §4 payout direction so logs/notifications are human-readable.
 * After `expiry`:
 *   - seller checked in  → deposit goes to seller (buyer ghosted a present seller)
 *   - seller not checked in → full refund to buyer (seller never showed)
 * The item price always returns to the buyer either way.
 */
export function reclaimOutcome(deal: Deal): 'deposit-to-seller' | 'full-refund-to-buyer' {
  return deal.sellerCheckedIn ? 'deposit-to-seller' : 'full-refund-to-buyer'
}

const DEAL_STATE_NAMES: Record<number, string> = {
  [DealState.None]: 'None',
  [DealState.Funded]: 'Funded',
  [DealState.SellerCheckedIn]: 'SellerCheckedIn',
  [DealState.Completed]: 'Completed',
  [DealState.Refunded]: 'Refunded',
  [DealState.Forfeited]: 'Forfeited',
}

export function dealStateName(state: number): string {
  return DEAL_STATE_NAMES[state] ?? `Unknown(${state})`
}

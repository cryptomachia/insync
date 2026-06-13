// viem-based Escrow client used by the LOCAL keeper + scan scripts.
//
// This is the off-chain (Node) twin of the CRE EVMClient usage in workflow.ts.
// It reads deals (getDeal) and, for the local keeper, sends reclaimExpired
// directly from a keeper wallet — no DON, no signed report wrapper. Same domain
// rules (src/deals.ts), different transport.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hash,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { escrowAbi } from '@handoff/contracts-abi'
import { decodeDeal, type Deal, type GetDealResult } from './deals'

export interface EscrowClientOpts {
  rpcUrl: string
  chainId: number
  escrowAddress: `0x${string}`
  privateKey?: `0x${string}` // only needed for writes (reclaim)
}

export class EscrowClient {
  readonly public: PublicClient
  readonly wallet?: WalletClient
  readonly account?: Account
  readonly escrow: `0x${string}`

  constructor(opts: EscrowClientOpts) {
    this.escrow = opts.escrowAddress
    const chain = {
      id: opts.chainId,
      name: `chain-${opts.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [opts.rpcUrl] }, public: { http: [opts.rpcUrl] } },
    } as const
    this.public = createPublicClient({ chain, transport: http(opts.rpcUrl) })
    if (opts.privateKey) {
      this.account = privateKeyToAccount(opts.privateKey)
      this.wallet = createWalletClient({ account: this.account, chain, transport: http(opts.rpcUrl) })
    }
  }

  /** Current chain timestamp (the authoritative clock for `expiry`). */
  async nowSec(): Promise<bigint> {
    const block = await this.public.getBlock({ blockTag: 'latest' })
    return block.timestamp
  }

  async getDeal(dealId: bigint): Promise<Deal> {
    const raw = (await this.public.readContract({
      address: this.escrow,
      abi: escrowAbi,
      functionName: 'getDeal',
      args: [dealId],
    })) as unknown as GetDealResult
    return decodeDeal(dealId, raw)
  }

  /**
   * Send reclaimExpired(dealId, report) from the keeper wallet and wait for the
   * receipt. THIS is the local equivalent of the CRE workflow's on-chain state
   * change — the same Escrow function, just signed by a keeper EOA instead of
   * the DON.
   */
  async reclaimExpired(dealId: bigint, report: `0x${string}`): Promise<Hash> {
    if (!this.wallet || !this.account) {
      throw new Error('reclaimExpired requires a keeper PRIVATE_KEY')
    }
    // Simulate first so we get a clean revert reason instead of a raw tx failure.
    const { request } = await this.public.simulateContract({
      account: this.account,
      address: this.escrow,
      abi: escrowAbi,
      functionName: 'reclaimExpired',
      args: [dealId, report],
    })
    const hash = await this.wallet.writeContract(request)
    await this.public.waitForTransactionReceipt({ hash })
    return hash
  }
}

// STUB (foundation). AGENT 6 replaces with the real Blink one-tap deposit (adds ERC20 approve
// + Blink SDK). Keep these exact exports (SPEC §8).
import React from 'react';
import { createPublicClient, decodeEventLog, http, type WalletClient } from 'viem';
import { escrowAbi, getAddresses } from '@handoff/contracts-abi';

type FundArgs = {
  listingId: bigint;
  tokenAmount: bigint;
  freeCancelUntil: bigint;
  expiry: bigint;
  walletClient: WalletClient;
};

const RPC = (globalThis as any)?.process?.env?.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';

export function useFunding() {
  async function fund(args: FundArgs): Promise<bigint> {
    const { escrow } = getAddresses();
    if (!escrow) throw new Error('ESCROW_ADDRESS not set');
    if (!args.walletClient.account) throw new Error('wallet not connected');
    const hash = await args.walletClient.writeContract({
      address: escrow,
      abi: escrowAbi,
      functionName: 'fund',
      args: [args.listingId, args.tokenAmount, args.freeCancelUntil, args.expiry],
      account: args.walletClient.account,
      chain: args.walletClient.chain,
    });
    const pub = createPublicClient({ transport: http(RPC) });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'Funded') return (decoded.args as any).dealId as bigint;
      } catch {
        /* not our event */
      }
    }
    return 0n;
  }
  return { fund };
}

export function FundButton(props: FundArgs & {
  onFunded: (dealId: bigint) => void;
  onError?: (e: unknown) => void;
}) {
  const { fund } = useFunding();
  return (
    <button
      onClick={async () => {
        try {
          props.onFunded(await fund(props));
        } catch (e) {
          props.onError?.(e);
        }
      }}
    >
      Fund (one tap)
    </button>
  );
}

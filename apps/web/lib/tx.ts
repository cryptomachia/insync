// Write transactions to the Escrow, signed by the wallet client from @handoff/auth.
// Funding goes through @handoff/funding (FundButton/useFunding); these cover the rest of the
// lifecycle: list / checkIn / confirmReceipt / agreeCancel / buyerCancel. (SPEC §3, §10)
import type { WalletClient } from 'viem';
import { escrowAbi, getAddresses } from '@handoff/contracts-abi';
import { getReport } from '@handoff/datastreams';
import { publicClient, chain } from './chain';
import { isStableToken } from './format';

function escrowAddr(): `0x${string}` {
  const { escrow } = getAddresses();
  if (!escrow) throw new Error('NEXT_PUBLIC_ESCROW_ADDRESS not set');
  return escrow;
}

function requireAccount(wc: WalletClient) {
  if (!wc.account) throw new Error('Wallet not connected');
  return wc.account;
}

async function send(wc: WalletClient, fn: () => Promise<`0x${string}`>) {
  const hash = await fn();
  await publicClient().waitForTransactionReceipt({ hash });
  return hash;
}

/** Seller creates a listing. Returns the listingId parsed from the Listed event. */
export async function listItem(
  wc: WalletClient,
  args: { priceUsd1e8: bigint; depositBps: number; payToken: `0x${string}` },
): Promise<bigint> {
  const account = requireAccount(wc);
  const hash = await wc.writeContract({
    address: escrowAddr(),
    abi: escrowAbi,
    functionName: 'list',
    args: [args.priceUsd1e8, args.depositBps, args.payToken],
    account,
    chain,
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  // Parse listingId from the Listed event.
  const { decodeEventLog } = await import('viem');
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: escrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'Listed') {
        return (decoded.args as { listingId: bigint }).listingId;
      }
    } catch {
      /* not our event */
    }
  }
  return 0n;
}

/** Seller checks in at the meet (gates forfeiture). */
export async function checkIn(wc: WalletClient, dealId: bigint) {
  const account = requireAccount(wc);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'checkIn',
      args: [dealId],
      account,
      chain,
    }),
  );
}

/**
 * Buyer confirms receipt (success path). For a volatile payToken we fetch a Data Streams
 * report and pass it in; for the stable token (USDC) an empty report is fine. (SPEC §6/§10)
 */
export async function confirmReceipt(
  wc: WalletClient,
  dealId: bigint,
  payToken: `0x${string}`,
) {
  const account = requireAccount(wc);
  const report = await reportFor(payToken);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'confirmReceipt',
      args: [dealId, report],
      account,
      chain,
    }),
  );
}

/** Seller co-signs a cancel -> full refund to buyer. */
export async function agreeCancel(wc: WalletClient, dealId: bigint) {
  const account = requireAccount(wc);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'agreeCancel',
      args: [dealId],
      account,
      chain,
    }),
  );
}

/** Buyer cancels -> outcome per §4 (report needed only for volatile tokens). */
export async function buyerCancel(
  wc: WalletClient,
  dealId: bigint,
  payToken: `0x${string}`,
) {
  const account = requireAccount(wc);
  const report = await reportFor(payToken);
  return send(wc, () =>
    wc.writeContract({
      address: escrowAddr(),
      abi: escrowAbi,
      functionName: 'buyerCancel',
      args: [dealId, report],
      account,
      chain,
    }),
  );
}

async function reportFor(payToken: `0x${string}`): Promise<`0x${string}`> {
  if (isStableToken(payToken)) return '0x';
  const feed = process.env.NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD ?? 'ETH/USD';
  return getReport(feed);
}

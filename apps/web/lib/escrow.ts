// Typed reads of Escrow listing/deal state via viem + escrowAbi (SPEC §3/§5/§10).
import { escrowAbi, getAddresses, DealState } from '@handoff/contracts-abi';
import { publicClient } from './chain';

export type Listing = {
  listingId: bigint;
  seller: `0x${string}`;
  priceUsd1e8: bigint;
  depositBps: number;
  payToken: `0x${string}`;
  active: boolean;
  // Seller-set cancellation timing policy (seconds), derived into the deal at fund time.
  freeCancelWindow: bigint;
  dealTtl: bigint;
  // Seller no-show bond staked on the listing (payToken units); forfeited to the buyer if the
  // seller ghosts.
  bond: bigint;
};

export type Deal = {
  dealId: bigint;
  state: DealState;
  buyer: `0x${string}`;
  seller: `0x${string}`;
  payToken: `0x${string}`;
  priceUsd1e8: bigint;
  tokenAmount: bigint;
  depositBps: number;
  freeCancelUntil: bigint;
  expiry: bigint;
  sellerCheckedIn: boolean;
};

function requireEscrow(): `0x${string}` {
  const { escrow } = getAddresses();
  if (!escrow) {
    throw new Error(
      'NEXT_PUBLIC_ESCROW_ADDRESS is not set. Deploy contracts and set the address (scripts/deploy).',
    );
  }
  return escrow;
}

export async function readListing(listingId: bigint): Promise<Listing> {
  const escrow = requireEscrow();
  const [seller, priceUsd1e8, depositBps, payToken, active, freeCancelWindow, dealTtl, bond] =
    await publicClient().readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: 'getListing',
      args: [listingId],
    });
  return {
    listingId,
    seller,
    priceUsd1e8,
    depositBps: Number(depositBps),
    payToken,
    active,
    freeCancelWindow,
    dealTtl,
    bond,
  };
}

export async function readDeal(dealId: bigint): Promise<Deal> {
  const escrow = requireEscrow();
  const [
    state,
    buyer,
    seller,
    payToken,
    priceUsd1e8,
    tokenAmount,
    depositBps,
    freeCancelUntil,
    expiry,
    sellerCheckedIn,
  ] = await publicClient().readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: 'getDeal',
    args: [dealId],
  });
  return {
    dealId,
    state: Number(state) as DealState,
    buyer,
    seller,
    payToken,
    priceUsd1e8,
    tokenAmount,
    depositBps: Number(depositBps),
    freeCancelUntil,
    expiry,
    sellerCheckedIn,
  };
}

export const DEAL_STATE_LABEL: Record<DealState, string> = {
  [DealState.None]: 'No deal',
  [DealState.Funded]: 'Funds committed',
  [DealState.SellerCheckedIn]: 'Seller checked in',
  [DealState.Completed]: 'Completed',
  [DealState.Refunded]: 'Refunded',
  [DealState.Forfeited]: 'Deposit forfeited',
};

export function isTerminal(state: DealState): boolean {
  return (
    state === DealState.Completed ||
    state === DealState.Refunded ||
    state === DealState.Forfeited
  );
}

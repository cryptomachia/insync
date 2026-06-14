// SPEC §4 — the commitment-deposit cancellation model, expressed in plain language.
// The item price is ALWAYS safe for the buyer; only the seller-set deposit is ever at risk,
// and only when the buyer flakes after the seller showed up.
import { DealState } from '@handoff/contracts-abi';
import { fmtUsd1e8, depositUsd1e8 } from './format';
import type { Deal } from './escrow';

export type Party = 'buyer' | 'seller';

export type CancelOutcome = {
  priceTo: Party;
  depositTo: Party;
  // One-line plain-language summary for whoever is acting.
  summary: string;
};

export function nowSec(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** Is the free-cancel window still open? */
export function inFreeWindow(deal: Deal, at: bigint = nowSec()): boolean {
  return at < deal.freeCancelUntil;
}

/**
 * What happens if the BUYER cancels right now (buyerCancel), per §4.
 * Rows 3–5 of the table.
 */
export function buyerCancelOutcome(deal: Deal, at: bigint = nowSec()): CancelOutcome {
  const price = fmtUsd1e8(deal.priceUsd1e8);
  const deposit = fmtUsd1e8(depositUsd1e8(deal.priceUsd1e8, deal.depositBps));

  if (inFreeWindow(deal, at)) {
    return {
      priceTo: 'buyer',
      depositTo: 'buyer',
      summary: `Cancel now (free window): you get your full ${price} back, including the ${deposit} deposit.`,
    };
  }
  if (deal.sellerCheckedIn) {
    // After free window AND seller checked in -> buyer flaked on a present seller.
    return {
      priceTo: 'buyer',
      depositTo: 'seller',
      summary: `Cancel now: you get your ${price} item payment back, but the seller keeps the ${deposit} deposit (they showed up).`,
    };
  }
  // After free window, seller NOT checked in -> seller no-show protection.
  return {
    priceTo: 'buyer',
    depositTo: 'buyer',
    summary: `Cancel now: the seller never checked in, so you get your full ${price} back, including the ${deposit} deposit.`,
  };
}

/** What happens if the SELLER co-signs a cancel (agreeCancel) — always a full refund. §4 row 2. */
export function agreeCancelOutcome(deal: Deal): CancelOutcome {
  const price = fmtUsd1e8(deal.priceUsd1e8);
  return {
    priceTo: 'buyer',
    depositTo: 'buyer',
    summary: `Agree to cancel: the buyer is fully refunded ${price} (price + deposit). No one is penalized.`,
  };
}

/** What a successful release pays out. §4 row 1. */
export function completionOutcome(deal: Deal): CancelOutcome {
  const price = fmtUsd1e8(deal.priceUsd1e8);
  const deposit = fmtUsd1e8(depositUsd1e8(deal.priceUsd1e8, deal.depositBps));
  return {
    priceTo: 'seller',
    depositTo: 'buyer',
    summary: `On release: the seller is paid ${price} and your ${deposit} deposit comes back to you.`,
  };
}

/**
 * Plain-language description of the listing's policy, shown to the buyer BEFORE funding.
 * depositBps is the per-listing cancellation policy.
 */
export function policyText(priceUsd1e8: bigint, depositBps: number): string {
  const price = fmtUsd1e8(priceUsd1e8);
  const deposit = fmtUsd1e8(depositUsd1e8(priceUsd1e8, depositBps));
  if (depositBps === 0) {
    return `The ${price} you pay is held safely and is always refundable until you confirm you got the item. No deposit on this listing.`;
  }
  return (
    `The ${price} you pay for the item is always refundable to you. ` +
    `You also put down a small ${deposit} deposit that comes straight back the moment the deal completes. ` +
    `You'd only lose it if you back out after the seller has already shown up to meet you — ` +
    `and if the seller doesn't show, you get everything back.`
  );
}

/** Whether a buyerCancel is even allowed in the current state (not terminal, not completed). */
export function canBuyerCancel(state: DealState): boolean {
  return state === DealState.Funded || state === DealState.SellerCheckedIn;
}

export function canAgreeCancel(state: DealState): boolean {
  return state === DealState.Funded || state === DealState.SellerCheckedIn;
}

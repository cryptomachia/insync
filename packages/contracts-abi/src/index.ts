// Shared, FROZEN contract interface for all TS consumers (frontend, backend, cre, datastreams).
// The contracts agents may replace JSON artifacts but MUST keep these exports and signatures
// identical to SPEC.md §3. viem `parseAbi` understands these human-readable signatures.
import { parseAbi } from 'viem';

export const escrowAbiHuman = [
  'function list(uint256 priceUsd1e8, uint16 depositBps, address payToken, uint64 freeCancelWindow, uint64 dealTtl, uint256 bondAmount) returns (uint256 listingId)',
  'function cancelListing(uint256 listingId)',
  'function getListing(uint256 listingId) view returns (address seller, uint256 priceUsd1e8, uint16 depositBps, address payToken, bool active, uint64 freeCancelWindow, uint64 dealTtl, uint256 bond)',
  'function bondOf(uint256 dealId) view returns (uint256)',
  'function fund(uint256 listingId, uint256 tokenAmount) returns (uint256 dealId)',
  'function checkIn(uint256 dealId)',
  'function confirmReceipt(uint256 dealId, bytes report)',
  'function agreeCancel(uint256 dealId)',
  'function buyerCancel(uint256 dealId, bytes report)',
  'function reclaimExpired(uint256 dealId, bytes report)',
  'function getDeal(uint256 dealId) view returns (uint8 state, address buyer, address seller, address payToken, uint256 priceUsd1e8, uint256 tokenAmount, uint16 depositBps, uint64 freeCancelUntil, uint64 expiry, bool sellerCheckedIn)',
  'event Listed(uint256 indexed listingId, address indexed seller, uint256 priceUsd1e8, uint16 depositBps, address payToken, uint64 freeCancelWindow, uint64 dealTtl, uint256 bond)',
  'event ListingCancelled(uint256 indexed listingId)',
  'event BondSettled(uint256 indexed dealId, address indexed to, uint256 amount)',
  'event Funded(uint256 indexed dealId, uint256 indexed listingId, address indexed buyer, address seller, uint256 tokenAmount, uint64 freeCancelUntil, uint64 expiry)',
  'event CheckedIn(uint256 indexed dealId)',
  'event Completed(uint256 indexed dealId, uint256 sellerPaid, uint256 buyerRefunded)',
  'event Refunded(uint256 indexed dealId, uint256 amount)',
  'event Forfeited(uint256 indexed dealId, uint256 toBuyer, uint256 toSeller)',
] as const;

export const reputationAbiHuman = [
  'function scoreOf(address who) view returns (uint256)',
  'function statsOf(address who) view returns (uint256 completed, uint256 buyerFlakes, uint256 sellerNoShows, uint256 mutualCancels)',
] as const;

export const escrowAbi = parseAbi(escrowAbiHuman);
export const reputationAbi = parseAbi(reputationAbiHuman);

// Deal.state enum, mirrors Solidity `enum State`.
export enum DealState {
  None = 0,
  Funded = 1,
  SellerCheckedIn = 2,
  Completed = 3,
  Refunded = 4,
  Forfeited = 5,
}

export type Address = `0x${string}`;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
function valid(v: string | undefined): Address | undefined {
  return v && ADDR_RE.test(v) ? (v as Address) : undefined;
}

// NEXT_PUBLIC_* are referenced LITERALLY so Next inlines them into the browser
// bundle (a dynamic `env[key]` lookup is not statically replaced and reads
// undefined client-side). The non-prefixed fallbacks are read in Node
// (backend/cre/e2e) where the full process.env is available.
export function getAddresses() {
  const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  return {
    escrow: valid(process.env.NEXT_PUBLIC_ESCROW_ADDRESS) ?? valid(env.ESCROW_ADDRESS),
    reputation: valid(process.env.NEXT_PUBLIC_REPUTATION_ADDRESS) ?? valid(env.REPUTATION_ADDRESS),
    usdc: valid(process.env.NEXT_PUBLIC_USDC_ADDRESS) ?? valid(env.USDC_ADDRESS),
    verifierProxy: valid(process.env.NEXT_PUBLIC_VERIFIER_PROXY_ADDRESS) ?? valid(env.VERIFIER_PROXY_ADDRESS),
  };
}

export const IS_MOCK =
  process.env.NEXT_PUBLIC_MOCK === 'true' ||
  (typeof process !== 'undefined' && process.env.MOCK === 'true');

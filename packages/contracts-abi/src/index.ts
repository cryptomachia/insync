// Shared, FROZEN contract interface for all TS consumers (frontend, backend, cre, datastreams).
// The contracts agents may replace JSON artifacts but MUST keep these exports and signatures
// identical to SPEC.md §3. viem `parseAbi` understands these human-readable signatures.
import { parseAbi } from 'viem';

export const escrowAbiHuman = [
  'function list(uint256 priceUsd1e8, uint16 depositBps, address payToken) returns (uint256 listingId)',
  'function getListing(uint256 listingId) view returns (address seller, uint256 priceUsd1e8, uint16 depositBps, address payToken, bool active)',
  'function fund(uint256 listingId, uint256 tokenAmount, uint64 freeCancelUntil, uint64 expiry) returns (uint256 dealId)',
  'function checkIn(uint256 dealId)',
  'function confirmReceipt(uint256 dealId, bytes report)',
  'function agreeCancel(uint256 dealId)',
  'function buyerCancel(uint256 dealId, bytes report)',
  'function reclaimExpired(uint256 dealId, bytes report)',
  'function getDeal(uint256 dealId) view returns (uint8 state, address buyer, address seller, address payToken, uint256 priceUsd1e8, uint256 tokenAmount, uint16 depositBps, uint64 freeCancelUntil, uint64 expiry, bool sellerCheckedIn)',
  'event Listed(uint256 indexed listingId, address indexed seller, uint256 priceUsd1e8, uint16 depositBps, address payToken)',
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

function pick(...keys: string[]): Address | undefined {
  const env = (globalThis as any)?.process?.env ?? {};
  for (const k of keys) {
    const v = env[k];
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as Address;
  }
  return undefined;
}

export function getAddresses() {
  return {
    escrow: pick('NEXT_PUBLIC_ESCROW_ADDRESS', 'ESCROW_ADDRESS'),
    reputation: pick('NEXT_PUBLIC_REPUTATION_ADDRESS', 'REPUTATION_ADDRESS'),
    usdc: pick('NEXT_PUBLIC_USDC_ADDRESS', 'USDC_ADDRESS'),
    verifierProxy: pick('VERIFIER_PROXY_ADDRESS'),
  };
}

export const IS_MOCK =
  String((globalThis as any)?.process?.env?.MOCK ?? '').toLowerCase() === 'true' ||
  String((globalThis as any)?.process?.env?.NEXT_PUBLIC_MOCK ?? '').toLowerCase() === 'true';

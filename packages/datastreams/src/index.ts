// STUB (foundation). AGENT 4 replaces with the real Chainlink Data Streams client.
// Keep these exact exports (SPEC §6).
const env = (globalThis as any)?.process?.env ?? {};
export const MOCK =
  String(env.MOCK ?? '').toLowerCase() === 'true' ||
  String(env.NEXT_PUBLIC_MOCK ?? '').toLowerCase() === 'true';

export const FEEDS: Record<string, string> = {
  'ETH/USD': '0x000000000000000000000000000000000000000000000000000045544855534400',
};

/** Returns the bytes blob to pass into confirmReceipt/buyerCancel/reclaimExpired. */
export async function getReport(_feedId: string): Promise<`0x${string}`> {
  // Mock: empty report; the MockVerifier accepts it and the contract uses a fixed price.
  return '0x';
}

/** USD price with 8 decimals, for UI estimates. */
export async function getTokenPriceUsd1e8(_feedId: string): Promise<bigint> {
  return 4000n * 10n ** 8n; // $4000 mock
}

// My-deals data comes from the backend indexer (SPEC §10/§11): GET /deals?user=0x..
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8787';

export type BackendDeal = {
  dealId: string;
  listingId?: string;
  buyer: string;
  seller: string;
  state: number;
  priceUsd1e8: string;
  payToken: string;
  depositBps?: number;
  sellerCheckedIn?: boolean;
};

export async function fetchMyDeals(user: string): Promise<BackendDeal[]> {
  const res = await fetch(
    `${BACKEND_URL}/deals?user=${encodeURIComponent(user)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) {
    throw new Error(`Backend ${res.status}: GET /deals failed`);
  }
  const data = await res.json();
  // Be tolerant of shape: either an array or { deals: [...] }.
  if (Array.isArray(data)) return data as BackendDeal[];
  if (Array.isArray(data?.deals)) return data.deals as BackendDeal[];
  return [];
}

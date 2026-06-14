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

// Off-chain listing metadata (item name, description, photo) keyed by on-chain listingId.
// The contract only stores price/deposit/token/seller; the human details live here.
export type ListingMeta = { title?: string; description?: string; image?: string };

export async function saveListingMeta(
  listingId: bigint | string,
  meta: ListingMeta,
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/listings/${listingId}/meta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(meta),
  });
  if (!res.ok) throw new Error(`Backend ${res.status}: could not save listing details`);
}

export async function getListingMeta(
  listingId: bigint | string,
): Promise<ListingMeta | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/listings/${listingId}/meta`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.meta ?? data ?? null) as ListingMeta | null;
  } catch {
    return null;
  }
}

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

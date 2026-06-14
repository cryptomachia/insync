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
export type ListingMeta = {
  title?: string;
  description?: string;
  image?: string;
  meetAddress?: string | null;
  meetLat?: number | null;
  meetLng?: number | null;
  sellerPhone?: string | null;
  sellerEmail?: string | null;
  meetTime?: string | null;
  notes?: string | null;
  sellerAddress?: string | null;
  archived?: boolean;
};

export type PartyCoordination = {
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  updatedAt: number;
} | null;

export type Coordination = {
  buyer: PartyCoordination;
  seller: PartyCoordination;
  listingId?: string | null;
};

export type SellerListing = {
  listingId: string;
  title: string | null;
  image: string | null;
  meetAddress: string | null;
  archived?: boolean;
};

export type MarketListing = {
  listingId: string;
  seller: string;
  priceUsd1e8: string;
  depositBps: number;
  payToken: string;
  title: string | null;
  image: string | null;
  meetAddress: string | null;
};

/** Purchasable listings for the browse grid (active + not withdrawn, with details). */
export async function getActiveListings(): Promise<MarketListing[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/listings/active`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.listings ?? []) as MarketListing[];
  } catch {
    return [];
  }
}

/** All listings created by a seller address (for "My listings"). */
export async function getMyListings(address: string): Promise<SellerListing[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/sellers/${address}/listings`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.listings ?? []) as SellerListing[];
  } catch {
    return [];
  }
}

/** Read both parties' live location/phone for a deal. */
export async function getCoordination(dealId: bigint | string): Promise<Coordination> {
  try {
    const res = await fetch(`${BACKEND_URL}/deals/${dealId}/coordination`, { cache: 'no-store' });
    if (!res.ok) return { buyer: null, seller: null };
    return (await res.json()) as Coordination;
  } catch {
    return { buyer: null, seller: null };
  }
}

/** Share my live location and/or phone for a deal, as buyer or seller. */
export async function shareCoordination(
  dealId: bigint | string,
  role: 'buyer' | 'seller',
  data: { lat?: number; lng?: number; phone?: string; email?: string; note?: string; listingId?: string },
): Promise<void> {
  await fetch(`${BACKEND_URL}/deals/${dealId}/coordination`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, ...data }),
  });
}

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

export type DealEvent = {
  event: string;
  payload: string | null;
  createdAt: number;
};

/** Lifecycle events recorded by the indexer for a deal (Funded/CheckedIn/Completed/…). */
export async function getDealEvents(dealId: bigint | string): Promise<DealEvent[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/deals/${dealId}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = (data?.notifications ?? []) as Array<{
      event: string;
      payload: string | null;
      created_at: number;
    }>;
    return rows.map((r) => ({ event: r.event, payload: r.payload, createdAt: r.created_at }));
  } catch {
    return [];
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

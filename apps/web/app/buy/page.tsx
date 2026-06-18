'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getActiveListings, type MarketListing } from '@/lib/backend';
import { fmtUsd1e8, shortAddr } from '@/lib/format';
import { InfoNote } from '@/components/Notice';

function safeBig(v: string | undefined): bigint {
  try {
    return BigInt(v ?? '0');
  } catch {
    return 0n;
  }
}

export default function BuyIndexPage() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [listings, setListings] = useState<MarketListing[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    getActiveListings().then(setListings).catch(() => setListings([]));
  }, []);

  const filtered = useMemo(() => {
    if (!listings) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return listings;
    return listings.filter((l) =>
      [l.title, l.meetAddress, l.listingId].some((f) => (f ?? '').toLowerCase().includes(needle)),
    );
  }, [listings, q]);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Browse items</h1>

      <input
        className="input max-w-md"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search items or meet area…"
      />

      {listings === null ? (
        <div className="py-10 text-center text-zinc-500">Loading items…</div>
      ) : filtered.length === 0 ? (
        <InfoNote>
          {listings.length === 0
            ? 'No items listed yet — be the first to '
            : 'No items match your search. '}
          {listings.length === 0 && (
            <Link href="/sell" className="underline">
              sell something
            </Link>
          )}
        </InfoNote>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((l) => (
            <Link
              key={l.listingId}
              href={`/buy/${l.listingId}`}
              className="card overflow-hidden p-0 transition hover:border-white/20 hover:bg-zinc-900"
            >
              {l.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt={l.title ?? ''} className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-white/5 text-3xl">
                  📦
                </div>
              )}
              <div className="space-y-0.5 p-3">
                <div className="truncate text-sm font-semibold">{l.title || `Listing #${l.listingId}`}</div>
                <div className="font-bold text-indigo-300">{fmtUsd1e8(safeBig(l.priceUsd1e8))}</div>
                {l.meetAddress && <div className="truncate text-xs text-zinc-500">📍 {l.meetAddress}</div>}
                <div className="truncate text-[11px] text-zinc-600">by {shortAddr(l.seller)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <details className="card max-w-md">
        <summary className="cursor-pointer text-sm font-medium text-zinc-300">
          Have a listing link or number?
        </summary>
        <div className="mt-3 space-y-3">
          <label className="label" htmlFor="listing">
            Listing #
          </label>
          <div className="flex gap-2">
            <input
              id="listing"
              inputMode="numeric"
              className="input"
              value={id}
              onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
            />
            <button
              className="btn-secondary !w-auto px-4"
              disabled={id === ''}
              onClick={() => router.push(`/buy/${id}`)}
            >
              Open
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getActiveListings, CATEGORIES, CONDITIONS, type MarketListing } from '@/lib/backend';
import { fmtUsd1e8, shortAddr } from '@/lib/format';
import { InfoNote } from '@/components/Notice';

function safeBig(v: string | undefined): bigint {
  try {
    return BigInt(v ?? '0');
  } catch {
    return 0n;
  }
}
const dollars = (v?: string) => Number(safeBig(v)) / 1e8;

// Great-circle distance in miles between two lat/lng points.
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type Sort = 'new' | 'near' | 'low' | 'high';

export default function BuyIndexPage() {
  const router = useRouter();
  const [id, setId] = useState('');
  const [listings, setListings] = useState<MarketListing[] | null>(null);

  // filters
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cond, setCond] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [maxMi, setMaxMi] = useState('');
  const [pmin, setPmin] = useState('');
  const [pmax, setPmax] = useState('');
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    getActiveListings().then(setListings).catch(() => setListings([]));
  }, []);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocBusy(false);
        if (sort === 'new') setSort('near');
      },
      () => setLocBusy(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const distOf = (l: MarketListing): number | null =>
    loc && l.meetLat != null && l.meetLng != null
      ? milesBetween(loc, { lat: l.meetLat, lng: l.meetLng })
      : null;

  const filtered = useMemo(() => {
    if (!listings) return [];
    const needle = q.trim().toLowerCase();
    const min = pmin ? Number(pmin) : -Infinity;
    const max = pmax ? Number(pmax) : Infinity;
    const cap = maxMi ? Number(maxMi) : Infinity;
    const out = listings.filter((l) => {
      if (needle && ![l.title, l.meetAddress, l.listingId].some((f) => (f ?? '').toLowerCase().includes(needle)))
        return false;
      if (cat && l.category !== cat) return false;
      if (cond && l.condition !== cond) return false;
      const p = dollars(l.priceUsd1e8);
      if (p < min || p > max) return false;
      if (cap !== Infinity) {
        const d = distOf(l);
        if (d == null || d > cap) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sort === 'low') return dollars(a.priceUsd1e8) - dollars(b.priceUsd1e8);
      if (sort === 'high') return dollars(b.priceUsd1e8) - dollars(a.priceUsd1e8);
      if (sort === 'near') return (distOf(a) ?? Infinity) - (distOf(b) ?? Infinity);
      return Number(safeBig(b.listingId) - safeBig(a.listingId)); // newest
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, q, cat, cond, sort, maxMi, pmin, pmax, loc]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Browse items</h1>
        <button className="btn-secondary !w-auto px-3 py-1.5 text-sm" onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? 'Hide filters' : 'Filters'}
        </button>
      </div>

      {/* search + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-md flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search items or meet area…"
        />
        <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="new">Newest</option>
          <option value="near">Nearest</option>
          <option value="low">Price: low → high</option>
          <option value="high">Price: high → low</option>
        </select>
      </div>

      {/* category chips */}
      <div className="flex flex-wrap gap-2">
        <Chip active={cat === ''} onClick={() => setCat('')}>All</Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} active={cat === c} onClick={() => setCat(cat === c ? '' : c)}>
            {c}
          </Chip>
        ))}
      </div>

      {/* filter panel */}
      {showFilters && (
        <div className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label">Condition</span>
            <select className="input" value={cond} onChange={(e) => setCond(e.target.value)}>
              <option value="">Any</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Min $</span>
            <input className="input" inputMode="decimal" value={pmin} onChange={(e) => setPmin(e.target.value)} placeholder="0" />
          </label>
          <label className="block">
            <span className="label">Max $</span>
            <input className="input" inputMode="decimal" value={pmax} onChange={(e) => setPmax(e.target.value)} placeholder="∞" />
          </label>
          <div className="block">
            <span className="label">Within (mi)</span>
            <div className="flex gap-2">
              <input
                className="input"
                inputMode="numeric"
                value={maxMi}
                onChange={(e) => setMaxMi(e.target.value)}
                placeholder="any"
                disabled={!loc}
              />
              <button className="btn-secondary !w-auto px-3 text-sm" onClick={useMyLocation} disabled={locBusy}>
                {locBusy ? '…' : loc ? '📍✓' : '📍'}
              </button>
            </div>
            {!loc && <p className="mt-1 text-[10px] text-zinc-500">Tap 📍 to enable distance</p>}
          </div>
        </div>
      )}

      {listings === null ? (
        <div className="py-10 text-center text-zinc-500">Loading items…</div>
      ) : filtered.length === 0 ? (
        <InfoNote>
          {listings.length === 0 ? 'No items listed yet — be the first to ' : 'No items match your filters. '}
          {listings.length === 0 && (
            <Link href="/sell" className="underline">
              sell something
            </Link>
          )}
        </InfoNote>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((l) => {
            const d = distOf(l);
            return (
              <Link
                key={l.listingId}
                href={`/buy/${l.listingId}`}
                className="card overflow-hidden p-0 transition hover:border-white/20 hover:bg-zinc-900"
              >
                {l.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image} alt={l.title ?? ''} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-white/5 text-3xl">📦</div>
                )}
                <div className="space-y-0.5 p-3">
                  <div className="truncate text-sm font-semibold">{l.title || `Listing #${l.listingId}`}</div>
                  <div className="font-bold text-indigo-300">{fmtUsd1e8(safeBig(l.priceUsd1e8))}</div>
                  <div className="flex flex-wrap gap-1">
                    {l.category && <span className="pill bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300">{l.category}</span>}
                    {l.condition && <span className="pill bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300">{l.condition}</span>}
                  </div>
                  {d != null ? (
                    <div className="truncate text-[11px] text-zinc-500">📍 {d < 0.1 ? '<0.1' : d.toFixed(1)} mi away</div>
                  ) : (
                    l.meetAddress && <div className="truncate text-[11px] text-zinc-500">📍 {l.meetAddress}</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <details className="card max-w-md">
        <summary className="cursor-pointer text-sm font-medium text-zinc-300">Have a listing link or number?</summary>
        <div className="mt-3 space-y-3">
          <label className="label" htmlFor="listing">Listing #</label>
          <div className="flex gap-2">
            <input
              id="listing"
              inputMode="numeric"
              className="input"
              value={id}
              onChange={(e) => setId(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
            />
            <button className="btn-secondary !w-auto px-4" disabled={id === ''} onClick={() => router.push(`/buy/${id}`)}>
              Open
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-indigo-500 text-white' : 'border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </button>
  );
}

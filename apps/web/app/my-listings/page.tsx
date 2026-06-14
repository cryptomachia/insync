'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import {
  getMyListings,
  getListingMeta,
  saveListingMeta,
  type SellerListing,
  type ListingMeta,
} from '@/lib/backend';
import { shortAddr } from '@/lib/format';
import { ErrorNote, InfoNote, errMsg } from '@/components/Notice';

export default function MyListingsPage() {
  const { isConnected, address, login } = useAuth();
  const [listings, setListings] = useState<SellerListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      setListings(await getMyListings(address));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isConnected) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">My listings</h1>
        <InfoNote>Sign in to manage the items you&apos;re selling.</InfoNote>
        <button className="btn-primary" onClick={login}>
          Sign in
        </button>
      </div>
    );
  }

  const active = listings?.filter((l) => !l.archived) ?? [];
  const archived = listings?.filter((l) => l.archived) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">My listings</h1>
        <button className="btn-secondary !w-auto px-3 py-1.5 text-sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="text-xs text-zinc-500">as {shortAddr(address)}</p>

      {error && <ErrorNote>{error}</ErrorNote>}

      {listings && listings.length === 0 && !error && (
        <InfoNote>
          You haven&apos;t posted anything yet.{' '}
          <Link href="/sell" className="underline">
            List an item
          </Link>
          .
        </InfoNote>
      )}

      {active.length > 0 && (
        <div className="grid gap-3">
          {active.map((l) => (
            <ListingCard key={l.listingId} listing={l} onChanged={load} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Withdrawn</div>
          <div className="grid gap-3">
            {archived.map((l) => (
              <ListingCard key={l.listingId} listing={l} onChanged={load} />
            ))}
          </div>
        </div>
      )}

      <Link href="/sell" className="btn-primary">
        + Post a new listing
      </Link>
    </div>
  );
}

function ListingCard({ listing, onChanged }: { listing: SellerListing; onChanged: () => void }) {
  const id = listing.listingId;
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function copyLink() {
    const url = `${window.location.origin}/buy/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  async function toggleArchived(archived: boolean) {
    setBusy('archive');
    try {
      await saveListingMeta(id, { archived });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        {listing.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.image} alt={listing.title ?? ''} className="h-14 w-14 rounded-lg object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/5 text-xl">📦</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{listing.title || `Listing #${id}`}</div>
          <div className="truncate text-xs text-zinc-500">
            #{id}
            {listing.meetAddress ? ` · ${listing.meetAddress}` : ''}
          </div>
        </div>
        {listing.archived && <span className="pill bg-white/10 text-zinc-400">Withdrawn</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/buy/${id}`} className="btn-secondary !w-auto px-3 py-1.5 text-sm">
          Open
        </Link>
        <button className="btn-secondary !w-auto px-3 py-1.5 text-sm" onClick={copyLink}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        <button
          className="btn-secondary !w-auto px-3 py-1.5 text-sm"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Close' : 'Edit'}
        </button>
        {listing.archived ? (
          <button
            className="btn-secondary !w-auto px-3 py-1.5 text-sm"
            onClick={() => toggleArchived(false)}
            disabled={busy === 'archive'}
          >
            Relist
          </button>
        ) : (
          <button
            className="!w-auto rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/20"
            onClick={() => toggleArchived(true)}
            disabled={busy === 'archive'}
          >
            Withdraw
          </button>
        )}
      </div>

      {editing && (
        <EditForm
          listingId={id}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function EditForm({ listingId, onSaved }: { listingId: string; onSaved: () => void }) {
  const [meta, setMeta] = useState<ListingMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getListingMeta(listingId).then((m) => setMeta(m ?? {})).catch(() => setMeta({}));
  }, [listingId]);

  if (!meta) return <p className="text-sm text-zinc-500">Loading…</p>;

  const set = (patch: Partial<ListingMeta>) => setMeta((m) => ({ ...(m ?? {}), ...patch }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await saveListingMeta(listingId, {
        title: meta!.title ?? undefined,
        description: meta!.description ?? undefined,
        meetAddress: meta!.meetAddress ?? undefined,
        meetTime: meta!.meetTime ?? undefined,
        sellerPhone: meta!.sellerPhone ?? undefined,
        sellerEmail: meta!.sellerEmail ?? undefined,
        notes: meta!.notes ?? undefined,
      });
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-3">
      <Field label="Item name">
        <input className="input" value={meta.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea
          className="input min-h-[72px] resize-y"
          value={meta.description ?? ''}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <Field label="Where to meet">
        <input
          className="input"
          value={meta.meetAddress ?? ''}
          onChange={(e) => set({ meetAddress: e.target.value })}
        />
      </Field>
      <Field label="Proposed meeting time">
        <input className="input" value={meta.meetTime ?? ''} onChange={(e) => set({ meetTime: e.target.value })} />
      </Field>
      <Field label="Phone (shared with the buyer)">
        <input
          className="input"
          inputMode="tel"
          value={meta.sellerPhone ?? ''}
          onChange={(e) => set({ sellerPhone: e.target.value })}
        />
      </Field>
      <Field label="Email (shared with the buyer)">
        <input
          className="input"
          type="email"
          value={meta.sellerEmail ?? ''}
          onChange={(e) => set({ sellerEmail: e.target.value })}
        />
      </Field>
      <Field label="Notes for the buyer">
        <textarea
          className="input min-h-[60px] resize-y"
          value={meta.notes ?? ''}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </Field>
      {err && <ErrorNote>{err}</ErrorNote>}
      <button className="btn-primary" onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import { getSellerThreads, getBuyerThreads, type ThreadSummary } from '@/lib/backend';
import { shortAddr } from '@/lib/format';
import { InfoNote } from '@/components/Notice';
import Chat from '@/components/Chat';

type Selected = { listingId: string; buyer: string; role: 'buyer' | 'seller'; title: string | null };

function preview(t: ThreadSummary): string {
  if (t.lastKind === 'offer') return '💰 Offer';
  if (t.lastKind === 'accept') return '✅ Offer accepted';
  if (t.lastKind === 'decline') return 'Offer declined';
  return t.lastBody ?? '';
}

export default function MessagesPage() {
  const { isConnected, address, login } = useAuth();
  const [selling, setSelling] = useState<ThreadSummary[]>([]);
  const [buying, setBuying] = useState<ThreadSummary[]>([]);
  const [sel, setSel] = useState<Selected | null>(null);

  const load = useCallback(() => {
    if (!address) return;
    getSellerThreads(address).then(setSelling).catch(() => {});
    getBuyerThreads(address).then(setBuying).catch(() => {});
  }, [address]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-bold">Messages</h1>
        <InfoNote>Sign in to see your conversations.</InfoNote>
        <button className="btn-primary" onClick={login}>Sign in</button>
      </div>
    );
  }

  const Row = ({ t, role }: { t: ThreadSummary; role: 'buyer' | 'seller' }) => {
    const active = sel?.listingId === t.listingId && sel?.buyer.toLowerCase() === t.buyer.toLowerCase() && sel?.role === role;
    return (
      <button
        onClick={() => setSel({ listingId: t.listingId, buyer: t.buyer, role, title: t.title })}
        className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${
          active ? 'border-indigo-400 bg-indigo-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
        }`}
      >
        {t.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">📦</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{t.title || `Listing #${t.listingId}`}</div>
          <div className="truncate text-xs text-zinc-500">
            {role === 'seller' ? `from ${shortAddr(t.buyer)} · ` : ''}
            {preview(t)}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Messages</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* thread list */}
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Selling ({selling.length})</div>
            {selling.length === 0 ? (
              <div className="surface text-xs text-zinc-500">No buyer messages yet.</div>
            ) : (
              selling.map((t) => <Row key={`s-${t.listingId}-${t.buyer}`} t={t} role="seller" />)
            )}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Buying ({buying.length})</div>
            {buying.length === 0 ? (
              <div className="surface text-xs text-zinc-500">
                You haven&apos;t messaged any sellers. <Link href="/buy" className="text-indigo-300 underline">Browse items</Link>.
              </div>
            ) : (
              buying.map((t) => <Row key={`b-${t.listingId}`} t={t} role="buyer" />)
            )}
          </div>
        </div>

        {/* conversation */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          {sel ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-400">
                  {sel.title || `Listing #${sel.listingId}`} ·{' '}
                  <Link href={`/buy/${sel.listingId}`} className="text-indigo-300 underline">view</Link>
                </div>
              </div>
              <Chat key={`${sel.role}-${sel.listingId}-${sel.buyer}`} listingId={sel.listingId} buyer={sel.buyer} role={sel.role} />
            </div>
          ) : (
            <div className="card text-center text-sm text-zinc-500">Select a conversation to view it.</div>
          )}
        </div>
      </div>
    </div>
  );
}

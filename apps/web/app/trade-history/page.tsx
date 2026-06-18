'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import { DealState } from '@handoff/contracts-abi';
import { fetchMyDeals, type BackendDeal } from '@/lib/backend';
import { DEAL_STATE_LABEL } from '@/lib/escrow';
import { shortAddr } from '@/lib/format';
import { ErrorNote, InfoNote, errMsg } from '@/components/Notice';

// The escrow's USDC test token is 6-decimal; show the locked amount in dollars.
function fmtLocked(tokenAmount?: string): string {
  try {
    return `$${(Number(BigInt(tokenAmount ?? '0')) / 1e6).toFixed(2)}`;
  } catch {
    return '—';
  }
}

function fmtWhen(ms?: number): string {
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

function pillTone(state: number): string {
  return state === DealState.Completed
    ? 'bg-emerald-500/15 text-emerald-300'
    : state === DealState.Forfeited
    ? 'bg-rose-500/15 text-rose-300'
    : state === DealState.Refunded
    ? 'bg-white/10 text-zinc-300'
    : 'bg-indigo-500/15 text-indigo-300';
}

export default function TradeHistoryPage() {
  const { isConnected, address, login } = useAuth();
  const [deals, setDeals] = useState<BackendDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      setDeals(await fetchMyDeals(address));
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
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-bold">Trade history</h1>
        <InfoNote>Sign in to see your trade history.</InfoNote>
        <button className="btn-primary" onClick={login}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trade history</h1>
        <button className="btn-secondary !w-auto px-3 py-1.5 text-sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="text-xs text-zinc-500">as {shortAddr(address)}</p>

      {error && (
        <ErrorNote>
          {error}
          <div className="mt-1 text-xs">Make sure the backend indexer is running.</div>
        </ErrorNote>
      )}

      {deals && deals.length === 0 && !error && (
        <InfoNote>
          No trades yet.{' '}
          <Link href="/buy" className="underline">
            Browse items
          </Link>{' '}
          or{' '}
          <Link href="/sell" className="underline">
            list something
          </Link>
          .
        </InfoNote>
      )}

      <div className="grid gap-3">
        {deals?.map((d) => {
          const isBuyer = address && d.buyer?.toLowerCase() === address.toLowerCase();
          return (
            <Link
              key={d.dealId}
              href={`/deal/${d.dealId}`}
              className="card flex items-center justify-between transition hover:border-white/20 hover:bg-zinc-900"
            >
              <div>
                <div className="font-semibold">Deal #{d.dealId}</div>
                <div className="text-sm text-zinc-400">
                  {isBuyer ? 'Buying' : 'Selling'} · {fmtLocked(d.tokenAmount)}
                  {d.updatedAt ? ` · ${fmtWhen(d.updatedAt)}` : ''}
                </div>
              </div>
              <span className={`pill ${pillTone(d.state)}`}>
                {DEAL_STATE_LABEL[(d.state as DealState) ?? DealState.None] ?? `state ${d.state}`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

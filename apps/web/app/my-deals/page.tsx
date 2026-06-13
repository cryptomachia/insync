'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import { DealState } from '@handoff/contracts-abi';
import { fetchMyDeals, type BackendDeal } from '@/lib/backend';
import { DEAL_STATE_LABEL } from '@/lib/escrow';
import { fmtUsd1e8, shortAddr } from '@/lib/format';
import { ErrorNote, InfoNote, errMsg } from '@/components/Notice';

export default function MyDealsPage() {
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
      <div className="space-y-4">
        <h1 className="text-xl font-bold">My deals</h1>
        <InfoNote>Log in to see your deals.</InfoNote>
        <button className="btn-primary" onClick={login}>
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">My deals</h1>
        <button
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
          onClick={load}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="text-xs text-slate-400">as {shortAddr(address)}</p>

      {error && (
        <ErrorNote>
          {error}
          <div className="mt-1 text-xs">
            Make sure the backend indexer is running (NEXT_PUBLIC_BACKEND_URL).
          </div>
        </ErrorNote>
      )}

      {deals && deals.length === 0 && !error && (
        <InfoNote>
          No deals yet.{' '}
          <Link href="/sell" className="underline">
            List something
          </Link>{' '}
          or{' '}
          <Link href="/buy" className="underline">
            open a listing
          </Link>
          .
        </InfoNote>
      )}

      <div className="grid gap-3">
        {deals?.map((d) => {
          const isBuyer =
            address && d.buyer?.toLowerCase() === address.toLowerCase();
          return (
            <Link
              key={d.dealId}
              href={`/deal/${d.dealId}`}
              className="card flex items-center justify-between hover:bg-slate-50"
            >
              <div>
                <div className="font-semibold">Deal #{d.dealId}</div>
                <div className="text-sm text-slate-500">
                  {isBuyer ? 'Buying' : 'Selling'} ·{' '}
                  {fmtUsd1e8(safeBig(d.priceUsd1e8))}
                </div>
              </div>
              <span className="pill bg-slate-100 text-slate-600">
                {DEAL_STATE_LABEL[(d.state as DealState) ?? DealState.None] ??
                  `state ${d.state}`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function safeBig(v: string | undefined): bigint {
  try {
    return BigInt(v ?? '0');
  } catch {
    return 0n;
  }
}

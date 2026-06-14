'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { readDeal, type Deal, DEAL_STATE_LABEL, isTerminal } from '@/lib/escrow';
import {
  getDealEvents,
  getCoordination,
  getListingMeta,
  type DealEvent,
  type Coordination,
  type ListingMeta,
} from '@/lib/backend';
import { fmtUsd1e8, depositUsd1e8, totalUsd1e8, shortAddr } from '@/lib/format';
import { ErrorNote, errMsg } from '@/components/Notice';

const EXPLORER = 'https://sepolia.basescan.org';

function fmtTime(ms?: number) {
  return ms
    ? new Date(ms).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
}

function txOf(events: DealEvent[], name: string): string | null {
  const e = events.find((x) => x.event === name);
  if (!e?.payload) return null;
  try {
    return (JSON.parse(e.payload) as { txHash?: string }).txHash ?? null;
  } catch {
    return null;
  }
}

export default function ReceiptPage({ params }: { params: { dealId: string } }) {
  const { dealId } = params;
  const id = useMemo(() => {
    try {
      return BigInt(dealId);
    } catch {
      return null;
    }
  }, [dealId]);

  const [deal, setDeal] = useState<Deal | null>(null);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [coord, setCoord] = useState<Coordination | null>(null);
  const [meta, setMeta] = useState<ListingMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return setErr('Invalid deal id.');
    let alive = true;
    (async () => {
      const d = await readDeal(id);
      if (!alive) return;
      setDeal(d);
      const [ev, c] = await Promise.all([getDealEvents(id), getCoordination(id)]);
      if (!alive) return;
      setEvents(ev);
      setCoord(c);
      if (c.listingId) {
        const m = await getListingMeta(c.listingId);
        if (alive) setMeta(m);
      }
    })().catch((e) => alive && setErr(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  if (err) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Receipt</h1>
        <ErrorNote>{err}</ErrorNote>
        <Link href="/trade-history" className="btn-secondary">
          Back to trade history
        </Link>
      </div>
    );
  }
  if (!deal) return <div className="py-10 text-center text-zinc-500">Loading receipt…</div>;

  const deposit = depositUsd1e8(deal.priceUsd1e8, deal.depositBps);
  const total = totalUsd1e8(deal.priceUsd1e8, deal.depositBps);
  const terminalName =
    DEAL_STATE_LABEL[deal.state] === 'Completed'
      ? 'Completed'
      : DEAL_STATE_LABEL[deal.state] === 'Refunded'
      ? 'Refunded'
      : DEAL_STATE_LABEL[deal.state] === 'Forfeited'
      ? 'Forfeited'
      : null;
  const settledAt = terminalName
    ? events.find((e) => e.event === terminalName)?.createdAt
    : undefined;

  const sellerPhone = coord?.seller?.phone ?? meta?.sellerPhone;
  const sellerEmail = coord?.seller?.email ?? meta?.sellerEmail;
  const buyerPhone = coord?.buyer?.phone;
  const buyerEmail = coord?.buyer?.email;

  const proofs: Array<[string, string]> = [
    ['Payment locked', 'Funded'],
    ['Seller checked in', 'CheckedIn'],
    [terminalName === 'Completed' ? 'Released' : terminalName ?? 'Settled', terminalName ?? ''],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Receipt</h1>
        <button className="btn-secondary !w-auto px-3 py-1.5 text-sm print:hidden" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <div className="font-bold">inSync</div>
            <div className="text-xs text-zinc-500">in-person escrow · Base</div>
          </div>
          <span
            className={`pill ${
              isTerminal(deal.state) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-indigo-500/15 text-indigo-300'
            }`}
          >
            {DEAL_STATE_LABEL[deal.state]}
          </span>
        </div>

        {meta?.title && <div className="text-lg font-semibold">{meta.title}</div>}

        <div className="space-y-1 text-sm">
          <Row k="Deal" v={`#${dealId}`} />
          {coord?.listingId && <Row k="Listing" v={`#${coord.listingId}`} />}
          {settledAt && <Row k="Settled" v={fmtTime(settledAt)} />}
          <Row k="Item price" v={fmtUsd1e8(deal.priceUsd1e8)} />
          <Row k="Refundable deposit" v={fmtUsd1e8(deposit)} />
          <Row k="Total locked" v={fmtUsd1e8(total)} bold />
        </div>

        <div className="space-y-1 border-t border-white/10 pt-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Parties</div>
          <PartyRow role="Seller" address={deal.seller} phone={sellerPhone} email={sellerEmail} />
          <PartyRow role="Buyer" address={deal.buyer} phone={buyerPhone} email={buyerEmail} />
        </div>

        <div className="space-y-2 border-t border-white/10 pt-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">On-chain proof</div>
          {proofs.map(([label, name]) => {
            const tx = name ? txOf(events, name) : null;
            if (!tx) return null;
            return (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className="text-zinc-300">{label}</span>
                <a
                  className="font-mono text-xs text-indigo-300 underline"
                  href={`${EXPLORER}/tx/${tx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tx.slice(0, 10)}…
                </a>
              </div>
            );
          })}
          {events.length === 0 && <div className="text-xs text-zinc-500">No on-chain events recorded.</div>}
        </div>
      </div>

      <Link href={`/deal/${dealId}`} className="btn-secondary print:hidden">
        Back to deal
      </Link>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${bold ? 'font-semibold text-zinc-100' : ''}`}>
      <span className="text-zinc-400">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function PartyRow({
  role,
  address,
  phone,
  email,
}: {
  role: string;
  address: string;
  phone?: string | null;
  email?: string | null;
}) {
  return (
    <div className="py-1">
      <div className="flex justify-between gap-3">
        <span className="text-zinc-400">{role}</span>
        <a
          className="font-mono text-xs text-indigo-300 underline"
          href={`${EXPLORER}/address/${address}`}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddr(address)}
        </a>
      </div>
      {(phone || email) && (
        <div className="text-right text-xs text-zinc-500">{[phone, email].filter(Boolean).join(' · ')}</div>
      )}
    </div>
  );
}

'use client';

// Redesign components — the chosen looks from /designs, wired into the real app:
//   #3 wallet + #10 kanban  → <MyDealsDashboard/>   (home)
//   #8 vault                → <VaultLock/>           (buy: wraps the fund CTA)
//   #4 progress tracker     → <TrackerStepper/>      (deal page)
//   #2 chat-first           → <ChatTimeline/>        (deal page)
//   #1 boarding pass        → <BoardingPassQR/>      (deal page, seller)
//   #9 tap to release       → <ReleaseTap/>          (deal page, buyer)
// (#5 map already lives in MeetupCard.) Presentational only — all chain calls stay in the pages.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import { DealState } from '@handoff/contracts-abi';
import { fetchMyDeals, getDealEvents, type BackendDeal, type DealEvent } from '@/lib/backend';
import type { Deal } from '@/lib/escrow';

// USDC (6dp) base units → "$88.00".
function fmtUsdc(units?: string | bigint): string {
  if (units == null) return '$0.00';
  const n = Number(units) / 1e6;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

const ACTIVE = new Set([DealState.Funded, DealState.SellerCheckedIn]);

// ── #3 Wallet header + #10 Deals kanban (home) ─────────────────────────────────────────────
export function MyDealsDashboard() {
  const { isConnected, address } = useAuth();
  const [deals, setDeals] = useState<BackendDeal[] | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = () =>
      fetchMyDeals(address)
        .then((d) => alive && setDeals(d))
        .catch(() => alive && setDeals([]));
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address]);

  if (!isConnected) return null;

  const list = deals ?? [];
  const locked = list
    .filter((d) => ACTIVE.has(d.state as DealState))
    .reduce((sum, d) => sum + Number(d.tokenAmount ?? 0) / 1e6, 0);
  const lockedStr = locked.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const cols: Array<{ key: string; label: string; tone: string; match: (s: number) => boolean }> = [
    { key: 'locked', label: 'Locked', tone: 'text-indigo-300', match: (s) => s === DealState.Funded },
    { key: 'meet', label: 'At the meet', tone: 'text-amber-300', match: (s) => s === DealState.SellerCheckedIn },
    {
      key: 'done',
      label: 'Done',
      tone: 'text-emerald-300',
      match: (s) =>
        s === DealState.Completed || s === DealState.Refunded || s === DealState.Forfeited,
    },
  ];

  return (
    <section className="card space-y-4">
      {/* wallet header (#3) */}
      <div>
        <div className="text-xs text-zinc-400">In escrow right now</div>
        <div className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-zinc-100">
          {lockedStr} <span className="text-xl">🔒</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-full bg-gradient-to-r from-emerald-400 to-indigo-400" />
        </div>
        <div className="mt-1 text-[11px] text-emerald-300">Locked &amp; safe across your active deals</div>
      </div>

      {/* kanban (#10) */}
      {deals === null ? (
        <div className="text-sm text-zinc-500">Loading your deals…</div>
      ) : list.length === 0 ? (
        <div className="surface text-sm text-zinc-400">
          No deals yet — buy or sell something and it shows up here.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {cols.map((c) => {
            const items = list.filter((d) => c.match(d.state));
            return (
              <div key={c.key} className="space-y-2">
                <div className={`text-[10px] font-semibold uppercase tracking-wide ${c.tone}`}>
                  {c.label}
                </div>
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 p-2 text-center text-[10px] text-zinc-600">
                    —
                  </div>
                ) : (
                  items.map((d) => <DealChip key={d.dealId} deal={d} accent={c.tone} />)
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DealChip({ deal, accent }: { deal: BackendDeal; accent: string }) {
  const role = ''; // (role shown on the deal page; chip keeps it compact)
  return (
    <Link
      href={`/deal/${deal.dealId}`}
      className="block rounded-lg border border-white/10 bg-white/[0.04] p-2 transition hover:border-white/20"
    >
      <div className="text-[11px] font-semibold text-zinc-200">Deal #{deal.dealId}</div>
      <div className={`text-[11px] ${accent}`}>{fmtUsdc(deal.tokenAmount)}{role}</div>
    </Link>
  );
}

// ── #8 Vault seal (buy: wraps the fund CTA) ────────────────────────────────────────────────
export function VaultLock({
  amountLabel,
  policyNote,
  children,
}: {
  amountLabel: string;
  policyNote?: React.ReactNode;
  children: React.ReactNode; // the FundButton
}) {
  return (
    <div className="card space-y-4">
      <div className="flex flex-col items-center">
        <div className="relative flex h-28 w-28 items-center justify-center rounded-3xl border-4 border-zinc-700 bg-gradient-to-br from-zinc-800 to-zinc-900 shadow-inner">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-zinc-600 bg-zinc-950 text-2xl">
            🔓
          </div>
          <div className="absolute right-2 top-1/2 h-5 w-1.5 -translate-y-1/2 rounded bg-zinc-600" />
        </div>
        <div className="mt-3 text-center">
          <div className="text-lg font-bold text-zinc-100">{amountLabel}</div>
          <div className="text-xs text-zinc-400">Sealed in escrow — opens only at the handoff</div>
        </div>
      </div>
      {/* the real fund button is rendered here */}
      <div className="[&>button]:btn-primary">{children}</div>
      {policyNote && <div className="text-center text-xs text-zinc-500">{policyNote}</div>}
    </div>
  );
}

// ── #4 Progress tracker (deal page) ────────────────────────────────────────────────────────
export function TrackerStepper({ deal }: { deal: Deal }) {
  const terminal =
    deal.state === DealState.Completed ||
    deal.state === DealState.Refunded ||
    deal.state === DealState.Forfeited;
  const checkedIn = deal.sellerCheckedIn || deal.state === DealState.SellerCheckedIn;

  const lastLabel =
    deal.state === DealState.Completed
      ? 'Released'
      : deal.state === DealState.Refunded
        ? 'Refunded'
        : deal.state === DealState.Forfeited
          ? 'Forfeited'
          : 'Done';

  const steps: Array<{ label: string; s: 'done' | 'active' | 'todo' }> = [
    { label: 'Lock', s: 'done' },
    { label: 'Meet', s: checkedIn ? 'done' : terminal ? 'done' : 'active' },
    { label: 'Scan', s: terminal ? 'done' : checkedIn ? 'active' : 'todo' },
    { label: lastLabel, s: terminal ? 'done' : 'todo' },
  ];

  const dot = (s: string) =>
    s === 'done'
      ? 'bg-emerald-500 text-white'
      : s === 'active'
        ? 'bg-indigo-500 text-white ring-4 ring-indigo-500/25'
        : 'bg-white/10 text-zinc-500';

  return (
    <div className="card">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Progress</div>
      <div className="flex items-center">
        {steps.map((st, i) => (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${dot(st.s)}`}>
                {st.s === 'done' ? '✓' : i + 1}
              </div>
              <span className={`text-[10px] ${st.s === 'todo' ? 'text-zinc-500' : 'text-zinc-300'}`}>
                {st.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-1 mb-4 h-0.5 flex-1 ${st.s === 'done' ? 'bg-emerald-500' : 'bg-white/10'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── #1 Boarding pass (deal page, seller — wraps ReleaseQR) ──────────────────────────────────
export function BoardingPassQR({
  deal,
  children,
}: {
  deal: Deal;
  children: React.ReactNode; // the ReleaseQR
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/70 shadow-xl shadow-black/30">
      <div className="bg-gradient-to-br from-indigo-500 to-violet-600 p-4 text-white">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest opacity-80">
          <span>inSync Pass</span>
          <span>Deal #{deal.dealId.toString()}</span>
        </div>
        <div className="mt-1 text-base font-bold">Release ticket</div>
        <div className="text-xs opacity-90">Show this to the buyer to settle the deal</div>
      </div>
      <div className="flex items-center gap-2 px-2">
        <div className="h-3 w-3 -translate-x-1 rounded-full bg-zinc-950" />
        <div className="flex-1 border-t border-dashed border-white/20" />
        <div className="h-3 w-3 translate-x-1 rounded-full bg-zinc-950" />
      </div>
      {/* the real ReleaseQR (renders its own white QR canvas) */}
      <div className="flex justify-center p-3">
        <div className="rounded-xl bg-white p-1">{children}</div>
      </div>
    </div>
  );
}

// ── #9 Tap to release (deal page, buyer — fires the real confirmReceipt) ────────────────────
export function ReleaseTap({
  onConfirm,
  busy,
  disabled,
}: {
  onConfirm: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled || busy}
        aria-busy={busy}
        className="relative flex h-40 w-40 items-center justify-center disabled:opacity-60"
      >
        <span className={`absolute h-40 w-40 rounded-full border border-indigo-500/20 ${busy ? 'animate-ping' : 'animate-pulse'}`} />
        <span className="absolute h-28 w-28 rounded-full border border-indigo-500/40" />
        <span className="absolute flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/40">
          <span className="text-center text-xs font-semibold leading-tight">
            {busy ? 'Releasing…' : 'Tap to\nrelease'}
          </span>
        </span>
      </button>
      <div className="text-center text-xs text-zinc-500">
        {busy ? 'Settling on-chain…' : 'Confirms receipt and pays the seller — final, no chargebacks.'}
      </div>
    </div>
  );
}

// ── #2 Chat-first timeline (deal page) ──────────────────────────────────────────────────────
const EVENT_COPY: Record<string, { who: 'buyer' | 'seller' | 'system'; text: string }> = {
  Funded: { who: 'buyer', text: 'Locked the payment in escrow 🔒' },
  CheckedIn: { who: 'seller', text: 'Checked in at the meet 📍' },
  Completed: { who: 'system', text: 'Released — seller paid, deposit returned ✅' },
  Refunded: { who: 'system', text: 'Refunded — buyer made whole' },
  Forfeited: { who: 'system', text: 'Deposit forfeited to the seller' },
};

function fmtTime(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ChatTimeline({ deal }: { deal: Deal }) {
  const [events, setEvents] = useState<DealEvent[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getDealEvents(deal.dealId)
        .then((e) => alive && setEvents(e))
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [deal.dealId]);

  if (events.length === 0) return null;

  return (
    <div className="card space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Activity</div>
      <div className="space-y-2 text-[13px]">
        {events.map((e, i) => {
          const c = EVENT_COPY[e.event] ?? { who: 'system' as const, text: e.event };
          if (c.who === 'system') {
            return (
              <div key={i} className="text-center">
                <span className="inline-block rounded-full bg-white/5 px-3 py-1 text-[11px] text-zinc-400">
                  {c.text} · {fmtTime(e.createdAt)}
                </span>
              </div>
            );
          }
          const right = c.who === 'buyer';
          return (
            <div key={i} className={right ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[82%]">
                <div
                  className={`rounded-2xl px-3 py-2 ${
                    right ? 'bg-indigo-500 text-white' : 'bg-white/[0.06] text-zinc-200'
                  }`}
                >
                  {c.text}
                </div>
                <div className={`mt-0.5 text-[10px] text-zinc-500 ${right ? 'text-right' : ''}`}>
                  {c.who === 'buyer' ? 'Buyer' : 'Seller'} · {fmtTime(e.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

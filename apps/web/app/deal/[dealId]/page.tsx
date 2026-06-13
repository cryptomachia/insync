'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useWalletClient } from '@handoff/auth';
import { ReleaseQR, ScanToRelease } from '@handoff/qr';
import { DealState } from '@handoff/contracts-abi';
import {
  readDeal,
  type Deal,
  DEAL_STATE_LABEL,
  isTerminal,
} from '@/lib/escrow';
import {
  checkIn,
  confirmReceipt,
  agreeCancel,
  buyerCancel,
} from '@/lib/tx';
import {
  fmtUsd1e8,
  depositUsd1e8,
  shortAddr,
  isStableToken,
} from '@/lib/format';
import {
  buyerCancelOutcome,
  agreeCancelOutcome,
  completionOutcome,
  inFreeWindow,
  canBuyerCancel,
  canAgreeCancel,
} from '@/lib/cancellation';
import { ErrorNote, InfoNote, SuccessNote, errMsg } from '@/components/Notice';

type Role = 'buyer' | 'seller' | 'observer';

export default function DealPage({
  params,
}: {
  params: { dealId: string };
}) {
  const { dealId } = params;
  const id = useMemo(() => {
    try {
      return BigInt(dealId);
    } catch {
      return null;
    }
  }, [dealId]);

  const { address } = useAuth();
  const walletClient = useWalletClient();

  const [deal, setDeal] = useState<Deal | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (id === null) {
      setLoadErr('Invalid deal id.');
      return;
    }
    try {
      setDeal(await readDeal(id));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errMsg(e));
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000); // keep both phones in sync at the meet
    return () => clearInterval(t);
  }, [refresh]);

  if (loadErr) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Deal #{dealId}</h1>
        <ErrorNote>{loadErr}</ErrorNote>
      </div>
    );
  }
  if (!deal) {
    return <div className="py-10 text-center text-slate-500">Loading deal…</div>;
  }

  const me = address?.toLowerCase();
  const isBuyer = !!me && me === deal.buyer.toLowerCase();
  const isSeller = !!me && me === deal.seller.toLowerCase();
  const role: Role = isBuyer ? 'buyer' : isSeller ? 'seller' : 'observer';
  // In mock/demo the same wallet can be both parties (self-deal); show both action sets.
  const roleLabel =
    isBuyer && isSeller ? 'buyer & seller (you)' : role === 'observer' ? 'viewer' : role;

  const stable = isStableToken(deal.payToken);
  const deposit = depositUsd1e8(deal.priceUsd1e8, deal.depositBps);

  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setActionErr(null);
    setBusy(name);
    try {
      await fn();
      setFlash(ok);
      await refresh();
    } catch (e) {
      setActionErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Deal #{dealId}</h1>
        <StatePill state={deal.state} />
      </div>

      <div className="card space-y-1 text-sm">
        <KV k="Your role" v={roleLabel} />
        <KV k="Buyer" v={shortAddr(deal.buyer)} mono />
        <KV k="Seller" v={shortAddr(deal.seller)} mono />
        <KV k="Item price" v={fmtUsd1e8(deal.priceUsd1e8)} />
        <KV k="Deposit" v={fmtUsd1e8(deposit)} />
        <KV
          k="Seller checked in"
          v={deal.sellerCheckedIn ? 'yes ✓' : 'not yet'}
        />
        <KV
          k="Free-cancel window"
          v={inFreeWindow(deal) ? 'open' : 'closed'}
        />
        {!stable && <KV k="Pay token" v="volatile (Data Streams priced)" />}
      </div>

      {flash && <SuccessNote>{flash}</SuccessNote>}
      {actionErr && <ErrorNote>{actionErr}</ErrorNote>}

      {isTerminal(deal.state) ? (
        <TerminalCard deal={deal} />
      ) : isSeller || isBuyer ? (
        <>
          {isSeller && (
            <SellerActions
              deal={deal}
              busy={busy}
              onCheckIn={() =>
                run('checkIn', () => checkIn(walletClient!, deal.dealId), 'Checked in. Show the QR to the buyer.')
              }
              onAgreeCancel={() =>
                run('agreeCancel', () => agreeCancel(walletClient!, deal.dealId), 'Cancel agreed — buyer fully refunded.')
              }
              disabled={!walletClient}
            />
          )}
          {isBuyer && (
            <BuyerActions
              deal={deal}
              busy={busy}
              stable={stable}
              onConfirm={() =>
                run(
                  'confirm',
                  () => confirmReceipt(walletClient!, deal.dealId, deal.payToken),
                  'Released! Seller paid, deposit returned to you.',
                )
              }
              onBuyerCancel={() =>
                run(
                  'buyerCancel',
                  () => buyerCancel(walletClient!, deal.dealId, deal.payToken),
                  'Cancelled.',
                )
              }
              disabled={!walletClient}
            />
          )}
        </>
      ) : (
        <InfoNote>
          You are viewing this deal. Connect as the buyer or seller to act.
        </InfoNote>
      )}
    </div>
  );
}

/* ----------------------------- Seller view ----------------------------- */

function SellerActions({
  deal,
  busy,
  onCheckIn,
  onAgreeCancel,
  disabled,
}: {
  deal: Deal;
  busy: string | null;
  onCheckIn: () => void;
  onAgreeCancel: () => void;
  disabled: boolean;
}) {
  const checkedIn = deal.sellerCheckedIn || deal.state === DealState.SellerCheckedIn;
  const cancel = agreeCancelOutcome(deal);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="font-semibold">At the meet</div>
        {!checkedIn ? (
          <>
            <p className="text-sm text-slate-600">
              Check in when you arrive. This proves you showed up and protects your
              deposit if the buyer flakes.
            </p>
            <button
              className="btn-primary"
              disabled={disabled || busy === 'checkIn'}
              onClick={onCheckIn}
            >
              {busy === 'checkIn' ? 'Checking in…' : 'Check in'}
            </button>
          </>
        ) : (
          <>
            <SuccessNote>
              You&apos;re checked in. Show this one-time QR to the buyer to release
              payment.
            </SuccessNote>
            {/* Seller-side QR from @handoff/qr (paste fallback in stub). */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <ReleaseQR dealId={deal.dealId} />
            </div>
          </>
        )}
      </div>

      {canAgreeCancel(deal.state) && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">
            Cancel this deal
          </summary>
          <p className="mt-2 text-sm text-slate-600">{cancel.summary}</p>
          <button
            className="btn-danger mt-3"
            disabled={disabled || busy === 'agreeCancel'}
            onClick={onAgreeCancel}
          >
            {busy === 'agreeCancel' ? 'Cancelling…' : 'Agree to cancel (full refund)'}
          </button>
        </details>
      )}
    </div>
  );
}

/* ----------------------------- Buyer view ------------------------------ */

function BuyerActions({
  deal,
  busy,
  stable,
  onConfirm,
  onBuyerCancel,
  disabled,
}: {
  deal: Deal;
  busy: string | null;
  stable: boolean;
  onConfirm: () => void;
  onBuyerCancel: () => void;
  disabled: boolean;
}) {
  const [scanned, setScanned] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const release = completionOutcome(deal);
  const cancel = buyerCancelOutcome(deal);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="font-semibold">Release payment</div>
        <p className="text-sm text-slate-600">{release.summary}</p>
        {!stable && (
          <InfoNote>
            We&apos;ll fetch a Chainlink Data Streams report so the seller receives
            exactly {fmtUsd1e8(deal.priceUsd1e8)}-worth; surplus comes back to you.
          </InfoNote>
        )}

        {!scanned ? (
          <>
            <p className="text-sm text-slate-500">
              Scan the seller&apos;s QR (or paste their code) to unlock the release
              button.
            </p>
            {/* Buyer-side scanner from @handoff/qr; we verify the dealId matches. */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <ScanToRelease
                onScan={(p) => {
                  if (p.dealId === deal.dealId) {
                    setScanned(true);
                    setScanErr(null);
                  } else {
                    setScanErr(
                      `That QR is for deal #${p.dealId.toString()}, not this one.`,
                    );
                  }
                }}
                onError={(e) => setScanErr(errMsg(e))}
              />
            </div>
            {scanErr && <ErrorNote>{scanErr}</ErrorNote>}
          </>
        ) : (
          <button
            className="btn-primary"
            disabled={disabled || busy === 'confirm'}
            onClick={onConfirm}
          >
            {busy === 'confirm' ? 'Releasing…' : 'Confirm receipt & release'}
          </button>
        )}
      </div>

      {canBuyerCancel(deal.state) && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">
            Cancel instead
          </summary>
          <p className="mt-2 text-sm text-slate-600">{cancel.summary}</p>
          <button
            className="btn-danger mt-3"
            disabled={disabled || busy === 'buyerCancel'}
            onClick={onBuyerCancel}
          >
            {busy === 'buyerCancel' ? 'Cancelling…' : 'Cancel my purchase'}
          </button>
        </details>
      )}
    </div>
  );
}

/* ----------------------------- Terminal -------------------------------- */

function TerminalCard({ deal }: { deal: Deal }) {
  const map: Record<number, { title: string; tone: 'ok' | 'info' }> = {
    [DealState.Completed]: { title: 'Completed — seller paid, deposit returned.', tone: 'ok' },
    [DealState.Refunded]: { title: 'Refunded — buyer got everything back.', tone: 'info' },
    [DealState.Forfeited]: { title: 'Deposit forfeited to the seller.', tone: 'info' },
  };
  const m = map[deal.state] ?? { title: DEAL_STATE_LABEL[deal.state], tone: 'info' as const };
  return m.tone === 'ok' ? (
    <SuccessNote>{m.title}</SuccessNote>
  ) : (
    <InfoNote>{m.title}</InfoNote>
  );
}

/* ------------------------------ bits ----------------------------------- */

function StatePill({ state }: { state: DealState }) {
  const tone =
    state === DealState.Completed
      ? 'bg-emerald-100 text-emerald-700'
      : state === DealState.Forfeited
      ? 'bg-rose-100 text-rose-700'
      : state === DealState.Refunded
      ? 'bg-slate-200 text-slate-700'
      : 'bg-indigo-100 text-indigo-700';
  return <span className={`pill ${tone}`}>{DEAL_STATE_LABEL[state]}</span>;
}

function KV({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{v}</span>
    </div>
  );
}

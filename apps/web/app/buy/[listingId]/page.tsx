'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useWalletClient } from '@handoff/auth';
import { FundButton } from '@handoff/funding';
import { getTokenPriceUsd1e8 } from '@handoff/datastreams';
import { readListing, type Listing } from '@/lib/escrow';
import { getListingMeta, type ListingMeta } from '@/lib/backend';
import {
  fmtUsd1e8,
  depositUsd1e8,
  totalUsd1e8,
  usd1e8ToUsdc,
  isStableToken,
  shortAddr,
} from '@/lib/format';
import { policyText } from '@/lib/cancellation';
import { ErrorNote, InfoNote, SuccessNote, errMsg } from '@/components/Notice';

const FREE_CANCEL_WINDOW = 60 * 60; // 1h free-cancel window
const EXPIRY_WINDOW = 24 * 60 * 60; // 24h until the keeper can reclaim
const VOLATILE_BUFFER_BPS = 2000; // +20% buffer for volatile tokens

export default function BuyListingPage({ params }: { params: { listingId: string } }) {
  const { listingId } = params;
  const id = useMemo(() => {
    try {
      return BigInt(listingId);
    } catch {
      return null;
    }
  }, [listingId]);

  const { isConnected, login, address } = useAuth();
  const walletClient = useWalletClient();

  const [listing, setListing] = useState<Listing | null>(null);
  const [meta, setMeta] = useState<ListingMeta | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tokenAmount, setTokenAmount] = useState<bigint | null>(null);
  const [fundErr, setFundErr] = useState<string | null>(null);
  const [dealId, setDealId] = useState<bigint | null>(null);

  useEffect(() => {
    if (id === null) return setLoadErr('Invalid listing link.');
    let alive = true;
    readListing(id).then((l) => alive && setListing(l)).catch((e) => alive && setLoadErr(errMsg(e)));
    getListingMeta(id).then((m) => alive && setMeta(m)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!listing) return;
    let alive = true;
    (async () => {
      const total = totalUsd1e8(listing.priceUsd1e8, listing.depositBps);
      if (isStableToken(listing.payToken)) {
        if (alive) setTokenAmount(usd1e8ToUsdc(total));
        return;
      }
      const feed = process.env.NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD ?? 'ETH/USD';
      const priceUsd1e8 = await getTokenPriceUsd1e8(feed);
      const buffered = (total * BigInt(10_000 + VOLATILE_BUFFER_BPS)) / 10_000n;
      if (alive) setTokenAmount((buffered * 10n ** 18n) / priceUsd1e8);
    })().catch((e) => alive && setFundErr(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [listing]);

  if (loadErr) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Listing</h1>
        <ErrorNote>{loadErr}</ErrorNote>
        <Link href="/buy" className="btn-secondary">Back</Link>
      </div>
    );
  }
  if (!listing) {
    return <div className="py-10 text-center text-zinc-500">Loading listing…</div>;
  }

  const deposit = depositUsd1e8(listing.priceUsd1e8, listing.depositBps);
  const total = totalUsd1e8(listing.priceUsd1e8, listing.depositBps);
  const stable = isStableToken(listing.payToken);
  const title = meta?.title || `Listing #${listingId}`;

  // Funded — "safe to meet" confirmation the seller can verify.
  if (dealId !== null) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold">You&apos;re in 🔒</h1>
        <SuccessNote>
          <div className="space-y-1">
            <div className="text-base font-bold">Payment locked — safe to meet</div>
            <div>
              Your {fmtUsd1e8(total)} is held on-chain for deal #{dealId.toString()}. The seller
              can see it&apos;s real before traveling. Pay only releases when you confirm in person.
            </div>
          </div>
        </SuccessNote>
        <Link href={`/deal/${dealId.toString()}`} className="btn-primary">Go to the deal</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {meta?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meta.image} alt={title} className="aspect-video w-full rounded-2xl object-cover" />
      )}

      <div className="space-y-1">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-indigo-300">{fmtUsd1e8(listing.priceUsd1e8)}</span>
          <span className="pill bg-white/10 text-zinc-300">{stable ? 'USDC' : 'volatile token'}</span>
        </div>
        <div className="text-sm text-zinc-500">Sold by {shortAddr(listing.seller)}</div>
      </div>

      {meta?.description && (
        <p className="whitespace-pre-wrap text-sm text-zinc-300">{meta.description}</p>
      )}

      {!listing.active && <ErrorNote>This listing is no longer available.</ErrorNote>}

      <div className="card space-y-3">
        <div className="font-semibold">What you&apos;ll pay</div>
        <div className="surface space-y-1 text-sm">
          <Row k="Item price (refundable until you confirm)" v={fmtUsd1e8(listing.priceUsd1e8)} />
          <Row k="Refundable deposit" v={fmtUsd1e8(deposit)} />
          <Row
            k={stable ? 'You lock now' : 'You lock now (incl. price buffer)'}
            v={tokenAmount === null ? '…' : stable ? `${fmtUsd1e8(total)} USDC` : `~${fmtUsd1e8(total)}`}
            bold
          />
        </div>
        <p className="text-xs text-zinc-400">{policyText(listing.priceUsd1e8, listing.depositBps)}</p>
        {!stable && (
          <InfoNote>
            You&apos;re paying with a price-variable token; at release it&apos;s priced live so the
            seller gets exactly {fmtUsd1e8(listing.priceUsd1e8)} and any extra comes back to you.
          </InfoNote>
        )}
      </div>

      {fundErr && <ErrorNote>{fundErr}</ErrorNote>}

      {!isConnected ? (
        <button className="btn-primary" onClick={login}>Sign in to buy</button>
      ) : !walletClient || tokenAmount === null ? (
        <button className="btn-primary" disabled>Preparing…</button>
      ) : (
        <div className="space-y-1">
          <div className="[&>button]:btn-primary">
            <FundButton
              listingId={listing.listingId}
              tokenAmount={tokenAmount}
              freeCancelUntil={BigInt(nowSec() + FREE_CANCEL_WINDOW)}
              expiry={BigInt(nowSec() + EXPIRY_WINDOW)}
              walletClient={walletClient}
              onFunded={(d) => setDealId(d)}
              onError={(e) => setFundErr(errMsg(e))}
            />
          </div>
          <p className="text-center text-xs text-zinc-500">
            Locks your payment now — the seller can&apos;t take it until you confirm in person.
          </p>
        </div>
      )}
    </div>
  );
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${bold ? 'font-semibold text-zinc-100' : ''}`}>
      <span className="text-zinc-400">{k}</span>
      <span>{v}</span>
    </div>
  );
}

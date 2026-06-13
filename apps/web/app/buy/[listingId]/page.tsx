'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useWalletClient } from '@handoff/auth';
import { FundButton } from '@handoff/funding';
import { getTokenPriceUsd1e8 } from '@handoff/datastreams';
import { readListing, type Listing } from '@/lib/escrow';
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

// Buyer-side timing defaults (seconds). The buyer gets a free-cancel window, and the deal
// expires after which the CRE keeper can reclaim (SPEC §3/§12).
const FREE_CANCEL_WINDOW = 60 * 60; // 1h
const EXPIRY_WINDOW = 24 * 60 * 60; // 24h
// Extra buffer for volatile tokens so a price dip still covers price + deposit (SPEC §4).
const VOLATILE_BUFFER_BPS = 2000; // +20%

export default function BuyListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = use(params);
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
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tokenAmount, setTokenAmount] = useState<bigint | null>(null);
  const [fundErr, setFundErr] = useState<string | null>(null);
  const [dealId, setDealId] = useState<bigint | null>(null);

  // Load the listing.
  useEffect(() => {
    if (id === null) {
      setLoadErr('Invalid listing id.');
      return;
    }
    let alive = true;
    readListing(id)
      .then((l) => alive && setListing(l))
      .catch((e) => alive && setLoadErr(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  // Compute the token amount the buyer must lock (price + deposit), with a volatile buffer.
  useEffect(() => {
    if (!listing) return;
    let alive = true;
    (async () => {
      const totalValue = totalUsd1e8(listing.priceUsd1e8, listing.depositBps);
      if (isStableToken(listing.payToken)) {
        if (alive) setTokenAmount(usd1e8ToUsdc(totalValue));
        return;
      }
      // Volatile: size from a live (mock) price, then add a safety buffer.
      const feed = process.env.NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD ?? 'ETH/USD';
      const priceUsd1e8 = await getTokenPriceUsd1e8(feed); // USD per 1 token, 1e8
      const buffered =
        (totalValue * BigInt(10_000 + VOLATILE_BUFFER_BPS)) / 10_000n;
      // tokens(18dp) = usdValue(1e8) * 1e18 / pricePerToken(1e8)
      const amount = (buffered * 10n ** 18n) / priceUsd1e8;
      if (alive) setTokenAmount(amount);
    })().catch((e) => alive && setFundErr(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [listing]);

  if (loadErr) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Listing #{listingId}</h1>
        <ErrorNote>{loadErr}</ErrorNote>
        <Link href="/buy" className="btn-secondary">
          Back
        </Link>
      </div>
    );
  }

  if (!listing) {
    return <div className="py-10 text-center text-slate-500">Loading listing…</div>;
  }

  const deposit = depositUsd1e8(listing.priceUsd1e8, listing.depositBps);
  const total = totalUsd1e8(listing.priceUsd1e8, listing.depositBps);
  const stable = isStableToken(listing.payToken);

  // Funded success state — the "safe to meet" screen the seller can verify.
  if (dealId !== null) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-bold">Funds committed</h1>
        <SuccessNote>
          <div className="space-y-1">
            <div className="text-lg font-bold">🔒 Safe to meet</div>
            <div>
              Your {fmtUsd1e8(total)} is locked on-chain for deal #
              {dealId.toString()}. The seller can verify it before traveling.
            </div>
          </div>
        </SuccessNote>
        <div className="card space-y-1 text-sm">
          <KV k="Deal" v={`#${dealId.toString()}`} />
          <KV k="Seller" v={shortAddr(listing.seller)} />
          <KV k="Item price" v={fmtUsd1e8(listing.priceUsd1e8)} />
          <KV k="Deposit (refundable to you)" v={fmtUsd1e8(deposit)} />
        </div>
        <Link href={`/deal/${dealId.toString()}`} className="btn-primary">
          Go to the deal
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Listing #{listingId}</h1>

      {!listing.active && (
        <ErrorNote>This listing is no longer active.</ErrorNote>
      )}

      <div className="card space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-bold">
            {fmtUsd1e8(listing.priceUsd1e8)}
          </span>
          <span className="pill bg-slate-100 text-slate-600">
            {stable ? 'USDC' : 'volatile token'}
          </span>
        </div>
        <KV k="Seller" v={shortAddr(listing.seller)} />
        <KV k="Pay token" v={shortAddr(listing.payToken)} mono />
      </div>

      <div className="card space-y-2">
        <div className="font-semibold">Cancellation policy</div>
        <p className="text-sm text-slate-600">
          {policyText(listing.priceUsd1e8, listing.depositBps)}
        </p>
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <KV k="Item price (always refundable)" v={fmtUsd1e8(listing.priceUsd1e8)} />
          <KV k="Deposit (earnest money)" v={fmtUsd1e8(deposit)} />
          <KV
            k={stable ? 'You lock' : 'You lock (incl. price buffer)'}
            v={
              tokenAmount === null
                ? '…'
                : stable
                ? `${fmtUsd1e8(total)} USDC`
                : `${fmt18(tokenAmount)} tokens (~${fmtUsd1e8(total)})`
            }
            bold
          />
        </div>
        {!stable && (
          <InfoNote>
            Paying with a volatile token: at release, Chainlink Data Streams prices
            it so the seller gets exactly {fmtUsd1e8(listing.priceUsd1e8)}-worth and
            any surplus comes back to you.
          </InfoNote>
        )}
      </div>

      {fundErr && <ErrorNote>{fundErr}</ErrorNote>}

      {!isConnected ? (
        <button className="btn-primary" onClick={login}>
          Log in to fund
        </button>
      ) : !walletClient || tokenAmount === null ? (
        <button className="btn-primary" disabled>
          Preparing…
        </button>
      ) : (
        <div className="space-y-1">
          {/* @handoff/funding renders the one-tap fund button; it does the ERC20 approve
              and calls Escrow.fund, resolving with the new dealId. */}
          <FundButtonWrap
            listingId={listing.listingId}
            tokenAmount={tokenAmount}
            freeCancelUntil={BigInt(nowSec() + FREE_CANCEL_WINDOW)}
            expiry={BigInt(nowSec() + EXPIRY_WINDOW)}
            walletClient={walletClient}
            onFunded={(d) => setDealId(d)}
            onError={(e) => setFundErr(errMsg(e))}
          />
          <p className="text-center text-xs text-slate-400">
            buyer: {shortAddr(address)} · one-tap deposit via Blink
          </p>
        </div>
      )}
    </div>
  );
}

// Thin wrapper so the (unstyled) package FundButton picks up our primary-button look.
function FundButtonWrap(props: React.ComponentProps<typeof FundButton>) {
  return (
    <div className="[&>button]:btn-primary">
      <FundButton {...props} />
    </div>
  );
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function fmt18(v: bigint) {
  return (Number(v) / 1e18).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

function KV({
  k,
  v,
  bold,
  mono,
}: {
  k: string;
  v: string;
  bold?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-slate-500">{k}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{v}</span>
    </div>
  );
}

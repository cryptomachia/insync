'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useWalletClient } from '@handoff/auth';
import { FundButton } from '@handoff/funding';
import { getTokenPriceUsd1e8 } from '@handoff/datastreams';
import { readListing, type Listing } from '@/lib/escrow';
import { getListingMeta, shareCoordination, type ListingMeta } from '@/lib/backend';
import {
  fmtUsd1e8,
  depositUsd1e8,
  totalUsd1e8,
  usd1e8ToUsdc,
  isStableToken,
  shortAddr,
} from '@/lib/format';
import { policyText } from '@/lib/cancellation';
import { VaultLock } from '@/components/designs';
import Chat from '@/components/Chat';
import { ErrorNote, InfoNote, SuccessNote, errMsg } from '@/components/Notice';

const VOLATILE_BUFFER_BPS = 2000; // +20% buffer for volatile tokens

// Humanize a seconds duration for the seller's cancellation policy (e.g. 3600 -> "1 hour").
function fmtDuration(seconds: bigint): string {
  const s = Number(seconds);
  if (s <= 0) return 'none';
  if (s % 86400 === 0) return `${s / 86400} day${s / 86400 === 1 ? '' : 's'}`;
  if (s % 3600 === 0) return `${s / 3600} hour${s / 3600 === 1 ? '' : 's'}`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s}s`;
}

export default function BuyListingPage({ params }: { params: { listingId: string } }) {
  const { listingId } = params;
  const id = useMemo(() => {
    try {
      return BigInt(listingId);
    } catch {
      return null;
    }
  }, [listingId]);

  const { isConnected, login, address, email } = useAuth();
  const walletClient = useWalletClient();

  const [listing, setListing] = useState<Listing | null>(null);
  const [meta, setMeta] = useState<ListingMeta | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tokenAmount, setTokenAmount] = useState<bigint | null>(null);
  const [fundErr, setFundErr] = useState<string | null>(null);
  const [dealId, setDealId] = useState<bigint | null>(null);
  const [imgIdx, setImgIdx] = useState(0);

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
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-bold">Listing</h1>
        <ErrorNote>{loadErr}</ErrorNote>
        <Link href="/buy" className="btn-secondary !w-auto px-4">Back</Link>
      </div>
    );
  }
  if (!listing) {
    return <div className="py-16 text-center text-zinc-500">Loading listing…</div>;
  }

  const deposit = depositUsd1e8(listing.priceUsd1e8, listing.depositBps);
  const total = totalUsd1e8(listing.priceUsd1e8, listing.depositBps);
  const stable = isStableToken(listing.payToken);
  const title = meta?.title || `Listing #${listingId}`;
  const gallery = meta?.images && meta.images.length ? meta.images : meta?.image ? [meta.image] : [];
  const isSeller = !!address && address.toLowerCase() === listing.seller.toLowerCase();

  // Funded — "safe to meet" confirmation the seller can verify.
  if (dealId !== null) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
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
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      {/* Left: the item */}
      <div className="space-y-5">
        <Gallery images={gallery} alt={title} idx={imgIdx} setIdx={setImgIdx} />

        <div className="space-y-1">
          <h1 className="text-3xl font-bold leading-tight">{title}</h1>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-indigo-300">{fmtUsd1e8(listing.priceUsd1e8)}</span>
            <span className="pill bg-white/10 text-zinc-300">{stable ? 'USDC' : 'volatile token'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span>Sold by {shortAddr(listing.seller)}</span>
            {meta?.category && <span className="pill bg-white/10 text-zinc-300">{meta.category}</span>}
            {meta?.condition && <span className="pill bg-white/10 text-zinc-300">{meta.condition}</span>}
          </div>
        </div>

        {meta?.description && (
          <p className="whitespace-pre-wrap text-sm text-zinc-300">{meta.description}</p>
        )}

        {(meta?.meetAddress ||
          meta?.meetLat != null ||
          meta?.meetTime ||
          meta?.notes ||
          meta?.sellerPhone ||
          meta?.sellerEmail) && (
          <div className="card space-y-2">
            <div className="font-semibold">Meetup details</div>
            {meta?.meetAddress && <div className="surface text-sm text-zinc-200">📍 {meta.meetAddress}</div>}
            {meta?.meetTime && <div className="text-sm text-zinc-300">🕒 {meta.meetTime}</div>}
            {meta?.meetLat != null && meta?.meetLng != null && (
              <>
                <iframe
                  title="meet location"
                  src={`https://maps.google.com/maps?q=${meta.meetLat},${meta.meetLng}&z=15&output=embed`}
                  className="h-48 w-full rounded-xl border border-white/10"
                  loading="lazy"
                />
                <a
                  className="btn-secondary"
                  href={`https://www.google.com/maps?q=${meta.meetLat},${meta.meetLng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Google Maps ↗
                </a>
              </>
            )}
            {meta?.notes && (
              <div className="surface text-sm text-zinc-300">
                <span className="text-zinc-500">Seller&apos;s note:</span> {meta.notes}
              </div>
            )}
            {meta?.sellerPhone && (
              <a className="btn-secondary" href={`tel:${meta.sellerPhone}`}>📞 Seller · {meta.sellerPhone}</a>
            )}
            {meta?.sellerEmail && (
              <a className="btn-secondary" href={`mailto:${meta.sellerEmail}`}>✉️ {meta.sellerEmail}</a>
            )}
            <p className="text-xs text-zinc-500">
              You&apos;ll get the seller&apos;s live location + full contact after you lock payment.
            </p>
          </div>
        )}

        {/* Pre-deal messaging + offers */}
        {isSeller ? (
          <div className="card text-sm text-zinc-400">
            This is your listing. Buyer messages &amp; offers show up in your{' '}
            <Link href="/messages" className="text-indigo-300 underline">Inbox</Link>.
          </div>
        ) : isConnected && address ? (
          <Chat listingId={listingId} buyer={address} role="buyer" listingPriceUsd1e8={listing.priceUsd1e8} />
        ) : (
          <div className="card flex items-center justify-between gap-3 text-sm text-zinc-400">
            <span>Sign in to message the seller or make an offer.</span>
            <button className="btn-primary !w-auto px-4" onClick={login}>Sign in</button>
          </div>
        )}
      </div>

      {/* Right: sticky purchase panel */}
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        {!listing.active && <ErrorNote>This listing is no longer available.</ErrorNote>}
        {meta?.archived && (
          <ErrorNote>The seller has withdrawn this listing — please check with them before paying.</ErrorNote>
        )}

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
          <p className="text-xs text-zinc-500">
            {listing.freeCancelWindow > 0n
              ? `Set by the seller: free cancellation for ${fmtDuration(listing.freeCancelWindow)} after you pay.`
              : 'Set by the seller: no free-cancel window on this listing.'}{' '}
            The deal auto-refunds if the meet doesn&apos;t happen within {fmtDuration(listing.dealTtl)}.
          </p>
          {listing.bond > 0n && (
            <p className="text-xs text-emerald-300">
              🛡️ The seller staked a {fmtUsd1e8(listing.bond * 100n)} no-show bond — it&apos;s yours
              if they don&apos;t show up.
            </p>
          )}
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
          <VaultLock
            amountLabel={stable ? `${fmtUsd1e8(total)} USDC` : `~${fmtUsd1e8(total)}`}
            policyNote="Locks your payment now — the seller can't take it until you confirm in person."
          >
            <FundButton
              listingId={listing.listingId}
              tokenAmount={tokenAmount}
              walletClient={walletClient}
              onFunded={(d) => {
                setDealId(d);
                // Seed the seller's listed location/phone/email + the listing link into the
                // deal so the deal page can show full meetup details; seed the buyer's email.
                shareCoordination(d, 'seller', {
                  lat: meta?.meetLat ?? undefined,
                  lng: meta?.meetLng ?? undefined,
                  phone: meta?.sellerPhone ?? undefined,
                  email: meta?.sellerEmail ?? undefined,
                  listingId,
                }).catch(() => {});
                if (email) shareCoordination(d, 'buyer', { email }).catch(() => {});
              }}
              onError={(e) => setFundErr(errMsg(e))}
            />
          </VaultLock>
        )}
      </div>
    </div>
  );
}

function Gallery({
  images,
  alt,
  idx,
  setIdx,
}: {
  images: string[];
  alt: string;
  idx: number;
  setIdx: (n: number) => void;
}) {
  if (images.length === 0) return null;
  const i = Math.min(idx, images.length - 1);
  return (
    <div className="space-y-2">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[i]} alt={alt} className="aspect-video w-full rounded-2xl border border-white/10 object-cover" />
        {images.length > 1 && (
          <>
            <button
              onClick={() => setIdx((i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-lg text-white hover:bg-black/70"
              aria-label="previous photo"
            >
              ‹
            </button>
            <button
              onClick={() => setIdx((i + 1) % images.length)}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-lg text-white hover:bg-black/70"
              aria-label="next photo"
            >
              ›
            </button>
            <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
              {i + 1}/{images.length}
            </span>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, j) => (
            <button
              key={j}
              onClick={() => setIdx(j)}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border ${j === i ? 'border-indigo-400' : 'border-white/10'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
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

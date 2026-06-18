'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth, useWalletClient } from '@handoff/auth';
import { getAddresses } from '@handoff/contracts-abi';
import { listItem } from '@/lib/tx';
import { saveListingMeta } from '@/lib/backend';
import { parseUsdToUsd1e8, fmtUsd1e8, depositUsd1e8, totalUsd1e8, usd1e8ToUsdc } from '@/lib/format';
import { ErrorNote, SuccessNote, InfoNote, errMsg } from '@/components/Notice';
import ShareListing from '@/components/ShareListing';
import MeetTimePicker from '@/components/MeetTimePicker';

// "No-show protection" levels — plain language instead of bps/earnest-money jargon.
const PROTECTION = [
  { bps: 0, label: 'None', sub: 'Easiest for buyers' },
  { bps: 1000, label: '10%', sub: 'Recommended' },
  { bps: 2000, label: '20%', sub: 'High-value items' },
];

// Seller-set cancellation timing policy (seconds). The buyer cannot change these — the contract
// derives the deal's free-cancel window + expiry from the listing, so the deposit-at-risk binds.
const FREE_CANCEL_OPTIONS = [
  { sec: 0, label: 'No free window', sub: 'Strictest' },
  { sec: 60 * 60, label: '1 hour', sub: 'Recommended' },
  { sec: 24 * 60 * 60, label: '24 hours', sub: 'Most lenient' },
];
const EXPIRY_OPTIONS = [
  { sec: 24 * 60 * 60, label: '1 day', sub: 'Default' },
  { sec: 3 * 24 * 60 * 60, label: '3 days', sub: '' },
  { sec: 7 * 24 * 60 * 60, label: '7 days', sub: '' },
];

// Seller no-show bond — your own stake, forfeited to the buyer if YOU don't show. Makes the
// commitment symmetric (the buyer already posts a deposit). Expressed as % of price.
const SELLER_BOND_OPTIONS = [
  { bps: 0, label: 'None', sub: 'Less trust' },
  { bps: 500, label: '5%', sub: '' },
  { bps: 1000, label: '10%', sub: 'Recommended' },
];

// Downscale + compress a chosen photo to a small JPEG data URL so it fits in one request.
async function compressImage(file: File, max = 1100, quality = 0.72): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export default function SellPage() {
  const { isConnected, login, address, email } = useAuth();
  const walletClient = useWalletClient();
  const { usdc } = getAddresses();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [priceStr, setPriceStr] = useState('');
  const [depositBps, setDepositBps] = useState(1000);
  const [freeCancelWindow, setFreeCancelWindow] = useState(60 * 60); // 1h
  const [dealTtl, setDealTtl] = useState(24 * 60 * 60); // 1 day
  const [sellerBondBps, setSellerBondBps] = useState(1000); // 10% no-show bond
  const [meetAddress, setMeetAddress] = useState('');
  const [meetCoords, setMeetCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [sellerPhone, setSellerPhone] = useState('');
  const [meetTime, setMeetTime] = useState('');
  const [notes, setNotes] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [locBusy, setLocBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Prefill the contact email from the signed-in account once it loads.
  useEffect(() => {
    if (email) setEmailInput((cur) => cur || email);
  }, [email]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [listingId, setListingId] = useState<bigint | null>(null);

  const priceUsd1e8 = useMemo(() => parseUsdToUsd1e8(priceStr), [priceStr]);
  const deposit = depositUsd1e8(priceUsd1e8, depositBps);
  const buyerPays = totalUsd1e8(priceUsd1e8, depositBps);
  const sellerBond = depositUsd1e8(priceUsd1e8, sellerBondBps);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file isn’t an image. Drop a photo (JPG/PNG).');
      return;
    }
    try {
      setImage(await compressImage(file));
      setError(null);
    } catch {
      setError('Could not read that image. Try a different photo.');
    }
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    void handleFile(e.target.files?.[0]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setError('Location isn’t available in this browser.');
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMeetCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocBusy(false);
      },
      () => {
        setError('Could not get your location (permission denied?).');
        setLocBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function onSubmit() {
    setError(null);
    setWarn(null);
    setListingId(null);
    if (!walletClient) return setError('Wallet not ready — sign in first.');
    if (!name.trim()) return setError('Give your item a name.');
    if (priceUsd1e8 <= 0n) return setError('Enter a price greater than $0.');
    const payToken = usdc as `0x${string}` | undefined;
    if (!payToken) return setError('Payment token not configured.');

    setBusy(true);
    try {
      const id = await listItem(walletClient, {
        priceUsd1e8,
        depositBps,
        payToken,
        freeCancelWindow: BigInt(freeCancelWindow),
        dealTtl: BigInt(dealTtl),
        bondAmount: usd1e8ToUsdc(sellerBond),
      });
      // Save the human details (name/description/photo) off-chain, keyed by the listing id.
      try {
        await saveListingMeta(id, {
          title: name.trim(),
          description: description.trim() || undefined,
          image: image || undefined,
          meetAddress: meetAddress.trim() || undefined,
          meetLat: meetCoords?.lat,
          meetLng: meetCoords?.lng,
          sellerPhone: sellerPhone.trim() || undefined,
          sellerEmail: emailInput.trim() || email || undefined,
          meetTime: meetTime.trim() || undefined,
          notes: notes.trim() || undefined,
          sellerAddress: address,
        });
      } catch {
        setWarn('Listing created, but the photo/description failed to save (backend offline?).');
      }
      setListingId(id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-xl font-bold">Sell an item</h1>
        <InfoNote>Sign in to post a listing.</InfoNote>
        <button className="btn-primary" onClick={login}>
          Sign in
        </button>
      </div>
    );
  }

  // Success screen.
  if (listingId !== null) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-xl font-bold">Listing posted 🎉</h1>
        {warn && <ErrorNote>{warn}</ErrorNote>}
        <SuccessNote>
          <div className="space-y-2">
            <div className="font-semibold">Your item is live (listing #{listingId.toString()}).</div>
            <div>Show the QR in person, or share the link — the buyer opens it to lock payment:</div>
            <Link
              href={`/buy/${listingId.toString()}`}
              className="block break-all rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-indigo-300 underline"
            >
              /buy/{listingId.toString()}
            </Link>
          </div>
        </SuccessNote>

        <div className="card">
          <ShareListing
            url={`${typeof window !== 'undefined' ? window.location.origin : ''}/buy/${listingId.toString()}`}
            title={name || `inSync listing #${listingId.toString()}`}
          />
        </div>
        <Link href={`/buy/${listingId.toString()}`} className="btn-primary">
          Preview the buyer's view
        </Link>
        <Link href="/my-listings" className="btn-secondary">
          Manage my listings
        </Link>
        <button
          className="btn-secondary"
          onClick={() => {
            setName('');
            setDescription('');
            setImage('' as unknown as null);
            setImage(null);
            setPriceStr('');
            setListingId(null);
          }}
        >
          Post another
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">Sell an item</h1>

      <div className="card space-y-5">
        {/* Photo */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="label">Photo</span>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />
          {image ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="item" className="aspect-video w-full rounded-xl object-cover" />
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
                  Change photo
                </button>
                <button className="btn-secondary" onClick={() => setImage(null)}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className={`flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-zinc-400 transition ${
                dragging
                  ? 'border-indigo-400 bg-indigo-500/10 text-indigo-200'
                  : 'border-white/15 bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <span className="text-2xl">📷</span>
              <span className="text-sm">{dragging ? 'Drop the photo here' : 'Drag & drop a photo, or click to choose'}</span>
            </button>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="label" htmlFor="name">Item name</label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Specialized road bike"
          />
        </div>

        {/* Description */}
        <div>
          <label className="label" htmlFor="desc">Description</label>
          <textarea
            id="desc"
            className="input min-h-[88px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Condition, size, anything the buyer should know…"
          />
        </div>

        {/* Price */}
        <div>
          <label className="label" htmlFor="price">Price (USD)</label>
          <input
            id="price"
            inputMode="decimal"
            className="input"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            placeholder="80"
          />
        </div>

        {/* No-show protection */}
        <div>
          <span className="label">No-show protection</span>
          <p className="mb-2 text-xs text-zinc-500">
            On top of the price, the buyer puts down a small deposit they get back when the
            deal completes. They only lose it if they bail after you&apos;ve shown up to meet.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {PROTECTION.map((p) => (
              <button
                key={p.bps}
                type="button"
                onClick={() => setDepositBps(p.bps)}
                className={`choice ${depositBps === p.bps ? 'choice-on' : 'choice-off'}`}
              >
                <div>{p.label}</div>
                <div className="mt-0.5 text-[10px] font-normal opacity-70">{p.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Cancellation policy (seller-set timing) */}
        <div>
          <span className="label">Free-cancel window</span>
          <p className="mb-2 text-xs text-zinc-500">
            How long after the buyer pays they can still cancel for a full refund (deposit
            included). After this, if you&apos;ve checked in, a buyer who bails forfeits the deposit.
            You set this — the buyer can&apos;t change it.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {FREE_CANCEL_OPTIONS.map((o) => (
              <button
                key={o.sec}
                type="button"
                onClick={() => setFreeCancelWindow(o.sec)}
                className={`choice ${freeCancelWindow === o.sec ? 'choice-on' : 'choice-off'}`}
              >
                <div>{o.label}</div>
                <div className="mt-0.5 text-[10px] font-normal opacity-70">{o.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Hold time before auto-refund</span>
          <p className="mb-2 text-xs text-zinc-500">
            If the meet never happens, the deal expires after this and the keeper refunds the buyer
            (or releases your deposit if you checked in).
          </p>
          <div className="grid grid-cols-3 gap-2">
            {EXPIRY_OPTIONS.map((o) => (
              <button
                key={o.sec}
                type="button"
                onClick={() => setDealTtl(o.sec)}
                className={`choice ${dealTtl === o.sec ? 'choice-on' : 'choice-off'}`}
              >
                <div>{o.label}</div>
                <div className="mt-0.5 text-[10px] font-normal opacity-70">{o.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Seller no-show bond */}
        <div>
          <span className="label">Your no-show bond</span>
          <p className="mb-2 text-xs text-zinc-500">
            You stake this yourself. You get it back on a completed (or cooperatively cancelled)
            deal — but if <span className="font-medium text-zinc-300">you</span> don&apos;t show, it
            goes to the buyer. It mirrors the buyer&apos;s deposit so flaking is penalized on both
            sides.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {SELLER_BOND_OPTIONS.map((o) => (
              <button
                key={o.bps}
                type="button"
                onClick={() => setSellerBondBps(o.bps)}
                className={`choice ${sellerBondBps === o.bps ? 'choice-on' : 'choice-off'}`}
              >
                <div>{o.label}</div>
                <div className="mt-0.5 text-[10px] font-normal opacity-70">{o.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Where to meet */}
        <div>
          <span className="label">Where to meet</span>
          <input
            className="input"
            value={meetAddress}
            onChange={(e) => setMeetAddress(e.target.value)}
            placeholder="e.g. Apple Store, 5th Ave, NYC"
          />
          <button type="button" onClick={useMyLocation} className="btn-secondary mt-2">
            {locBusy
              ? 'Getting location…'
              : meetCoords
                ? '📍 Pinned — update location'
                : '📍 Use my current location'}
          </button>
          {meetCoords && (
            <p className="mt-1 text-xs text-zinc-500">
              Pinned at {meetCoords.lat.toFixed(4)}, {meetCoords.lng.toFixed(4)} — the buyer gets a
              map + directions.
            </p>
          )}
        </div>

        {/* Phone */}
        <div>
          <label className="label" htmlFor="phone">
            Phone <span className="text-zinc-500">(optional, shared with the buyer)</span>
          </label>
          <input
            id="phone"
            className="input"
            inputMode="tel"
            value={sellerPhone}
            onChange={(e) => setSellerPhone(e.target.value)}
            placeholder="+1 555 123 4567"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Recommended — so the buyer can reach you if the meeting spot changes.
          </p>
        </div>

        {/* Meeting time */}
        <div>
          <span className="label">Proposed meeting time</span>
          <MeetTimePicker value={meetTime} onChange={setMeetTime} />
        </div>

        {/* Email */}
        <div>
          <label className="label" htmlFor="email">
            Email <span className="text-zinc-500">(shared with the buyer)</span>
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="label" htmlFor="notes">
            Notes for the buyer <span className="text-zinc-500">(optional)</span>
          </label>
          <textarea
            id="notes"
            className="input min-h-[72px] resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. “Text when you arrive and I’ll come down. Park in the back.”"
          />
        </div>

        {/* Summary */}
        <div className="surface space-y-1 text-sm">
          <Row k="Item price" v={priceUsd1e8 > 0n ? fmtUsd1e8(priceUsd1e8) : '—'} />
          <Row k="Buyer's deposit (refunded on completion)" v={fmtUsd1e8(deposit)} />
          <Row k="Buyer locks in total" v={priceUsd1e8 > 0n ? fmtUsd1e8(buyerPays) : '—'} bold />
          <Row k="Your no-show bond (you stake; refunded on completion)" v={fmtUsd1e8(sellerBond)} />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <button className="btn-primary" disabled={busy} onClick={onSubmit}>
          {busy ? 'Posting…' : 'Post listing'}
        </button>
      </div>
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

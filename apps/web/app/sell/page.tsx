'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth, useWalletClient } from '@handoff/auth';
import { getAddresses } from '@handoff/contracts-abi';
import { listItem } from '@/lib/tx';
import { saveListingMeta } from '@/lib/backend';
import { parseUsdToUsd1e8, fmtUsd1e8, depositUsd1e8, totalUsd1e8 } from '@/lib/format';
import { ErrorNote, SuccessNote, InfoNote, errMsg } from '@/components/Notice';

// "No-show protection" levels — plain language instead of bps/earnest-money jargon.
const PROTECTION = [
  { bps: 0, label: 'None', sub: 'Easiest for buyers' },
  { bps: 1000, label: '10%', sub: 'Recommended' },
  { bps: 2000, label: '20%', sub: 'High-value items' },
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
  const { isConnected, login } = useAuth();
  const walletClient = useWalletClient();
  const { usdc } = getAddresses();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [priceStr, setPriceStr] = useState('');
  const [depositBps, setDepositBps] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [listingId, setListingId] = useState<bigint | null>(null);

  const priceUsd1e8 = useMemo(() => parseUsdToUsd1e8(priceStr), [priceStr]);
  const deposit = depositUsd1e8(priceUsd1e8, depositBps);
  const buyerPays = totalUsd1e8(priceUsd1e8, depositBps);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImage(await compressImage(file));
    } catch {
      setError('Could not read that image. Try a different photo.');
    }
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
      const id = await listItem(walletClient, { priceUsd1e8, depositBps, payToken });
      // Save the human details (name/description/photo) off-chain, keyed by the listing id.
      try {
        await saveListingMeta(id, {
          title: name.trim(),
          description: description.trim() || undefined,
          image: image || undefined,
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
      <div className="space-y-4">
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
      <div className="space-y-5">
        <h1 className="text-xl font-bold">Listing posted 🎉</h1>
        {warn && <ErrorNote>{warn}</ErrorNote>}
        <SuccessNote>
          <div className="space-y-2">
            <div className="font-semibold">Your item is live (listing #{listingId.toString()}).</div>
            <div>Share this link with your buyer — they open it to lock their payment:</div>
            <Link
              href={`/buy/${listingId.toString()}`}
              className="block break-all rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-indigo-300 underline"
            >
              /buy/{listingId.toString()}
            </Link>
          </div>
        </SuccessNote>
        <Link href={`/buy/${listingId.toString()}`} className="btn-primary">
          Preview the buyer's view
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
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Sell an item</h1>

      <div className="card space-y-5">
        {/* Photo */}
        <div>
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
              className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.05]"
            >
              <span className="text-2xl">📷</span>
              <span className="text-sm">Add a photo</span>
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

        {/* Summary */}
        <div className="surface space-y-1 text-sm">
          <Row k="Item price" v={priceUsd1e8 > 0n ? fmtUsd1e8(priceUsd1e8) : '—'} />
          <Row k="Buyer's deposit (refunded on completion)" v={fmtUsd1e8(deposit)} />
          <Row k="Buyer locks in total" v={priceUsd1e8 > 0n ? fmtUsd1e8(buyerPays) : '—'} bold />
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

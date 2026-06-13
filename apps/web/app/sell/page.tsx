'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useWalletClient } from '@handoff/auth';
import { getAddresses } from '@handoff/contracts-abi';
import { listItem } from '@/lib/tx';
import {
  parseUsdToUsd1e8,
  fmtUsd1e8,
  depositUsd1e8,
  totalUsd1e8,
} from '@/lib/format';
import { ErrorNote, SuccessNote, InfoNote, errMsg } from '@/components/Notice';

const DEPOSIT_PRESETS = [
  { label: '5%', bps: 500 },
  { label: '10%', bps: 1000 },
  { label: '20%', bps: 2000 },
];

export default function SellPage() {
  const { isConnected, login } = useAuth();
  const walletClient = useWalletClient();
  const { usdc } = getAddresses();

  const [priceStr, setPriceStr] = useState('80');
  const [depositBps, setDepositBps] = useState(1000);
  const [token, setToken] = useState<string>(usdc ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingId, setListingId] = useState<bigint | null>(null);

  const priceUsd1e8 = useMemo(() => parseUsdToUsd1e8(priceStr), [priceStr]);
  const deposit = depositUsd1e8(priceUsd1e8, depositBps);
  const buyerLocks = totalUsd1e8(priceUsd1e8, depositBps);

  async function onSubmit() {
    setError(null);
    setListingId(null);
    if (!walletClient) {
      setError('Wallet not ready. Log in first.');
      return;
    }
    if (priceUsd1e8 <= 0n) {
      setError('Enter a price greater than $0.');
      return;
    }
    const payToken = (token || usdc) as `0x${string}` | undefined;
    if (!payToken) {
      setError('No pay token configured. Set NEXT_PUBLIC_USDC_ADDRESS.');
      return;
    }
    setBusy(true);
    try {
      const id = await listItem(walletClient, {
        priceUsd1e8,
        depositBps,
        payToken,
      });
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
        <InfoNote>Log in to create a listing.</InfoNote>
        <button className="btn-primary" onClick={login}>
          Log in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Sell an item</h1>

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="price">
            Price (USD)
          </label>
          <input
            id="price"
            inputMode="decimal"
            className="input"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            placeholder="80"
          />
        </div>

        <div>
          <span className="label">Deposit policy (earnest money)</span>
          <div className="grid grid-cols-3 gap-2">
            {DEPOSIT_PRESETS.map((p) => (
              <button
                key={p.bps}
                type="button"
                onClick={() => setDepositBps(p.bps)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                  depositBps === p.bps
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The buyer locks the deposit too, but only loses it if they flake after
            you show up to meet.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="token">
            Pay token
          </label>
          <input
            id="token"
            className="input font-mono text-sm"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={usdc ?? '0x… (defaults to USDC)'}
          />
          <p className="mt-1 text-xs text-slate-500">
            USDC needs no oracle. A volatile token is priced at release via Chainlink
            Data Streams.
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <Row k="Item price" v={fmtUsd1e8(priceUsd1e8)} />
          <Row k="Deposit" v={fmtUsd1e8(deposit)} />
          <Row k="Buyer locks" v={fmtUsd1e8(buyerLocks)} bold />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <button className="btn-primary" disabled={busy} onClick={onSubmit}>
          {busy ? 'Creating listing…' : 'Create listing'}
        </button>
      </div>

      {listingId !== null && (
        <SuccessNote>
          <div className="space-y-2">
            <div className="font-semibold">
              Listing #{listingId.toString()} created.
            </div>
            <div>Share this buy link so a buyer can lock funds:</div>
            <Link
              href={`/buy/${listingId.toString()}`}
              className="block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-brand underline"
            >
              /buy/{listingId.toString()}
            </Link>
          </div>
        </SuccessNote>
      )}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-slate-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}

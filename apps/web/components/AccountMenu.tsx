'use client';

import { useEffect, useRef, useState } from 'react';
import { parseAbi } from 'viem';
import { useAuth } from '@handoff/auth';
import { getAddresses } from '@handoff/contracts-abi';
import { publicClient, chain } from '@/lib/chain';

const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const EXPLORER = 'https://sepolia.basescan.org';

/**
 * Account button + dropdown: shows the email, the network, the full wallet address
 * (copyable), and live ETH + USDC balances. Replaces the bare truncated address.
 */
export default function AccountMenu() {
  const { address, email, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [eth, setEth] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = async () => {
      try {
        const bal = await publicClient().getBalance({ address });
        if (alive) setEth((Number(bal) / 1e18).toFixed(4));
      } catch {
        /* ignore */
      }
      try {
        const { usdc: token } = getAddresses();
        if (token) {
          const b = (await publicClient().readContract({
            address: token,
            abi: erc20,
            functionName: 'balanceOf',
            args: [address],
          })) as bigint;
          if (alive) setUsdc((Number(b) / 1e6).toFixed(2));
        }
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 12000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [address]);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!address) return null;
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 hover:bg-white/10"
      >
        <span className="hidden text-[11px] text-emerald-300 sm:inline">● {chain.name}</span>
        <span className="text-xs text-zinc-200">{usdc != null ? `$${usdc}` : '…'}</span>
        <span className="font-mono text-[11px] text-zinc-500">{short}</span>
        <span className="text-[10px] text-zinc-500">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-white/10 bg-zinc-950 p-4 shadow-xl">
          {email && <div className="truncate text-sm text-zinc-200">{email}</div>}

          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Network</span>
            <span className="flex items-center gap-1.5 text-zinc-200">
              <span className="text-emerald-400">●</span> {chain.name}{' '}
              <span className="text-zinc-500">({chain.id})</span>
            </span>
          </div>

          <div className="space-y-1 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">ETH (gas)</span>
              <span className="font-medium text-zinc-100">{eth ?? '…'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">USDC</span>
              <span className="font-medium text-zinc-100">{usdc != null ? `$${usdc}` : '…'}</span>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-zinc-500">Wallet address</div>
            <div className="break-all rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 font-mono text-xs text-zinc-200">
              {address}
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn-secondary !w-auto flex-1 px-2 py-1 text-xs" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <a
                className="btn-secondary !w-auto flex-1 px-2 py-1 text-center text-xs"
                href={`${EXPLORER}/address/${address}`}
                target="_blank"
                rel="noreferrer"
              >
                Basescan ↗
              </a>
            </div>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

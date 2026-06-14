'use client';

import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import { shortAddr } from '@/lib/format';

export default function Nav() {
  const { ready, isConnected, address, email, login, logout } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold tracking-tight text-zinc-100"
        >
          <span className="text-xl">🤝</span>
          <span>SafeSwap</span>
        </Link>

        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <>
              <div className="text-right leading-tight">
                {email && (
                  <div className="max-w-[150px] truncate text-xs text-zinc-200">{email}</div>
                )}
                <div className="font-mono text-[11px] text-zinc-500" title={address}>
                  {shortAddr(address)}
                </div>
              </div>
              <button
                onClick={logout}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-medium text-zinc-200 hover:bg-white/10"
              >
                Log out
              </button>
            </>
          ) : (
            <button
              onClick={login}
              disabled={!ready}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
            >
              {ready ? 'Sign in' : '…'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

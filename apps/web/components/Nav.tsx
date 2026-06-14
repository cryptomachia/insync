'use client';

import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import AccountMenu from '@/components/AccountMenu';

export default function Nav() {
  const { ready, isConnected, login } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between gap-2 px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 font-bold tracking-tight text-zinc-100"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="inSync" className="h-7 w-7 rounded-lg" />
          <span>inSync</span>
        </Link>

        <div className="flex items-center gap-2 text-sm">
          {isConnected ? (
            <AccountMenu />
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

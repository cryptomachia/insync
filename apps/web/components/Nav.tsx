'use client';

import Link from 'next/link';
import { useAuth } from '@handoff/auth';
import { shortAddr } from '@/lib/format';
import { IS_MOCK } from '@/lib/chain';

export default function Nav() {
  const { isConnected, address, email, login, logout } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="text-xl">🤝</span>
          <span>Handoff</span>
          {IS_MOCK && (
            <span className="pill bg-amber-100 text-amber-800">mock</span>
          )}
        </Link>
        <div className="text-sm">
          {isConnected ? (
            <button
              onClick={logout}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              title={address}
            >
              {email ?? shortAddr(address)}
            </button>
          ) : (
            <button
              onClick={login}
              className="rounded-lg bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-dark"
            >
              Log in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

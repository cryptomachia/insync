'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@handoff/auth';
import AccountMenu from '@/components/AccountMenu';

const LINKS = [
  { href: '/buy', label: 'Browse' },
  { href: '/sell', label: 'Sell' },
  { href: '/my-listings', label: 'My listings' },
  { href: '/trade-history', label: 'History' },
];

export default function Nav() {
  const { ready, isConnected, login } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold tracking-tight text-zinc-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="inSync" className="h-7 w-7 rounded-lg" />
            <span>inSync</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active ? 'bg-white/10 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>

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

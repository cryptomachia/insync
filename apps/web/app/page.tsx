import Link from 'next/link';
import { MyDealsDashboard } from '@/components/designs';

const steps = [
  'The seller posts an item — a photo, a price, a short description.',
  'The buyer locks the full payment in advance. The seller can see the money is real and waiting, so nobody wastes a trip.',
  'They meet in person. The buyer looks at the item and taps once to release payment.',
  'The seller is paid instantly and for keeps — no cash to carry, no bank, no reversals.',
];

export default function Home() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="grid items-center gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <span className="pill bg-indigo-500/15 text-indigo-300">Trustless in-person escrow · Base</span>
          <h1 className="text-4xl font-bold leading-[1.1] sm:text-5xl">Buy from strangers, safely.</h1>
          <p className="max-w-xl text-lg text-zinc-400">
            The payment is locked up front and only released when you meet in person and the buyer is
            happy. No cash changing hands, no bank, no chargebacks — just a clean, final handoff.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/buy" className="btn-primary !w-auto px-6">Browse items</Link>
            <Link href="/sell" className="btn-secondary !w-auto px-6">Sell an item</Link>
          </div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/banner.png"
          alt="inSync — Lock it. Meet. Release."
          className="w-full rounded-2xl border border-white/10 shadow-2xl shadow-black/40"
        />
      </section>

      {/* #3 wallet balance + #10 deals kanban — only renders once signed in */}
      <MyDealsDashboard />

      {/* Quick actions */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HomeLink href="/sell" title="Sell an item" sub="Post a photo, set a price, get a link." />
        <HomeLink href="/buy" title="Browse & buy" sub="Lock your payment, then meet." />
        <HomeLink href="/my-listings" title="My listings" sub="Edit, withdraw or relist items." />
        <HomeLink href="/trade-history" title="Trade history" sub="Everything you buy and sell." />
      </section>

      {/* How it works */}
      <section className="card space-y-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-indigo-300">How it works</div>
        <ol className="grid gap-4 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-zinc-300">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-bold text-indigo-300">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-400">
          To keep both sides honest, the buyer also puts down a small{' '}
          <span className="font-semibold text-zinc-200">refundable deposit</span>. They get it back
          the moment the deal completes — they only lose it if they back out after the seller has
          already shown up to meet.
        </p>
      </section>
    </div>
  );
}

function HomeLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="card flex h-full flex-col justify-between gap-4 transition hover:border-white/20 hover:bg-zinc-900"
    >
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-zinc-400">{sub}</div>
      </div>
      <span className="text-xl text-zinc-500">→</span>
    </Link>
  );
}

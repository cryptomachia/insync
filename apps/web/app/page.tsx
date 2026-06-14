import Link from 'next/link';

const steps = [
  'The seller posts an item — a photo, a price, a short description.',
  'The buyer locks the full payment in advance. The seller can see the money is real and waiting, so nobody wastes a trip.',
  'They meet in person. The buyer looks at the item and taps once to release payment.',
  'The seller is paid instantly and for keeps — no cash to carry, no bank, no reversals.',
];

export default function Home() {
  return (
    <div className="space-y-7">
      <section className="space-y-3">
        <h1 className="text-3xl font-bold leading-tight">Buy from strangers, safely.</h1>
        <p className="text-zinc-400">
          The payment is locked up front and only released when you meet in person and the
          buyer is happy. No cash changing hands, no bank, no chargebacks — just a clean,
          final handoff.
        </p>
      </section>

      <div className="grid gap-3">
        <HomeLink href="/sell" title="Sell an item" sub="Post a photo, set a price, get a link to share." />
        <HomeLink href="/buy" title="Buy an item" sub="Open a seller's link, lock your payment, then meet." />
        <HomeLink href="/my-listings" title="My listings" sub="See, edit, withdraw or relist your items." />
        <HomeLink href="/trade-history" title="Trade history" sub="Track everything you're buying and selling." />
      </div>

      <section className="card space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
          How it works
        </div>
        <ol className="space-y-3">
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
          <span className="font-semibold text-zinc-200">refundable deposit</span>. They get it
          back the moment the deal completes — they only lose it if they back out after the
          seller has already shown up to meet.
        </p>
      </section>
    </div>
  );
}

function HomeLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="card flex items-center justify-between transition hover:border-white/20 hover:bg-zinc-900"
    >
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-zinc-400">{sub}</div>
      </div>
      <span className="text-xl text-zinc-500">→</span>
    </Link>
  );
}

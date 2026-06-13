import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold leading-tight">
          Buy from strangers, safely.
        </h1>
        <p className="text-slate-600">
          The seller sees your funds <b>locked before they travel</b>. At the meet,
          you scan their QR to release payment. Final settlement — no chargebacks,
          no flaking.
        </p>
      </section>

      <div className="grid gap-3">
        <Link href="/sell" className="card flex items-center justify-between hover:bg-slate-50">
          <div>
            <div className="font-semibold">Sell an item</div>
            <div className="text-sm text-slate-500">
              Create a listing with a deposit policy.
            </div>
          </div>
          <span className="text-xl">→</span>
        </Link>

        <Link href="/buy" className="card flex items-center justify-between hover:bg-slate-50">
          <div>
            <div className="font-semibold">Buy an item</div>
            <div className="text-sm text-slate-500">
              Open a listing, lock funds, then meet.
            </div>
          </div>
          <span className="text-xl">→</span>
        </Link>

        <Link href="/my-deals" className="card flex items-center justify-between hover:bg-slate-50">
          <div>
            <div className="font-semibold">My deals</div>
            <div className="text-sm text-slate-500">
              Track everything you're buying and selling.
            </div>
          </div>
          <span className="text-xl">→</span>
        </Link>
      </div>

      <section className="card space-y-2 bg-slate-900 text-slate-100">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          How it works
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-200">
          <li>Seller lists an item with a small earnest-money deposit.</li>
          <li>Buyer one-tap locks price + deposit on-chain.</li>
          <li>Seller sees “funds committed” and agrees to meet.</li>
          <li>At the meet: seller checks in &amp; shows a QR; buyer scans to release.</li>
          <li>Seller gets paid; deposit returns to the buyer. Done.</li>
        </ol>
      </section>
    </div>
  );
}

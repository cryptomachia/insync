import Link from 'next/link';

export const metadata = {
  title: 'How inSync works',
  description: 'A plain-English guide to buying and selling from strangers, safely, in person.',
};

const ESCROW = '0x660b15A7a9caE8A0D8c380F0764103BC24c07B1d';

const ARCHITECTURE = `
┌──────────────────────── mobile web · Next.js (apps/web) ────────────────────────┐
│  email login → wallet   one-tap fund    QR release      live location            │
│     (Dynamic)            (Blink)         (QR handshake)  (Google Maps + GPS)      │
└───────────────┬─────────────────────────────────────────────┬───────────────────┘
                │ reads / writes on-chain                       │ off-chain details
                ▼                                               ▼
     ┌──────────────────────┐                          ┌────────────────────┐
     │  Escrow (Solidity)   │  funds held in escrow    │  backend (Fastify) │
     │  on Base · USDC      │  until in-person release │  photo · meet spot │
     └──────────┬───────────┘                          │  · live location   │
                │ expiry / events                       └────────────────────┘
                ▼
     ┌──────────────────────┐   auto-refunds no-show deals;
     │  CRE keeper          │   Data Streams prices volatile-
     │  (Chainlink)         │   token payments at release.
     └──────────────────────┘
`.trim();

const FLOW = `
 SELLER                       inSync · Escrow                        BUYER
   │  list: price, deposit%, photo, meet spot, phone                  │
   │ ───────────────────────────►                                    │
   │                       (share link)  ─────────────────────────►  │
   │                                       open link, see spot+price  │
   │                       ◄───────────────  lock payment (Blink)     │
   │                       [ funds locked in escrow on Base ]         │
   │  "committed — safe to meet" ◄──                                  │
   │                                                                  │
   │  ══ live location ⇄ Google Maps ⇄ live location ══              │
   │  ══ tap-to-call   ⇄    phone    ⇄  tap-to-call  ══              │
   │                                                                  │
   │  check in ──►                                                    │
   │                       ◄──────  scan QR + confirm receipt         │
   │  paid in full ◄───────  release  ──────►  deposit back to buyer  │
   │                                                                  │
   │  (buyer never shows? CRE keeper auto-refunds after expiry)       │
`.trim();

export default function DocsPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold leading-tight">How inSync works</h1>
        <p className="text-zinc-400">
          inSync lets two strangers trade an item in person without trusting each other —
          and without cash, banks, or chargebacks. The buyer&apos;s money is locked up front
          and only released when you meet and they&apos;re happy with the item.
        </p>
      </header>

      <Section title="The problem it solves">
        <p>
          Meeting a stranger to buy something is sketchy on both sides. The buyer worries the
          item is fake or the seller won&apos;t show. The seller worries about fake bills, a
          no-show, or carrying cash to a stranger. Online payments can be reversed days later
          (chargebacks). inSync removes all of that.
        </p>
      </Section>

      <Section title="How a trade works">
        <Steps
          steps={[
            'The seller posts an item — photo, price, short description — and shares a link.',
            'The buyer opens the link and locks the full payment in advance. The seller can see the money is real and waiting, so nobody wastes a trip.',
            'They meet in person. The buyer inspects the item.',
            'If happy, the buyer taps to release. The seller is paid instantly and for keeps. If something is wrong, the buyer simply doesn’t release and walks away.',
          ]}
        />
      </Section>

      <Section title="Finding each other (the meetup)">
        <p>Committing to a trade is only half of it — you still have to actually meet. inSync handles that:</p>
        <ul className="mt-3 space-y-2">
          <Bullet>
            The seller sets a <b className="text-zinc-200">meeting spot and time</b> when listing, and can
            share a phone, email, and notes for the buyer.
          </Bullet>
          <Bullet>The buyer sees the spot on a map (with directions) and all the details <i>before</i> paying.</Bullet>
          <Bullet>
            Once payment is locked, <b className="text-zinc-200">both people</b> can share live location on a
            map, share their phone + email, and tap to call.
          </Bullet>
          <Bullet>
            Plans changed? Either side can <b className="text-zinc-200">propose a new spot or time</b> right in
            the deal — the other person sees it instantly.
          </Bullet>
        </ul>
      </Section>

      <Section title="Browsing, managing, and receipts">
        <ul className="space-y-2">
          <Bullet>
            Buyers can <b className="text-zinc-200">browse and search</b> all live items, or open a direct link/QR
            the seller shares in person.
          </Bullet>
          <Bullet>
            Sellers manage everything under <b className="text-zinc-200">My listings</b> — edit details, withdraw,
            or relist an item.
          </Bullet>
          <Bullet>
            Every deal shows a <b className="text-zinc-200">live progress timeline</b> (payment locked → seller
            checked in → released) with timestamps.
          </Bullet>
          <Bullet>
            When a deal settles, both sides get a <b className="text-zinc-200">printable receipt</b> with the
            amounts, contacts, and links to the on-chain proof.
          </Bullet>
        </ul>
      </Section>

      <Section title="The refundable deposit (no-show protection)">
        <p>
          On top of the price, the buyer puts down a small <b className="text-zinc-200">refundable
          deposit</b> (the seller chooses 0%, 10%, or 20%). It keeps both sides honest:
        </p>
        <ul className="mt-3 space-y-2">
          <Bullet>The buyer gets the deposit back the moment the deal completes.</Bullet>
          <Bullet>
            The item price is <b className="text-zinc-200">always</b> refundable to the buyer until
            they confirm — they can change their mind and walk away with their money.
          </Bullet>
          <Bullet>
            The buyer only loses the deposit if they back out <i>after</i> the seller has already
            shown up to meet — so sellers aren&apos;t left stranded by a flake.
          </Bullet>
          <Bullet>If the seller never shows, the buyer gets everything back.</Bullet>
        </ul>
      </Section>

      <Section title="Why it&apos;s safe (and trustless)">
        <p>
          When the buyer pays, the money doesn&apos;t go to the seller — it goes into a smart
          contract (an automated escrow) that <b className="text-zinc-200">no one</b>, not even
          us, can touch. It only moves when:
        </p>
        <ul className="mt-3 space-y-2">
          <Bullet>the buyer confirms in person (→ the seller is paid), or</Bullet>
          <Bullet>the rules above say it should be refunded.</Bullet>
        </ul>
        <p className="mt-3">
          Settlement is final the instant it happens — no chargebacks, no bounced payments, no
          counterfeit cash. And because the seller can verify the locked funds before traveling,
          a buyer can&apos;t waste their time. None of this requires trusting the other person —
          only the code, which is public and verifiable.
        </p>
      </Section>

      <Section title="Meeting safely">
        <ul className="space-y-2">
          <Bullet>Meet in a busy public place in daylight — many police stations have “exchange zones.”</Bullet>
          <Bullet>Inspect the item fully before you tap release. Once released, payment is final.</Bullet>
          <Bullet>Sellers: tap “Check in” when you arrive — it proves you showed up.</Bullet>
        </ul>
      </Section>

      <Section title="FAQ">
        <Faq q="Do I need to know anything about crypto?">
          No. You sign in with your email and a wallet is created for you. Balances are shown in
          dollars.
        </Faq>
        <Faq q="What if the item isn’t as described?">
          Don&apos;t tap release. You inspect before paying, so you keep your money and walk away.
        </Faq>
        <Faq q="What if the other person doesn’t show?">
          If the seller no-shows, you get your full payment back. If a buyer flakes after the
          seller arrived, the small deposit compensates the seller.
        </Faq>
        <Faq q="Can the payment be reversed later?">
          No. Once released in person, it&apos;s final — that&apos;s the point.
        </Faq>
        <Faq q="Who holds my money before the meet?">
          A public smart contract — not the seller and not inSync. It can only pay out by the
          rules above.
        </Faq>
        <Faq q="Why doesn’t it make me sign a bunch of times to log in?">
          Signing in just connects your wallet — we don&apos;t ask for an extra
          &ldquo;login&rdquo; signature. You only approve a signature when you actually do
          something on-chain (lock payment, check in, release), and each of those is a single,
          necessary step.
        </Faq>
      </Section>

      <Section title="Architecture — how it's built">
        <p>
          inSync is a small monorepo: a Solidity escrow on Base, a Next.js app, a Fastify
          backend for off-chain details (photos, the meet spot, live location), and a Chainlink
          keeper. Sponsor tech slots in at the labelled points.
        </p>
        <Pre>{ARCHITECTURE}</Pre>
      </Section>

      <Section title="The trade, step by step (under the hood)">
        <Pre>{FLOW}</Pre>
      </Section>

      <Section title="How each technology is used (and why)">
        <Tech name="Dynamic — wallets &amp; login">
          Email sign-in mints an embedded wallet (no seed phrase) and signs every escrow tx.{' '}
          <b className="text-zinc-200">Why:</b> ordinary buyers and sellers aren&apos;t crypto
          users — without it, onboarding a stranger to an on-chain escrow is a non-starter.
        </Tech>
        <Tech name="Blink — one-tap funding">
          Pulls USDC into the buyer&apos;s wallet in a single tap, then funds the escrow.{' '}
          <b className="text-zinc-200">Why:</b> getting money into the deal without a detour to an
          exchange or bridge is exactly where consumer flows usually die.
        </Tech>
        <Tech name="Chainlink CRE — trustless auto-refunds">
          A keeper workflow watches for deals that expired without completing and calls the
          contract to refund them. <b className="text-zinc-200">Why:</b> locked money can&apos;t
          sit forever, and a refund can&apos;t depend on our server without reintroducing trust.
        </Tech>
        <Tech name="Chainlink Data Streams — pay in any token">
          At release, a verified price report lets a buyer pay in a volatile token while the
          seller still receives the exact agreed dollar value.{' '}
          <b className="text-zinc-200">Why:</b> prices drift between committing and meeting; this
          removes that risk, trustlessly.
        </Tech>
        <Tech name="Base + USDC">
          An L2 with cheap, instant, final settlement — what makes sub-cent-fee in-person
          payments practical.
        </Tech>
        <p className="mt-3">
          Escrow contract:{' '}
          <a
            className="font-mono text-xs text-indigo-300 underline"
            href={`https://sepolia.basescan.org/address/${ESCROW}`}
            target="_blank"
            rel="noreferrer"
          >
            {ESCROW} ↗
          </a>
        </p>
      </Section>

      <div className="flex gap-3">
        <Link href="/sell" className="btn-primary">Sell an item</Link>
        <Link href="/buy" className="btn-secondary">Buy an item</Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
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
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-indigo-400">•</span>
      <span>{children}</span>
    </li>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="surface">
      <div className="font-medium text-zinc-100">{q}</div>
      <div className="mt-1 text-sm text-zinc-400">{children}</div>
    </div>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-950 p-3 text-[11px] leading-snug text-zinc-300">
      {children}
    </pre>
  );
}

function Tech({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="surface">
      <div className="font-medium text-zinc-100">{name}</div>
      <div className="mt-1 text-sm text-zinc-400">{children}</div>
    </div>
  );
}

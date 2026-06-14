import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import Providers from '@/components/Providers';
import Nav from '@/components/Nav';

const ESCROW = '0xaA2A7D734a1d10BB60e08fE306474687266cb38F';

export const metadata: Metadata = {
  title: 'SafeSwap — trustless in-person escrow',
  description:
    'Buy from strangers safely: funds lock before anyone travels, and release only at the in-person handoff. Final, chargeback-free.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-md px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-md px-4 pb-10 pt-2 text-center text-xs text-zinc-500">
            <div className="flex justify-center gap-4">
              <Link href="/docs" className="hover:text-zinc-300">
                How it works
              </Link>
              <a
                href={`https://sepolia.basescan.org/address/${ESCROW}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-300"
              >
                Contract ↗
              </a>
            </div>
            <div className="mt-2">SafeSwap · trustless in-person trades, settled on Base.</div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

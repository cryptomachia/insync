import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import Providers from '@/components/Providers';
import Nav from '@/components/Nav';

const ESCROW = '0xb6c4C1B841C558280783979BA76009a4F3024410';

export const metadata: Metadata = {
  title: 'inSync — trustless in-person escrow',
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
          <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
          <footer className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 text-center text-xs text-zinc-500 sm:px-6 lg:px-8">
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
            <div className="mt-2">inSync · trustless in-person trades, settled on Base.</div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

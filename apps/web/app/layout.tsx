import type { Metadata, Viewport } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Handoff — trustless in-person escrow',
  description:
    'Buy from strangers safely: funds lock before anyone travels, and release only at the in-person handoff. Final, chargeback-free.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
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
        </Providers>
      </body>
    </html>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

/**
 * A scannable QR for the listing link plus copy / native share-sheet actions, so a seller
 * can hand the buyer the listing in person (scan) or send it (share/copy).
 */
export default function ShareListing({ url, title }: { url: string; title?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#0a0a0a', light: '#ffffff' },
      }).catch(() => {});
    }
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function share() {
    try {
      await navigator.share({ title: title ?? 'inSync listing', text: 'Buy this on inSync', url });
    } catch {
      /* user cancelled / unsupported */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <canvas ref={canvasRef} className="rounded-xl bg-white p-2" aria-label="listing QR code" />
      </div>
      <p className="text-center text-xs text-zinc-500">Buyer scans this to open the listing</p>
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {canShare && (
          <button className="btn-secondary" onClick={share}>
            Share…
          </button>
        )}
      </div>
    </div>
  );
}

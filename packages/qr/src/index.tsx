// STUB (foundation). AGENT 7 replaces with real QR generation (qrcode) + camera scan
// (html5-qrcode). Keep these exact exports (SPEC §9). Stub uses a paste fallback.
import React, { useState } from 'react';

export function encodeHandoff(p: { dealId: bigint; nonce: string }): string {
  const json = JSON.stringify({ dealId: p.dealId.toString(), nonce: p.nonce });
  return typeof btoa !== 'undefined' ? btoa(json) : Buffer.from(json).toString('base64');
}

export function decodeHandoff(s: string): { dealId: bigint; nonce: string } {
  const json = typeof atob !== 'undefined' ? atob(s) : Buffer.from(s, 'base64').toString();
  const o = JSON.parse(json);
  return { dealId: BigInt(o.dealId), nonce: String(o.nonce) };
}

export function ReleaseQR({ dealId }: { dealId: bigint }) {
  const code = encodeHandoff({ dealId, nonce: 'mock' });
  return (
    <div>
      <div>Show this to the buyer:</div>
      <pre>{code}</pre>
    </div>
  );
}

export function ScanToRelease({
  onScan,
  onError,
}: {
  onScan: (p: { dealId: bigint }) => void;
  onError?: (e: unknown) => void;
}) {
  const [v, setV] = useState('');
  return (
    <div>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="paste handoff code" />
      <button
        onClick={() => {
          try {
            onScan(decodeHandoff(v));
          } catch (e) {
            onError?.(e);
          }
        }}
      >
        Release
      </button>
    </div>
  );
}

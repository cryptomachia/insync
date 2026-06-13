'use client';

// @handoff/qr — the in-person release UX (SPEC §9).
// Seller shows a one-time QR encoding { dealId, nonce }; buyer scans it (camera) — or
// pastes the code on desktop — and the app wires the result into confirmReceipt.
//
// Pure UI module: NO chain calls happen here. ScanToRelease only decodes the payload and
// hands { dealId } back to the caller (apps/web does confirmReceipt).
//
// Frozen exports (do not change signatures):
//   ReleaseQR({ dealId })
//   ScanToRelease({ onScan, onError })
//   encodeHandoff({ dealId, nonce }): string
//   decodeHandoff(string): { dealId, nonce }

import React, { useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

// ---------------------------------------------------------------------------
// Payload encode / decode
// ---------------------------------------------------------------------------
//
// We base64url-encode a compact JSON object. A short version tag ("v") lets us evolve the
// format later without silently mis-decoding old codes. bigint is carried as a decimal
// string (JSON can't represent bigint) and rehydrated with BigInt() on decode.

const HANDOFF_VERSION = 1;

interface WireShape {
  v: number;
  dealId: string;
  nonce: string;
}

function toBase64Url(json: string): string {
  const b64 =
    typeof btoa !== 'undefined'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob !== 'undefined') {
    return decodeURIComponent(escape(atob(b64)));
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export function encodeHandoff(p: { dealId: bigint; nonce: string }): string {
  if (typeof p.dealId !== 'bigint') {
    throw new TypeError('encodeHandoff: dealId must be a bigint');
  }
  if (typeof p.nonce !== 'string') {
    throw new TypeError('encodeHandoff: nonce must be a string');
  }
  const wire: WireShape = {
    v: HANDOFF_VERSION,
    dealId: p.dealId.toString(),
    nonce: p.nonce,
  };
  return toBase64Url(JSON.stringify(wire));
}

export function decodeHandoff(s: string): { dealId: bigint; nonce: string } {
  if (typeof s !== 'string' || s.trim() === '') {
    throw new Error('decodeHandoff: empty handoff code');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(s.trim()));
  } catch {
    throw new Error('decodeHandoff: not a valid handoff code');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('decodeHandoff: malformed handoff payload');
  }
  const o = parsed as Record<string, unknown>;
  if (o.dealId === undefined || o.dealId === null) {
    throw new Error('decodeHandoff: missing dealId');
  }
  let dealId: bigint;
  try {
    dealId = BigInt(o.dealId as string | number);
  } catch {
    throw new Error('decodeHandoff: dealId is not a valid integer');
  }
  const nonce = o.nonce === undefined || o.nonce === null ? '' : String(o.nonce);
  return { dealId, nonce };
}

// A one-time nonce for the seller's QR. Not a security boundary on its own (the chain is the
// source of truth) — it just makes each rendered code unique so a stale screenshot is
// visibly different. Caller may also pass a signed nonce in future without changing the API.
function freshNonce(): string {
  try {
    const g: typeof globalThis & { crypto?: Crypto } = globalThis;
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
    if (g.crypto?.getRandomValues) {
      const a = new Uint8Array(16);
      g.crypto.getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ---------------------------------------------------------------------------
// ReleaseQR — seller side
// ---------------------------------------------------------------------------

export function ReleaseQR({ dealId }: { dealId: bigint }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [code, setCode] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);

  // Compute the encoded payload once per dealId (with a fresh nonce).
  useEffect(() => {
    try {
      setCode(encodeHandoff({ dealId, nonce: freshNonce() }));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to build handoff code');
    }
  }, [dealId]);

  // Draw the QR onto the canvas whenever the code changes.
  useEffect(() => {
    if (!code || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, code, {
      width: 256,
      margin: 2,
      errorCorrectionLevel: 'M',
    }).catch((e: unknown) => {
      setErr(e instanceof Error ? e.message : 'failed to render QR');
    });
  }, [code]);

  return (
    <div style={styles.wrap}>
      <div style={styles.label}>Show this to the buyer to release</div>
      {err ? (
        <div style={styles.error}>QR error: {err}</div>
      ) : (
        <canvas ref={canvasRef} style={styles.canvas} aria-label="handoff QR code" />
      )}
      <div style={styles.dealMeta}>Deal #{dealId.toString()}</div>
      {/* Plain-text fallback so a desktop buyer can copy the code if the camera path fails. */}
      {code ? (
        <details style={styles.details}>
          <summary style={styles.summary}>Show code as text</summary>
          <code style={styles.codeText}>{code}</code>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScanToRelease — buyer side
// ---------------------------------------------------------------------------

export function ScanToRelease({
  onScan,
  onError,
}: {
  onScan: (p: { dealId: bigint }) => void;
  onError?: (e: unknown) => void;
}): JSX.Element {
  const regionId = `handoff-scan-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef(false); // one-shot: ignore repeated frames after a good decode

  const [scanning, setScanning] = useState(false);
  const [pasteVal, setPasteVal] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const report = (e: unknown) => {
    setStatus(e instanceof Error ? e.message : String(e));
    onError?.(e);
  };

  const stopCamera = async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (!inst) return;
    try {
      await inst.stop();
    } catch {
      /* already stopped */
    }
    try {
      inst.clear();
    } catch {
      /* ignore */
    }
  };

  const accept = (raw: string) => {
    if (handledRef.current) return;
    let decoded: { dealId: bigint };
    try {
      decoded = decodeHandoff(raw);
    } catch (e) {
      report(e);
      return;
    }
    handledRef.current = true;
    setStatus(`Read deal #${decoded.dealId.toString()}`);
    // Stop the camera before handing control back (best-effort).
    void stopCamera();
    onScan(decoded);
  };

  const startCamera = async () => {
    if (scannerRef.current) return;
    handledRef.current = false;
    setStatus(null);
    try {
      const inst = new Html5Qrcode(regionId, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      });
      scannerRef.current = inst;
      setScanning(true);
      await inst.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => accept(text),
        () => {
          /* per-frame decode misses are normal; ignore */
        },
      );
    } catch (e) {
      scannerRef.current = null;
      setScanning(false);
      report(e);
    }
  };

  // Clean up the camera if the component unmounts mid-scan.
  useEffect(() => {
    return () => {
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (inst) {
        inst.stop().catch(() => undefined);
      }
    };
  }, []);

  return (
    <div style={styles.wrap}>
      <div style={styles.label}>Scan the seller&apos;s QR to release</div>

      {/* html5-qrcode renders the video into this element. */}
      <div id={regionId} style={scanning ? styles.scanRegion : styles.scanRegionHidden} />

      {scanning ? (
        <button type="button" style={styles.buttonSecondary} onClick={() => void stopCamera()}>
          Stop camera
        </button>
      ) : (
        <button type="button" style={styles.button} onClick={() => void startCamera()}>
          Start camera scan
        </button>
      )}

      {/* Desktop / no-camera fallback: paste the code. */}
      <div style={styles.fallback}>
        <div style={styles.fallbackLabel}>No camera? Paste the code:</div>
        <input
          style={styles.input}
          value={pasteVal}
          onChange={(e) => setPasteVal(e.target.value)}
          placeholder="paste handoff code"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button
          type="button"
          style={styles.button}
          disabled={pasteVal.trim() === ''}
          onClick={() => accept(pasteVal)}
        >
          Release
        </button>
      </div>

      {status ? <div style={styles.status}>{status}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles (no Tailwind dependency in this standalone package)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
  },
  label: { fontSize: 15, fontWeight: 600, textAlign: 'center' },
  canvas: { width: 256, height: 256, borderRadius: 8 },
  dealMeta: { fontSize: 12, color: '#666' },
  details: { width: '100%', maxWidth: 320 },
  summary: { fontSize: 12, color: '#555', cursor: 'pointer' },
  codeText: { display: 'block', wordBreak: 'break-all', fontSize: 11, color: '#333', marginTop: 6 },
  scanRegion: { width: '100%', maxWidth: 320, borderRadius: 8, overflow: 'hidden' },
  scanRegionHidden: { width: 0, height: 0, overflow: 'hidden' },
  fallback: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    width: '100%',
    maxWidth: 320,
    marginTop: 8,
  },
  fallbackLabel: { fontSize: 12, color: '#666' },
  input: {
    padding: '8px 10px',
    fontSize: 14,
    border: '1px solid #ccc',
    borderRadius: 6,
    width: '100%',
    boxSizing: 'border-box',
  },
  button: {
    padding: '10px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: '#111',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  buttonSecondary: {
    padding: '10px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: '#111',
    background: '#eee',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  status: { fontSize: 12, color: '#444', textAlign: 'center' },
  error: { fontSize: 13, color: '#b00020', textAlign: 'center' },
};

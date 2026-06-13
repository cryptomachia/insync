// Blink merchant signer endpoint (SPEC: docs.blink.cash/integration/signer-endpoint).
// The @swype-org/deposit SDK POSTs the deposit request here; we build the canonical
// payload, base64url-encode it, sign it with ECDSA P-256 + SHA-256 using the merchant
// private key, and return the auth envelope. The private key NEVER leaves the server.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createSign } from 'node:crypto';

export const runtime = 'nodejs'; // node:crypto required

const MERCHANT_ID =
  process.env.BLINK_MERCHANT_ID || process.env.NEXT_PUBLIC_BLINK_MERCHANT_ID || '';

function privateKeyPem(): string {
  const b64 = process.env.MERCHANT_PRIVATE_KEY_B64;
  if (b64) return Buffer.from(b64, 'base64').toString('utf8');
  const pem = process.env.MERCHANT_PRIVATE_KEY;
  if (pem) return pem.replace(/\\n/g, '\n');
  throw new Error('MERCHANT_PRIVATE_KEY_B64 / MERCHANT_PRIVATE_KEY not configured');
}

const b64url = (v: string) => Buffer.from(v, 'utf8').toString('base64url');

function sign(payload: string, pem: string): string {
  const s = createSign('SHA256');
  s.update(payload);
  s.end();
  return s.sign(pem).toString('base64url');
}

function validate(b: any): string[] {
  const e: string[] = [];
  if (!Number.isFinite(b?.amount) || b.amount <= 0) e.push('amount must be a positive number.');
  if (!Number.isInteger(b?.chainId) || b.chainId <= 0) e.push('chainId must be a positive integer.');
  if (typeof b?.address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(b.address))
    e.push('address must be a 0x-prefixed 40-char hex string.');
  if (typeof b?.token !== 'string' || !/^0x[a-fA-F0-9]{1,40}$/.test(b.token))
    e.push('token must be a 0x-prefixed hex contract address.');
  if (
    b?.callbackScheme != null &&
    (typeof b.callbackScheme !== 'string' || !/^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(b.callbackScheme))
  )
    e.push('callbackScheme must be null or a valid URI scheme.');
  return e;
}

// PRODUCTION HARDENING (per docs.blink.cash/integration/signer-endpoint):
// This route is intentionally OPEN for the hackathon demo. Before any real-money
// deployment it MUST be locked down so it can only mint a signed deposit envelope
// for a legitimate, authenticated caller. Minimum bar:
//   1. AUTHENTICATE the caller — require a session/JWT from the logged-in Dynamic
//      user; reject anonymous requests.
//   2. VERIFY ADDRESS OWNERSHIP — confirm `body.address` belongs to that
//      authenticated user (a signed challenge or the session's wallet), so a caller
//      can't have funds signed toward an address they don't control.
//   3. RATE-LIMIT / replay-protect per user+IP (the idempotencyKey is generated
//      server-side here, but throttling still matters) to stop signing-oracle abuse.
//   4. PIN allowed chainId(s)/token(s) to your deployment instead of accepting any.
// The merchant private key (MERCHANT_PRIVATE_KEY_B64) is read server-side only and
// never leaves this route — keep it that way.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const errors = validate(body);
  if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 400 });

  const { amount, chainId, address, token, callbackScheme = null, version = 'v1' } = body;
  const idempotencyKey = randomUUID();
  const signatureTimestamp = new Date().toISOString();

  // Field order is part of the signed contract — do not reorder.
  const payloadObject = {
    amount,
    chainId,
    address,
    token,
    idempotencyKey,
    callbackScheme,
    signatureTimestamp,
    version,
  };

  let payload: string;
  let signature: string;
  try {
    payload = b64url(JSON.stringify(payloadObject));
    signature = sign(payload, privateKeyPem());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'signing failed' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      merchantId: MERCHANT_ID,
      payload,
      signature,
      preview: { amount, chainId, address, token, idempotencyKey },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

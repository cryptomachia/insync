// Denomination helpers. SPEC §3:
//   priceUsd1e8 = USD * 1e8   ($80.00 = 80_00000000)
//   depositBps  = basis points of price (1000 = 10%)
//   USDC has 6 decimals -> usdcAmount = priceUsd1e8 / 100
import { getAddresses } from '@handoff/contracts-abi';

export const USD_1E8 = 100_000_000n; // 1e8

/** Format a priceUsd1e8 bigint as a "$80.00" string. */
export function fmtUsd1e8(v: bigint): string {
  const dollars = Number(v) / 1e8;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Parse a "80" or "80.50" user string into priceUsd1e8 bigint. */
export function parseUsdToUsd1e8(input: string): bigint {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 1e8));
}

/** Deposit portion in USD-1e8 from price + bps. */
export function depositUsd1e8(priceUsd1e8: bigint, depositBps: number): bigint {
  return (priceUsd1e8 * BigInt(depositBps)) / 10_000n;
}

/** Total held = price + deposit, in USD-1e8. */
export function totalUsd1e8(priceUsd1e8: bigint, depositBps: number): bigint {
  return priceUsd1e8 + depositUsd1e8(priceUsd1e8, depositBps);
}

/** USDC (6dp) token amount for a USD-1e8 value. */
export function usd1e8ToUsdc(v: bigint): bigint {
  return v / 100n;
}

/** Is this payToken the configured stable (USDC)? Stable => no Data Streams report needed. */
export function isStableToken(payToken: string): boolean {
  const { usdc } = getAddresses();
  if (!usdc) return true; // default-safe: treat as stable when unconfigured
  return payToken.toLowerCase() === usdc.toLowerCase();
}

/** Short 0x… address for display. */
export function shortAddr(a?: string): string {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

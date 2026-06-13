// @handoff/datastreams — Chainlink Data Streams client (SPEC §6).
//
// Purpose: fetch a signed Chainlink Data Streams report for a feed and produce the
// `bytes` blob passed to Escrow.confirmReceipt/buyerCancel/reclaimExpired, plus a
// price helper for the UI.
//
// LIVE mode:
//   - getReport(feedId) fetches a signed report from the Data Streams REST API
//     (HMAC-authenticated) and returns the raw `fullReport` bytes (0x...) which the
//     on-chain Verifier proxy verifies.
//   - getTokenPriceUsd1e8(feedId) ABI-decodes the report and returns the price in
//     8-decimal USD (Data Streams v3 prices are 18-decimal; we scale 1e18 -> 1e8).
//
// MOCK mode (MOCK=true / NEXT_PUBLIC_MOCK=true): matches the contract's MockVerifier:
//   - getReport returns '0x'  (the MockVerifier accepts empty bytes)
//   - getTokenPriceUsd1e8 returns 4000_00000000 ($4000)
//
// Frozen exports (SPEC §6): getReport, getTokenPriceUsd1e8, FEEDS, MOCK.

import {
  buildAuthHeaders,
  decodeReportPriceUsd1e8,
  extractFullReport,
  type DataStreamsConfig,
} from './client.js';

// Server-side env for the LIVE path only. These are non-NEXT_PUBLIC secrets
// (CHAINLINK_DATASTREAMS_API_KEY/SECRET, DATASTREAMS_API_HOST) that must never be
// inlined into a client bundle — they stay undefined client-side, which is correct
// because the LIVE path is never reached in the browser (MOCK short-circuits it).
const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

/**
 * True when running in mock mode (no live Data Streams account needed).
 *
 * This package is transpiled into apps/web (buy page + lib/tx.ts import it), so the
 * NEXT_PUBLIC_MOCK / MOCK reads MUST be LITERAL `process.env.X` member expressions:
 * Next only inlines those into the browser bundle. A dynamic `env[name]` lookup is not
 * statically replaced, so it reads undefined client-side and the live REST path would
 * be attempted in the browser.
 */
export const MOCK: boolean =
  process.env.NEXT_PUBLIC_MOCK === 'true' || process.env.MOCK === 'true';

// Mock constants — must match contracts/MockVerifier (SPEC §6).
const MOCK_REPORT: `0x${string}` = '0x';
const MOCK_PRICE_USD_1E8: bigint = 4000n * 10n ** 8n; // $4000.00000000

/**
 * Chainlink Data Streams feed IDs (v3 crypto schema, leading 0x0003 = schema v3).
 *
 * These are the canonical Data Streams **testnet** stream IDs (work across Chainlink
 * testnets incl. Arbitrum/Base Sepolia via the testnet aggregation network at
 * api.testnet-dataengine.chain.link). For mainnet, swap in the mainnet stream IDs
 * from https://docs.chain.link/data-streams/crypto-streams and point
 * DATASTREAMS_API_HOST at api.dataengine.chain.link.
 *
 * VERIFY each ID against the docs before any mainnet/testnet money flow.
 */
export const FEEDS: Record<string, string> = {
  // ETH/USD — verified testnet stream ID.
  'ETH/USD':
    '0x000359843a543ee2fe414dc14c7e7920ef10f4372990b79d6361cdc0dd1ba782',
  // BTC/USD — testnet stream ID (verify before use).
  'BTC/USD':
    '0x00039d9e45394f473ab1f050a1b963e6b05351e52d71e507509ada0c95ed75b8',
  // LINK/USD — testnet stream ID (verify before use).
  'LINK/USD':
    '0x00036fe43f87884450b4c7e093cd5ed99cac6640d8c2000e6afc02c8838d0265',
};

// Default REST hosts (overridable via env for mainnet).
const TESTNET_HOST = 'https://api.testnet-dataengine.chain.link';

function resolveFeedId(feedId: string): string {
  // Accept either a symbol ('ETH/USD') or a raw 0x feed id.
  if (feedId.startsWith('0x')) return feedId;
  const id = FEEDS[feedId];
  if (!id) {
    throw new Error(
      `Unknown feed "${feedId}". Pass a known symbol (${Object.keys(FEEDS).join(
        ', ',
      )}) or a 0x feed id.`,
    );
  }
  return id;
}

function liveConfig(): DataStreamsConfig {
  const apiKey = env.CHAINLINK_DATASTREAMS_API_KEY;
  const apiSecret = env.CHAINLINK_DATASTREAMS_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'Live Data Streams requires CHAINLINK_DATASTREAMS_API_KEY and ' +
        'CHAINLINK_DATASTREAMS_API_SECRET (or set MOCK=true).',
    );
  }
  return {
    apiKey,
    apiSecret,
    host: env.DATASTREAMS_API_HOST || TESTNET_HOST,
  };
}

/**
 * Fetch the latest signed report's raw `fullReport` bytes for `feedId`.
 * The returned blob is passed verbatim into the Escrow's verify-and-settle calls;
 * the on-chain Verifier proxy verifies the DON signatures inside it.
 *
 * @param feedId symbol ('ETH/USD') or raw 0x feed id
 * @returns 0x-prefixed raw report bytes (or '0x' in mock mode)
 */
export async function getReport(feedId: string): Promise<`0x${string}`> {
  if (MOCK) return MOCK_REPORT;

  const cfg = liveConfig();
  const id = resolveFeedId(feedId);
  const path = `/api/v1/reports/latest?feedID=${id}`;
  const url = `${cfg.host}${path}`;

  const headers = await buildAuthHeaders({
    method: 'GET',
    path,
    body: '',
    apiKey: cfg.apiKey,
    apiSecret: cfg.apiSecret,
  });

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Data Streams request failed: ${res.status} ${res.statusText} ${text}`,
    );
  }
  const json = (await res.json()) as {
    report?: { fullReport?: string; feedID?: string };
  };
  const full = json?.report?.fullReport;
  if (!full || typeof full !== 'string') {
    throw new Error('Data Streams response missing report.fullReport');
  }
  return extractFullReport(full);
}

/**
 * Return the token's USD price for `feedId` with 8 decimals (for UI estimates).
 * Live: fetch + ABI-decode the v3 report (18-decimal price) and scale to 1e8.
 * Mock: fixed $4000.
 *
 * @param feedId symbol ('ETH/USD') or raw 0x feed id
 */
export async function getTokenPriceUsd1e8(feedId: string): Promise<bigint> {
  if (MOCK) return MOCK_PRICE_USD_1E8;
  const report = await getReport(feedId);
  return decodeReportPriceUsd1e8(report);
}

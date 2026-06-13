// Low-level Data Streams helpers: HMAC auth + report blob encode/decode.
// Kept separate from index.ts so they're unit-testable without network or env.

import { createHash, createHmac } from 'node:crypto';
import { decodeAbiParameters, type Hex } from 'viem';

export interface DataStreamsConfig {
  apiKey: string;
  apiSecret: string;
  host: string; // e.g. https://api.testnet-dataengine.chain.link
}

export interface AuthArgs {
  method: string; // 'GET' | 'POST' ...
  path: string; // path + query, e.g. /api/v1/reports/latest?feedID=0x..
  body: string; // request body ('' for GET)
  apiKey: string;
  apiSecret: string;
  /** Override the millisecond timestamp (tests only). */
  timestampMs?: number;
}

/**
 * Compute the Data Streams HMAC signature.
 *
 * Per the docs, the string-to-sign is the following five parts joined by a single
 * space: `METHOD PATH BODY_SHA256_HEX API_KEY TIMESTAMP_MS`, then HMAC-SHA256 with
 * the API secret, hex-encoded. The body hash is the hex SHA-256 of the raw body
 * (empty string for GET).
 */
export function generateHmac(args: {
  method: string;
  path: string;
  body: string;
  apiKey: string;
  apiSecret: string;
  timestampMs: number;
}): string {
  const { method, path, body, apiKey, apiSecret, timestampMs } = args;
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const stringToSign = `${method.toUpperCase()} ${path} ${bodyHash} ${apiKey} ${timestampMs}`;
  return createHmac('sha256', apiSecret).update(stringToSign).digest('hex');
}

/** Build the three required Data Streams auth headers. */
export function buildAuthHeaders(args: AuthArgs): Record<string, string> {
  const timestampMs = args.timestampMs ?? Date.now();
  const signature = generateHmac({
    method: args.method,
    path: args.path,
    body: args.body,
    apiKey: args.apiKey,
    apiSecret: args.apiSecret,
    timestampMs,
  });
  return {
    Authorization: args.apiKey,
    'X-Authorization-Timestamp': String(timestampMs),
    'X-Authorization-Signature-SHA256': signature,
  };
}

/** Normalize an API `fullReport` string to a 0x-prefixed lowercase hex blob. */
export function extractFullReport(fullReport: string): Hex {
  const hex = fullReport.startsWith('0x') ? fullReport : `0x${fullReport}`;
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('fullReport is not valid hex');
  }
  return hex.toLowerCase() as Hex;
}

// Data Streams v3 (crypto) report schema. The fullReport blob ABI-decodes as
// (bytes32[3] reportContext, bytes reportData, ...); reportData ABI-decodes into
// these fields. Prices use 18 decimals for crypto streams.
const V3_REPORT_FIELDS = [
  { name: 'feedId', type: 'bytes32' },
  { name: 'validFromTimestamp', type: 'uint32' },
  { name: 'observationsTimestamp', type: 'uint32' },
  { name: 'nativeFee', type: 'uint192' },
  { name: 'linkFee', type: 'uint192' },
  { name: 'expiresAt', type: 'uint32' },
  { name: 'price', type: 'int192' },
  { name: 'bid', type: 'int192' },
  { name: 'ask', type: 'int192' },
] as const;

const FULL_REPORT_WRAPPER = [
  { name: 'reportContext', type: 'bytes32[3]' },
  { name: 'reportData', type: 'bytes' },
  { name: 'rawRs', type: 'bytes32[]' },
  { name: 'rawSs', type: 'bytes32[]' },
  { name: 'rawVs', type: 'bytes32' },
] as const;

export interface DecodedV3Report {
  feedId: Hex;
  validFromTimestamp: number;
  observationsTimestamp: number;
  expiresAt: number;
  price: bigint; // 18 decimals
  bid: bigint;
  ask: bigint;
}

/**
 * Decode a raw `fullReport` blob into the v3 report fields.
 * Unwraps the (reportContext, reportData, ...) envelope, then decodes reportData.
 */
export function decodeFullReport(fullReport: Hex): DecodedV3Report {
  const [, reportData] = decodeAbiParameters(FULL_REPORT_WRAPPER, fullReport) as [
    readonly [Hex, Hex, Hex],
    Hex,
    readonly Hex[],
    readonly Hex[],
    Hex,
  ];
  return decodeReportData(reportData);
}

/** Decode just the inner reportData bytes into the v3 fields. */
export function decodeReportData(reportData: Hex): DecodedV3Report {
  const d = decodeAbiParameters(V3_REPORT_FIELDS, reportData);
  return {
    feedId: d[0] as Hex,
    validFromTimestamp: Number(d[1]),
    observationsTimestamp: Number(d[2]),
    expiresAt: Number(d[5]),
    price: d[6] as bigint,
    bid: d[7] as bigint,
    ask: d[8] as bigint,
  };
}

const V3_PRICE_DECIMALS = 18n;
const TARGET_DECIMALS = 8n;
const SCALE_DOWN = 10n ** (V3_PRICE_DECIMALS - TARGET_DECIMALS); // 1e10

/** Convert an 18-decimal v3 price to 8-decimal USD. Negative prices clamp to 0. */
export function scalePrice1e18To1e8(price1e18: bigint): bigint {
  if (price1e18 <= 0n) return 0n;
  return price1e18 / SCALE_DOWN;
}

/** Decode a full report blob and return its price as 8-decimal USD. */
export function decodeReportPriceUsd1e8(fullReport: Hex): bigint {
  const { price } = decodeFullReport(fullReport);
  return scalePrice1e18To1e8(price);
}

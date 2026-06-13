import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { encodeAbiParameters, type Hex } from 'viem';

import {
  generateHmac,
  buildAuthHeaders,
  extractFullReport,
  decodeReportData,
  decodeFullReport,
  decodeReportPriceUsd1e8,
  scalePrice1e18To1e8,
} from '../src/client.js';

// ---------------------------------------------------------------------------
// Mock-mode behavior. The MOCK env must be set before importing index.ts, so we
// import it dynamically after setting the flag.
// ---------------------------------------------------------------------------
test('mock mode: getReport returns 0x and price returns $4000', async () => {
  process.env.MOCK = 'true';
  const mod = await import('../src/index.js');
  assert.equal(mod.MOCK, true);

  const report = await mod.getReport('ETH/USD');
  assert.equal(report, '0x', 'mock getReport must be empty bytes for MockVerifier');

  const price = await mod.getTokenPriceUsd1e8('ETH/USD');
  assert.equal(price, 4000n * 10n ** 8n, 'mock price must be $4000.00000000');

  // Mock path must not require a real feed id.
  assert.equal(await mod.getReport('anything'), '0x');
});

test('FEEDS contains ETH/USD as a v3 (0x0003) 32-byte feed id', async () => {
  const mod = await import('../src/index.js');
  const eth = mod.FEEDS['ETH/USD'];
  assert.ok(eth, 'ETH/USD feed must exist');
  assert.match(eth, /^0x0003[0-9a-fA-F]{60}$/, 'must be a 0x0003-prefixed bytes32');
});

// ---------------------------------------------------------------------------
// HMAC auth helper. Verified against the documented string-to-sign:
//   `METHOD PATH BODY_SHA256_HEX API_KEY TIMESTAMP` joined by single spaces,
//   HMAC-SHA256(secret), hex.
// ---------------------------------------------------------------------------
test('generateHmac is deterministic and matches the documented format', () => {
  const args = {
    method: 'GET',
    path: '/api/v1/reports/latest?feedID=0xabc',
    body: '',
    apiKey: 'my-key',
    apiSecret: 'my-secret',
    timestampMs: 1700000000000,
  };
  const sig1 = generateHmac(args);
  const sig2 = generateHmac(args);
  assert.equal(sig1, sig2, 'HMAC must be deterministic for fixed inputs');
  assert.match(sig1, /^[0-9a-f]{64}$/, 'HMAC-SHA256 hex is 64 chars');

  // Recompute independently to guard the exact concatenation order/format.
  const bodyHash = createHash('sha256').update('', 'utf8').digest('hex');
  const sts = `GET ${args.path} ${bodyHash} my-key 1700000000000`;
  const expected = createHmac('sha256', 'my-secret').update(sts).digest('hex');
  assert.equal(sig1, expected);
});

test('generateHmac changes when any input changes', () => {
  const base = {
    method: 'GET',
    path: '/api/v1/reports/latest?feedID=0xabc',
    body: '',
    apiKey: 'k',
    apiSecret: 's',
    timestampMs: 1,
  };
  const sig = generateHmac(base);
  assert.notEqual(sig, generateHmac({ ...base, timestampMs: 2 }));
  assert.notEqual(sig, generateHmac({ ...base, path: '/x' }));
  assert.notEqual(sig, generateHmac({ ...base, apiSecret: 's2' }));
  assert.notEqual(sig, generateHmac({ ...base, body: 'x' }));
});

test('buildAuthHeaders produces the three required headers', () => {
  const headers = buildAuthHeaders({
    method: 'GET',
    path: '/api/v1/reports/latest?feedID=0xabc',
    body: '',
    apiKey: 'my-key',
    apiSecret: 'my-secret',
    timestampMs: 1700000000000,
  });
  assert.equal(headers['Authorization'], 'my-key');
  assert.equal(headers['X-Authorization-Timestamp'], '1700000000000');
  assert.match(headers['X-Authorization-Signature-SHA256'], /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// Report blob parsing. We build a synthetic but schema-correct v3 fullReport and
// verify it round-trips through the decode helpers into an 8-decimal USD price.
// ---------------------------------------------------------------------------
function buildSyntheticFullReport(price1e18: bigint, feedId: Hex): Hex {
  const reportData = encodeAbiParameters(
    [
      { name: 'feedId', type: 'bytes32' },
      { name: 'validFromTimestamp', type: 'uint32' },
      { name: 'observationsTimestamp', type: 'uint32' },
      { name: 'nativeFee', type: 'uint192' },
      { name: 'linkFee', type: 'uint192' },
      { name: 'expiresAt', type: 'uint32' },
      { name: 'price', type: 'int192' },
      { name: 'bid', type: 'int192' },
      { name: 'ask', type: 'int192' },
    ],
    [feedId, 1000, 1001, 1n, 2n, 2000, price1e18, price1e18, price1e18],
  );
  return encodeAbiParameters(
    [
      { name: 'reportContext', type: 'bytes32[3]' },
      { name: 'reportData', type: 'bytes' },
      { name: 'rawRs', type: 'bytes32[]' },
      { name: 'rawSs', type: 'bytes32[]' },
      { name: 'rawVs', type: 'bytes32' },
    ],
    [
      [
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      ],
      reportData,
      [],
      [],
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    ],
  );
}

test('scalePrice1e18To1e8 converts decimals and clamps negatives', () => {
  assert.equal(scalePrice1e18To1e8(3257n * 10n ** 18n), 3257n * 10n ** 8n);
  // $3257.58 with 18 decimals -> 8 decimals.
  assert.equal(
    scalePrice1e18To1e8(3257579704051546000000n),
    325757970405n, // 3257.57970405 * 1e8
  );
  assert.equal(scalePrice1e18To1e8(0n), 0n);
  assert.equal(scalePrice1e18To1e8(-5n), 0n);
});

test('decodeFullReport + decodeReportPriceUsd1e8 parse a synthetic v3 report', () => {
  const feedId =
    '0x000359843a543ee2fe414dc14c7e7920ef10f4372990b79d6361cdc0dd1ba782' as Hex;
  const price1e18 = 4000n * 10n ** 18n;
  const blob = buildSyntheticFullReport(price1e18, feedId);

  const decoded = decodeFullReport(blob);
  assert.equal(decoded.feedId, feedId);
  assert.equal(decoded.price, price1e18);
  assert.equal(decoded.expiresAt, 2000);

  assert.equal(decodeReportPriceUsd1e8(blob), 4000n * 10n ** 8n);
});

test('decodeReportData decodes the inner blob directly', () => {
  const feedId =
    '0x000359843a543ee2fe414dc14c7e7920ef10f4372990b79d6361cdc0dd1ba782' as Hex;
  const inner = encodeAbiParameters(
    [
      { name: 'feedId', type: 'bytes32' },
      { name: 'validFromTimestamp', type: 'uint32' },
      { name: 'observationsTimestamp', type: 'uint32' },
      { name: 'nativeFee', type: 'uint192' },
      { name: 'linkFee', type: 'uint192' },
      { name: 'expiresAt', type: 'uint32' },
      { name: 'price', type: 'int192' },
      { name: 'bid', type: 'int192' },
      { name: 'ask', type: 'int192' },
    ],
    [feedId, 1, 2, 0n, 0n, 9, 12345n * 10n ** 10n, 0n, 0n],
  );
  const decoded = decodeReportData(inner);
  assert.equal(decoded.price, 12345n * 10n ** 10n);
  assert.equal(scalePrice1e18To1e8(decoded.price), 12345n);
});

test('extractFullReport normalizes and validates hex', () => {
  assert.equal(extractFullReport('0xABcd'), '0xabcd');
  assert.equal(extractFullReport('abCD'), '0xabcd');
  assert.throws(() => extractFullReport('0xzz'), /valid hex/);
});

// API route tests against a fresh temp sqlite per run. Uses node:test + app.inject (no
// network listen needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb, type HandoffDb } from '../src/db.ts';
import { buildApp } from '../src/app.ts';
import { DealState } from '@handoff/contracts-abi';
import type { FastifyInstance } from 'fastify';

const SELLER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const BUYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const USDC = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

const dbPath = join(tmpdir(), `handoff-test-${process.pid}-${Date.now()}.db`);
let db: HandoffDb;
let app: FastifyInstance;

before(async () => {
  db = openDb(dbPath);
  // Seed a listing and a funded deal.
  db.upsertListing({ listingId: 1n, seller: SELLER, priceUsd1e8: 8_000_000_000n, depositBps: 1000, payToken: USDC, active: true, block: 1n });
  db.upsertDealFromFunded({
    dealId: 1n, listingId: 1n, buyer: BUYER, seller: SELLER, payToken: USDC,
    tokenAmount: 88_000_000n, freeCancelUntil: 100n, expiry: 200n, block: 2n,
  });
  app = await buildApp({ db });
  await app.ready();
});

after(async () => {
  await app.close();
  db.close();
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
});

test('GET /health returns ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

test('GET /listings returns seeded listing', async () => {
  const res = await app.inject({ method: 'GET', url: '/listings' });
  assert.equal(res.statusCode, 200);
  const { listings } = res.json();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].listingId, '1');
  assert.equal(listings[0].depositBps, 1000);
  assert.equal(listings[0].active, true);
});

test('GET /deals?user filters by buyer or seller (case-insensitive)', async () => {
  const res = await app.inject({ method: 'GET', url: `/deals?user=${BUYER.toUpperCase()}` });
  assert.equal(res.statusCode, 200);
  const { deals } = res.json();
  assert.equal(deals.length, 1);
  assert.equal(deals[0].dealId, '1');
  assert.equal(deals[0].stateName, 'Funded');

  const none = await app.inject({ method: 'GET', url: '/deals?user=0x0000000000000000000000000000000000000000' });
  assert.equal(none.json().deals.length, 0);
});

test('GET /deals rejects malformed user address', async () => {
  const res = await app.inject({ method: 'GET', url: '/deals?user=not-an-address' });
  assert.equal(res.statusCode, 400);
});

test('GET /deals/:id returns deal + notifications, 404 for missing', async () => {
  const ok = await app.inject({ method: 'GET', url: '/deals/1' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().deal.dealId, '1');
  assert.ok(Array.isArray(ok.json().notifications));

  const missing = await app.inject({ method: 'GET', url: '/deals/999' });
  assert.equal(missing.statusCode, 404);

  const bad = await app.inject({ method: 'GET', url: '/deals/abc' });
  assert.equal(bad.statusCode, 400);
});

test('POST /notify stores a notification row and validates input', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/notify',
    payload: { dealId: 1, event: 'CheckedIn', payload: { from: 'cre' } },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.notification.deal_id, '1');
  assert.equal(body.notification.event, 'CheckedIn');

  // It should now appear on the deal detail.
  const detail = await app.inject({ method: 'GET', url: '/deals/1' });
  assert.ok(detail.json().notifications.some((n: { event: string }) => n.event === 'CheckedIn'));

  // Validation.
  const noEvent = await app.inject({ method: 'POST', url: '/notify', payload: { dealId: 1 } });
  assert.equal(noEvent.statusCode, 400);
  const noDeal = await app.inject({ method: 'POST', url: '/notify', payload: { event: 'X' } });
  assert.equal(noDeal.statusCode, 400);
});

test('state transition reflected via setDealState', async () => {
  db.setDealState(1n, DealState.Completed, { sellerPaid: 8_000_000_000n, buyerRefunded: 800_000_000n });
  const res = await app.inject({ method: 'GET', url: '/deals/1' });
  assert.equal(res.json().deal.stateName, 'Completed');
  assert.equal(res.json().deal.sellerPaid, '8000000000');
});

// Indexer mapping tests: feed decoded Escrow events through handleEvent and assert the DB
// mirror tracks the deal lifecycle. No chain required.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb, type HandoffDb } from '../src/db.ts';
import { handleEvent } from '../src/indexer.ts';

const SELLER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const BUYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const USDC = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

const dbPath = join(tmpdir(), `handoff-idx-${process.pid}-${Date.now()}.db`);
let db: HandoffDb;

before(() => {
  db = openDb(dbPath);
});
after(() => {
  db.close();
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
});

test('Listed creates an active listing', () => {
  handleEvent(db, {
    eventName: 'Listed',
    blockNumber: 10n,
    args: { listingId: 1n, seller: SELLER, priceUsd1e8: 8_000_000_000n, depositBps: 1000, payToken: USDC },
  });
  const listings = db.getListings();
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.active, 1);
});

test('Funded creates a deal and deactivates the listing', () => {
  handleEvent(db, {
    eventName: 'Funded',
    blockNumber: 11n,
    args: {
      dealId: 1n, listingId: 1n, buyer: BUYER, seller: SELLER, payToken: USDC,
      tokenAmount: 88_000_000n, freeCancelUntil: 100n, expiry: 200n,
    },
  });
  const deal = db.getDeal(1n);
  assert.ok(deal);
  assert.equal(deal!.state_name, 'Funded');
  assert.equal(deal!.buyer, BUYER);
  assert.equal(db.getListings()[0]!.active, 0);
});

test('CheckedIn -> Completed advances state with payout amounts', () => {
  handleEvent(db, { eventName: 'CheckedIn', blockNumber: 12n, args: { dealId: 1n } });
  assert.equal(db.getDeal(1n)!.state_name, 'SellerCheckedIn');
  assert.equal(db.getDeal(1n)!.seller_checked_in, 1);

  handleEvent(db, {
    eventName: 'Completed',
    blockNumber: 13n,
    args: { dealId: 1n, sellerPaid: 80_000_000n, buyerRefunded: 8_000_000n },
  });
  const deal = db.getDeal(1n)!;
  assert.equal(deal.state_name, 'Completed');
  assert.equal(deal.seller_paid, '80000000');
  assert.equal(deal.buyer_refunded, '8000000');
});

test('Refunded and Forfeited terminal states', () => {
  handleEvent(db, {
    eventName: 'Funded',
    blockNumber: 14n,
    args: {
      dealId: 2n, listingId: 1n, buyer: BUYER, seller: SELLER, payToken: USDC,
      tokenAmount: 88_000_000n, freeCancelUntil: 100n, expiry: 200n,
    },
  });
  handleEvent(db, { eventName: 'Refunded', blockNumber: 15n, args: { dealId: 2n, amount: 88_000_000n } });
  assert.equal(db.getDeal(2n)!.state_name, 'Refunded');

  handleEvent(db, {
    eventName: 'Funded',
    blockNumber: 16n,
    args: {
      dealId: 3n, listingId: 1n, buyer: BUYER, seller: SELLER, payToken: USDC,
      tokenAmount: 88_000_000n, freeCancelUntil: 100n, expiry: 200n,
    },
  });
  handleEvent(db, { eventName: 'Forfeited', blockNumber: 17n, args: { dealId: 3n, toBuyer: 80_000_000n, toSeller: 8_000_000n } });
  const f = db.getDeal(3n)!;
  assert.equal(f.state_name, 'Forfeited');
  assert.equal(f.buyer_refunded, '80000000');
  assert.equal(f.seller_paid, '8000000');
});

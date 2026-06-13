// Seed script: populates the sqlite DB with sample listings, deals, and notifications so the
// API returns realistic data with no chain/anvil running. Idempotent (upserts by id).
// Usage: npm run seed   (respects DATABASE_PATH; defaults to ./handoff.db)
import { loadConfig } from './env.ts';
import { openDb } from './db.ts';
import { DealState } from '@handoff/contracts-abi';

// Deterministic anvil-style addresses for the demo.
const SELLER = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const BUYER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const BUYER2 = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc';
const USDC = '0x5fbdb2315678afecb367f032d93f642f64180aa3';

function usd(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100)) * 1_000_000n; // dollars * 1e8
}
function usdc(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100)) * 10_000n; // dollars in USDC 6dp
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.databasePath);

  // Listings.
  db.upsertListing({ listingId: 1n, seller: SELLER, priceUsd1e8: usd(80), depositBps: 1000, payToken: USDC, active: true, block: 1n });
  db.upsertListing({ listingId: 2n, seller: SELLER, priceUsd1e8: usd(250), depositBps: 1500, payToken: USDC, active: true, block: 2n });
  db.upsertListing({ listingId: 3n, seller: BUYER2, priceUsd1e8: usd(45), depositBps: 500, payToken: USDC, active: false, block: 3n });

  // Deal 1 — funded then completed (happy path). Listing 3 is now inactive.
  db.upsertDealFromFunded({
    dealId: 1n, listingId: 3n, buyer: BUYER, seller: BUYER2, payToken: USDC,
    tokenAmount: usdc(47.25), freeCancelUntil: 1_900_000_000n, expiry: 1_900_100_000n, block: 4n,
  });
  db.setDealState(1n, DealState.SellerCheckedIn, { sellerCheckedIn: true });
  db.setDealState(1n, DealState.Completed, { sellerPaid: usdc(45), buyerRefunded: usdc(2.25) });

  // Deal 2 — funded, awaiting the meet (active).
  db.upsertDealFromFunded({
    dealId: 2n, listingId: 1n, buyer: BUYER2, seller: SELLER, payToken: USDC,
    tokenAmount: usdc(88), freeCancelUntil: 1_900_000_000n, expiry: 1_900_100_000n, block: 5n,
  });

  // Notifications for deal 2 (as CRE would post them).
  db.insertNotification({ dealId: 2n, event: 'Funded', payload: { source: 'seed' } });
  db.insertNotification({ dealId: 1n, event: 'Completed', payload: { source: 'seed' } });

  db.setCursor(5n);

  const listings = db.getListings().length;
  const deals = db.getDeals().length;
  console.log(JSON.stringify({ kind: 'seed_done', db: cfg.databasePath, listings, deals }));
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

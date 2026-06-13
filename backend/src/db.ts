// SQLite persistence layer. One DB holds listings, deals, notifications, and an indexer
// cursor (last processed block) so the indexer can resume without re-scanning.
import Database from 'better-sqlite3';
import { DealState } from '@handoff/contracts-abi';

export type DealStateName =
  | 'None'
  | 'Funded'
  | 'SellerCheckedIn'
  | 'Completed'
  | 'Refunded'
  | 'Forfeited';

export function stateName(state: number): DealStateName {
  switch (state) {
    case DealState.Funded:
      return 'Funded';
    case DealState.SellerCheckedIn:
      return 'SellerCheckedIn';
    case DealState.Completed:
      return 'Completed';
    case DealState.Refunded:
      return 'Refunded';
    case DealState.Forfeited:
      return 'Forfeited';
    default:
      return 'None';
  }
}

export interface ListingRow {
  listing_id: string;
  seller: string;
  price_usd_1e8: string;
  deposit_bps: number;
  pay_token: string;
  active: number;
  created_block: string | null;
  updated_at: number;
}

export interface DealRow {
  deal_id: string;
  listing_id: string;
  buyer: string;
  seller: string;
  pay_token: string;
  token_amount: string;
  free_cancel_until: string;
  expiry: string;
  state: number;
  state_name: DealStateName;
  seller_checked_in: number;
  seller_paid: string | null;
  buyer_refunded: string | null;
  created_block: string | null;
  updated_at: number;
}

export interface NotificationRow {
  id: number;
  deal_id: string;
  event: string;
  payload: string | null;
  delivered: number;
  created_at: number;
}

export interface HandoffDb {
  raw: Database.Database;
  upsertListing(l: {
    listingId: bigint;
    seller: string;
    priceUsd1e8: bigint;
    depositBps: number;
    payToken: string;
    active?: boolean;
    block?: bigint | null;
  }): void;
  setListingActive(listingId: bigint, active: boolean): void;
  getListings(): ListingRow[];
  upsertDealFromFunded(d: {
    dealId: bigint;
    listingId: bigint;
    buyer: string;
    seller: string;
    payToken: string;
    tokenAmount: bigint;
    freeCancelUntil: bigint;
    expiry: bigint;
    block?: bigint | null;
  }): void;
  setDealState(
    dealId: bigint,
    state: DealState,
    extra?: { sellerCheckedIn?: boolean; sellerPaid?: bigint; buyerRefunded?: bigint },
  ): void;
  getDeal(dealId: bigint): DealRow | undefined;
  getDeals(user?: string): DealRow[];
  insertNotification(n: { dealId: bigint; event: string; payload?: unknown }): NotificationRow;
  getNotifications(dealId?: bigint): NotificationRow[];
  getCursor(): bigint;
  setCursor(block: bigint): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  listing_id     TEXT PRIMARY KEY,
  seller         TEXT NOT NULL,
  price_usd_1e8  TEXT NOT NULL,
  deposit_bps    INTEGER NOT NULL,
  pay_token      TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  created_block  TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  deal_id            TEXT PRIMARY KEY,
  listing_id         TEXT NOT NULL,
  buyer              TEXT NOT NULL,
  seller             TEXT NOT NULL,
  pay_token          TEXT NOT NULL,
  token_amount       TEXT NOT NULL,
  free_cancel_until  TEXT NOT NULL,
  expiry             TEXT NOT NULL,
  state              INTEGER NOT NULL,
  state_name         TEXT NOT NULL,
  seller_checked_in  INTEGER NOT NULL DEFAULT 0,
  seller_paid        TEXT,
  buyer_refunded     TEXT,
  created_block      TEXT,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_buyer  ON deals(buyer);
CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals(seller);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     TEXT NOT NULL,
  event       TEXT NOT NULL,
  payload     TEXT,
  delivered   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_deal ON notifications(deal_id);

CREATE TABLE IF NOT EXISTS indexer_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  last_block   TEXT NOT NULL
);
`;

const lc = (s: string) => s.toLowerCase();
const now = () => Date.now();

export function openDb(path: string): HandoffDb {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);

  const upsertListingStmt = raw.prepare(`
    INSERT INTO listings (listing_id, seller, price_usd_1e8, deposit_bps, pay_token, active, created_block, updated_at)
    VALUES (@listing_id, @seller, @price_usd_1e8, @deposit_bps, @pay_token, @active, @created_block, @updated_at)
    ON CONFLICT(listing_id) DO UPDATE SET
      seller=excluded.seller,
      price_usd_1e8=excluded.price_usd_1e8,
      deposit_bps=excluded.deposit_bps,
      pay_token=excluded.pay_token,
      active=excluded.active,
      updated_at=excluded.updated_at
  `);

  const setListingActiveStmt = raw.prepare(
    `UPDATE listings SET active=@active, updated_at=@updated_at WHERE listing_id=@listing_id`,
  );
  const getListingsStmt = raw.prepare(`SELECT * FROM listings ORDER BY CAST(listing_id AS INTEGER)`);

  const upsertDealStmt = raw.prepare(`
    INSERT INTO deals (deal_id, listing_id, buyer, seller, pay_token, token_amount,
      free_cancel_until, expiry, state, state_name, seller_checked_in, created_block, updated_at)
    VALUES (@deal_id, @listing_id, @buyer, @seller, @pay_token, @token_amount,
      @free_cancel_until, @expiry, @state, @state_name, 0, @created_block, @updated_at)
    ON CONFLICT(deal_id) DO UPDATE SET
      listing_id=excluded.listing_id,
      buyer=excluded.buyer,
      seller=excluded.seller,
      pay_token=excluded.pay_token,
      token_amount=excluded.token_amount,
      free_cancel_until=excluded.free_cancel_until,
      expiry=excluded.expiry,
      updated_at=excluded.updated_at
  `);

  const getDealStmt = raw.prepare(`SELECT * FROM deals WHERE deal_id=?`);
  const getDealsAllStmt = raw.prepare(`SELECT * FROM deals ORDER BY CAST(deal_id AS INTEGER)`);
  const getDealsByUserStmt = raw.prepare(
    `SELECT * FROM deals WHERE buyer=? OR seller=? ORDER BY CAST(deal_id AS INTEGER)`,
  );

  const insertNotificationStmt = raw.prepare(`
    INSERT INTO notifications (deal_id, event, payload, delivered, created_at)
    VALUES (@deal_id, @event, @payload, @delivered, @created_at)
  `);
  const getNotificationByIdStmt = raw.prepare(`SELECT * FROM notifications WHERE id=?`);
  const getNotificationsAllStmt = raw.prepare(
    `SELECT * FROM notifications ORDER BY id DESC`,
  );
  const getNotificationsByDealStmt = raw.prepare(
    `SELECT * FROM notifications WHERE deal_id=? ORDER BY id DESC`,
  );

  const getCursorStmt = raw.prepare(`SELECT last_block FROM indexer_state WHERE id=1`);
  const setCursorStmt = raw.prepare(`
    INSERT INTO indexer_state (id, last_block) VALUES (1, @last_block)
    ON CONFLICT(id) DO UPDATE SET last_block=excluded.last_block
  `);

  return {
    raw,

    upsertListing(l) {
      upsertListingStmt.run({
        listing_id: l.listingId.toString(),
        seller: lc(l.seller),
        price_usd_1e8: l.priceUsd1e8.toString(),
        deposit_bps: l.depositBps,
        pay_token: lc(l.payToken),
        active: l.active === false ? 0 : 1,
        created_block: l.block != null ? l.block.toString() : null,
        updated_at: now(),
      });
    },

    setListingActive(listingId, active) {
      setListingActiveStmt.run({
        listing_id: listingId.toString(),
        active: active ? 1 : 0,
        updated_at: now(),
      });
    },

    getListings() {
      return getListingsStmt.all() as ListingRow[];
    },

    upsertDealFromFunded(d) {
      upsertDealStmt.run({
        deal_id: d.dealId.toString(),
        listing_id: d.listingId.toString(),
        buyer: lc(d.buyer),
        seller: lc(d.seller),
        pay_token: lc(d.payToken),
        token_amount: d.tokenAmount.toString(),
        free_cancel_until: d.freeCancelUntil.toString(),
        expiry: d.expiry.toString(),
        state: DealState.Funded,
        state_name: stateName(DealState.Funded),
        created_block: d.block != null ? d.block.toString() : null,
        updated_at: now(),
      });
    },

    setDealState(dealId, state, extra) {
      const sets: string[] = ['state=@state', 'state_name=@state_name', 'updated_at=@updated_at'];
      const params: Record<string, unknown> = {
        deal_id: dealId.toString(),
        state,
        state_name: stateName(state),
        updated_at: now(),
      };
      if (extra?.sellerCheckedIn != null) {
        sets.push('seller_checked_in=@seller_checked_in');
        params.seller_checked_in = extra.sellerCheckedIn ? 1 : 0;
      }
      if (extra?.sellerPaid != null) {
        sets.push('seller_paid=@seller_paid');
        params.seller_paid = extra.sellerPaid.toString();
      }
      if (extra?.buyerRefunded != null) {
        sets.push('buyer_refunded=@buyer_refunded');
        params.buyer_refunded = extra.buyerRefunded.toString();
      }
      raw.prepare(`UPDATE deals SET ${sets.join(', ')} WHERE deal_id=@deal_id`).run(params);
    },

    getDeal(dealId) {
      return getDealStmt.get(dealId.toString()) as DealRow | undefined;
    },

    getDeals(user) {
      if (user && user.length > 0) {
        const u = lc(user);
        return getDealsByUserStmt.all(u, u) as DealRow[];
      }
      return getDealsAllStmt.all() as DealRow[];
    },

    insertNotification(n) {
      const info = insertNotificationStmt.run({
        deal_id: n.dealId.toString(),
        event: n.event,
        payload: n.payload != null ? JSON.stringify(n.payload) : null,
        delivered: 0,
        created_at: now(),
      });
      return getNotificationByIdStmt.get(info.lastInsertRowid as number) as NotificationRow;
    },

    getNotifications(dealId) {
      if (dealId != null) {
        return getNotificationsByDealStmt.all(dealId.toString()) as NotificationRow[];
      }
      return getNotificationsAllStmt.all() as NotificationRow[];
    },

    getCursor() {
      const row = getCursorStmt.get() as { last_block: string } | undefined;
      return row ? BigInt(row.last_block) : 0n;
    },

    setCursor(block) {
      setCursorStmt.run({ last_block: block.toString() });
    },

    close() {
      raw.close();
    },
  };
}

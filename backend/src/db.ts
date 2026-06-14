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

export interface ListingMetaRow {
  title: string | null;
  description: string | null;
  image: string | null;
  meet_address: string | null;
  meet_lat: number | null;
  meet_lng: number | null;
  seller_phone: string | null;
  seller_email: string | null;
  meet_time: string | null;
  notes: string | null;
  seller_address: string | null;
  archived: number | null;
}

export interface CoordinationRow {
  role: 'buyer' | 'seller';
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  listing_id: string | null;
  updated_at: number;
}

export interface SellerListingRow {
  listing_id: string;
  title: string | null;
  image: string | null;
  meet_address: string | null;
  archived: number | null;
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
  getListing(listingId: bigint): ListingRow | undefined;
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
  upsertListingMeta(
    listingId: bigint,
    meta: {
      title?: string;
      description?: string;
      image?: string;
      meetAddress?: string;
      meetLat?: number;
      meetLng?: number;
      sellerPhone?: string;
      sellerEmail?: string;
      meetTime?: string;
      notes?: string;
      sellerAddress?: string;
      archived?: boolean;
    },
  ): void;
  getListingMeta(listingId: bigint): ListingMetaRow | undefined;
  getSellerListings(sellerAddress: string): SellerListingRow[];
  upsertCoordination(
    dealId: bigint,
    role: 'buyer' | 'seller',
    c: { lat?: number; lng?: number; phone?: string; email?: string; note?: string; listingId?: string },
  ): void;
  getCoordination(dealId: bigint): CoordinationRow[];
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

-- Off-chain, human-facing listing details (item name, description, photo) keyed by
-- the on-chain listingId. The contract stores none of this; the buyer's page joins it in.
CREATE TABLE IF NOT EXISTS listing_meta (
  listing_id   TEXT PRIMARY KEY,
  title        TEXT,
  description  TEXT,
  image        TEXT,
  meet_address TEXT,
  meet_lat     REAL,
  meet_lng     REAL,
  seller_phone TEXT,
  updated_at   INTEGER NOT NULL
);

-- Live meetup coordination per deal: each party (buyer/seller) shares a live location
-- and/or a phone number once they've committed and are heading to the meet.
CREATE TABLE IF NOT EXISTS deal_coordination (
  deal_id    TEXT NOT NULL,
  role       TEXT NOT NULL,           -- 'buyer' | 'seller'
  lat        REAL,
  lng        REAL,
  phone      TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (deal_id, role)
);
`;

const lc = (s: string) => s.toLowerCase();
const now = () => Date.now();

export function openDb(path: string): HandoffDb {
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);

  // Migrate older DBs to all extra columns (no-op when they already exist).
  const migrations: Array<[string, string]> = [
    ['listing_meta', 'meet_address TEXT'],
    ['listing_meta', 'meet_lat REAL'],
    ['listing_meta', 'meet_lng REAL'],
    ['listing_meta', 'seller_phone TEXT'],
    ['listing_meta', 'seller_email TEXT'],
    ['listing_meta', 'meet_time TEXT'],
    ['listing_meta', 'notes TEXT'],
    ['listing_meta', 'seller_address TEXT'],
    ['listing_meta', 'archived INTEGER DEFAULT 0'],
    ['deal_coordination', 'email TEXT'],
    ['deal_coordination', 'note TEXT'],
    ['deal_coordination', 'listing_id TEXT'],
  ];
  for (const [table, col] of migrations) {
    try {
      raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
    } catch {
      /* column already exists */
    }
  }

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
  const getListingStmt = raw.prepare(`SELECT * FROM listings WHERE listing_id=?`);

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

  const upsertMetaStmt = raw.prepare(`
    INSERT INTO listing_meta (listing_id, title, description, image, meet_address, meet_lat, meet_lng, seller_phone, seller_email, meet_time, notes, seller_address, archived, updated_at)
    VALUES (@listing_id, @title, @description, @image, @meet_address, @meet_lat, @meet_lng, @seller_phone, @seller_email, @meet_time, @notes, @seller_address, @archived, @updated_at)
    ON CONFLICT(listing_id) DO UPDATE SET
      title=COALESCE(excluded.title, listing_meta.title),
      description=COALESCE(excluded.description, listing_meta.description),
      image=COALESCE(excluded.image, listing_meta.image),
      meet_address=COALESCE(excluded.meet_address, listing_meta.meet_address),
      meet_lat=COALESCE(excluded.meet_lat, listing_meta.meet_lat),
      meet_lng=COALESCE(excluded.meet_lng, listing_meta.meet_lng),
      seller_phone=COALESCE(excluded.seller_phone, listing_meta.seller_phone),
      seller_email=COALESCE(excluded.seller_email, listing_meta.seller_email),
      meet_time=COALESCE(excluded.meet_time, listing_meta.meet_time),
      notes=COALESCE(excluded.notes, listing_meta.notes),
      seller_address=COALESCE(excluded.seller_address, listing_meta.seller_address),
      archived=COALESCE(excluded.archived, listing_meta.archived),
      updated_at=excluded.updated_at
  `);
  const getMetaStmt = raw.prepare(
    `SELECT title, description, image, meet_address, meet_lat, meet_lng, seller_phone, seller_email, meet_time, notes, seller_address, archived FROM listing_meta WHERE listing_id=?`,
  );
  const getSellerListingsStmt = raw.prepare(
    `SELECT listing_id, title, image, meet_address, archived FROM listing_meta WHERE seller_address=? ORDER BY CAST(listing_id AS INTEGER) DESC`,
  );

  const upsertCoordStmt = raw.prepare(`
    INSERT INTO deal_coordination (deal_id, role, lat, lng, phone, email, note, listing_id, updated_at)
    VALUES (@deal_id, @role, @lat, @lng, @phone, @email, @note, @listing_id, @updated_at)
    ON CONFLICT(deal_id, role) DO UPDATE SET
      lat=COALESCE(excluded.lat, deal_coordination.lat),
      lng=COALESCE(excluded.lng, deal_coordination.lng),
      phone=COALESCE(excluded.phone, deal_coordination.phone),
      email=COALESCE(excluded.email, deal_coordination.email),
      note=COALESCE(excluded.note, deal_coordination.note),
      listing_id=COALESCE(excluded.listing_id, deal_coordination.listing_id),
      updated_at=excluded.updated_at
  `);
  const getCoordStmt = raw.prepare(
    `SELECT role, lat, lng, phone, email, note, listing_id, updated_at FROM deal_coordination WHERE deal_id=?`,
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

    getListing(listingId) {
      return getListingStmt.get(listingId.toString()) as ListingRow | undefined;
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

    upsertListingMeta(listingId, meta) {
      upsertMetaStmt.run({
        listing_id: listingId.toString(),
        title: meta.title ?? null,
        description: meta.description ?? null,
        image: meta.image ?? null,
        meet_address: meta.meetAddress ?? null,
        meet_lat: meta.meetLat ?? null,
        meet_lng: meta.meetLng ?? null,
        seller_phone: meta.sellerPhone ?? null,
        seller_email: meta.sellerEmail ?? null,
        meet_time: meta.meetTime ?? null,
        notes: meta.notes ?? null,
        seller_address: meta.sellerAddress ? meta.sellerAddress.toLowerCase() : null,
        archived: meta.archived === undefined ? null : meta.archived ? 1 : 0,
        updated_at: now(),
      });
    },

    getListingMeta(listingId) {
      return getMetaStmt.get(listingId.toString()) as ListingMetaRow | undefined;
    },

    getSellerListings(sellerAddress) {
      return getSellerListingsStmt.all(sellerAddress.toLowerCase()) as SellerListingRow[];
    },

    upsertCoordination(dealId, role, c) {
      upsertCoordStmt.run({
        deal_id: dealId.toString(),
        role,
        lat: c.lat ?? null,
        lng: c.lng ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        note: c.note ?? null,
        listing_id: c.listingId ?? null,
        updated_at: now(),
      });
    },

    getCoordination(dealId) {
      return getCoordStmt.all(dealId.toString()) as CoordinationRow[];
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

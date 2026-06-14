// Fastify API. CORS is open (web app + CRE call it from anywhere in the demo, SPEC §11) but
// without credentials, so a reflected origin can't be paired with cookies/Authorization.
// buildApp is pure wrt the DB it's handed, so tests can pass a temp sqlite. BigInt-bearing
// rows are serialised to strings already by the DB layer, so JSON.stringify is safe.
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import type { HandoffDb, DealRow, ListingRow } from './db.ts';
import { notify } from './notifications.ts';

export interface BuildAppOptions {
  db: HandoffDb;
  logger?: boolean;
}

function serializeListing(l: ListingRow) {
  return {
    listingId: l.listing_id,
    seller: l.seller,
    priceUsd1e8: l.price_usd_1e8,
    depositBps: l.deposit_bps,
    payToken: l.pay_token,
    active: l.active === 1,
    updatedAt: l.updated_at,
  };
}

function serializeDeal(d: DealRow) {
  return {
    dealId: d.deal_id,
    listingId: d.listing_id,
    buyer: d.buyer,
    seller: d.seller,
    payToken: d.pay_token,
    tokenAmount: d.token_amount,
    freeCancelUntil: d.free_cancel_until,
    expiry: d.expiry,
    state: d.state,
    stateName: d.state_name,
    sellerCheckedIn: d.seller_checked_in === 1,
    sellerPaid: d.seller_paid,
    buyerRefunded: d.buyer_refunded,
    updatedAt: d.updated_at,
  };
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/i;
// Bound the /notify event label and stored payload so a caller can't bloat sqlite
// or inject huge log lines. These are generous for the lifecycle labels CRE sends.
const MAX_EVENT_LEN = 64;
const MAX_PAYLOAD_BYTES = 4 * 1024;
// Reject C0 control chars (U+0000-U+001F, incl. CR/LF/TAB) and DEL (U+007F) in the
// `event` label to prevent log-injection / forged lines in the notification log.
// Built from a RegExp string with \u escapes so the source stays pure-ASCII.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = new RegExp('[\\u0000-\\u001f\\u007f]');

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    // Listing photos (base64 data URLs) post to /listings/:id/meta, so allow a few MiB.
    bodyLimit: 3 * 1024 * 1024,
  });
  // CORS intentionally open for the demo (SPEC §11) but credentials disabled, so a
  // reflected origin can't be combined with cookies/Authorization against a session.
  await app.register(cors, {
    origin: true,
    credentials: false,
    methods: ['GET', 'POST'],
  });

  // Consistent error shape; never leak internals/stack traces to clients.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err: String(err) }, 'request failed');
    reply.code(status).send({ error: status >= 500 ? 'internal error' : err.message });
  });

  app.get('/health', async () => ({ ok: true, service: 'handoff-backend', time: Date.now() }));

  app.get('/listings', async () => ({
    listings: db.getListings().map(serializeListing),
  }));

  // Browse grid: purchasable listings (active + not withdrawn) enriched with title/photo/area.
  app.get('/listings/active', async () => ({
    listings: db.getActiveListings().map((l) => ({
      listingId: l.listing_id,
      seller: l.seller,
      priceUsd1e8: l.price_usd_1e8,
      depositBps: l.deposit_bps,
      payToken: l.pay_token,
      title: l.title,
      image: l.image,
      meetAddress: l.meet_address,
    })),
  }));

  app.get<{ Querystring: { user?: string } }>('/deals', async (req, reply) => {
    const user = req.query.user;
    if (user && !ADDR_RE.test(user)) {
      return reply.code(400).send({ error: 'invalid `user` address' });
    }
    return { deals: db.getDeals(user).map(serializeDeal) };
  });

  app.get<{ Params: { id: string } }>('/deals/:id', async (req, reply) => {
    const id = req.params.id;
    // Digits only, bounded length (a uint256 is at most 78 decimal digits).
    if (!/^\d{1,78}$/.test(id)) {
      return reply.code(400).send({ error: 'invalid deal id' });
    }
    const deal = db.getDeal(BigInt(id));
    if (!deal) return reply.code(404).send({ error: 'deal not found' });
    return {
      deal: serializeDeal(deal),
      notifications: db.getNotifications(BigInt(id)),
    };
  });

  // Called by the CRE workflow on lifecycle changes. Body: { dealId, event, payload? }.
  app.post<{ Body: { dealId?: string | number; event?: string; payload?: unknown } }>(
    '/notify',
    async (req, reply) => {
      const body = req.body ?? {};
      const { dealId, event, payload } = body;
      // dealId: digits only (becomes BigInt), bounded length so a giant string
      // can't be turned into an unbounded BigInt.
      if (dealId == null || !/^\d{1,78}$/.test(String(dealId))) {
        return reply.code(400).send({ error: '`dealId` (numeric) is required' });
      }
      // event: a short, single-line label.
      if (typeof event !== 'string' || event.length === 0 || event.length > MAX_EVENT_LEN) {
        return reply
          .code(400)
          .send({ error: `\`event\` (string, 1-${MAX_EVENT_LEN} chars) is required` });
      }
      if (CONTROL_CHARS_RE.test(event)) {
        return reply.code(400).send({ error: '`event` contains control characters' });
      }
      // payload is optional/free-form but bounded so it can't bloat the DB.
      if (payload !== undefined && JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
        return reply
          .code(400)
          .send({ error: `\`payload\` exceeds ${MAX_PAYLOAD_BYTES} bytes` });
      }
      const row = await notify(db, { dealId: BigInt(dealId), event, payload });
      return reply.code(201).send({ ok: true, notification: row });
    },
  );

  // ---- Off-chain listing details (item name, description, photo) ----
  const MAX_TITLE = 140;
  const MAX_DESC = 2000;
  const MAX_IMAGE = 2 * 1024 * 1024; // ~2 MiB base64 data URL

  const MAX_ADDR = 200;
  const serializeMeta = (m: ReturnType<typeof db.getListingMeta>) =>
    m
      ? {
          title: m.title,
          description: m.description,
          image: m.image,
          meetAddress: m.meet_address,
          meetLat: m.meet_lat,
          meetLng: m.meet_lng,
          sellerPhone: m.seller_phone,
          sellerEmail: m.seller_email,
          meetTime: m.meet_time,
          notes: m.notes,
          sellerAddress: m.seller_address,
          archived: m.archived === 1,
        }
      : null;

  app.get<{ Params: { id: string } }>('/listings/:id/meta', async (req, reply) => {
    if (!/^\d{1,78}$/.test(req.params.id)) {
      return reply.code(400).send({ error: 'invalid listing id' });
    }
    return { meta: serializeMeta(db.getListingMeta(BigInt(req.params.id))) };
  });

  app.post<{
    Params: { id: string };
    Body: {
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
    };
  }>('/listings/:id/meta', async (req, reply) => {
    if (!/^\d{1,78}$/.test(req.params.id)) {
      return reply.code(400).send({ error: 'invalid listing id' });
    }
    const b = req.body ?? {};
    const title = typeof b.title === 'string' ? b.title.slice(0, MAX_TITLE) : undefined;
    const description =
      typeof b.description === 'string' ? b.description.slice(0, MAX_DESC) : undefined;
    const meetAddress =
      typeof b.meetAddress === 'string' ? b.meetAddress.slice(0, MAX_ADDR) : undefined;
    const sellerPhone =
      typeof b.sellerPhone === 'string' ? b.sellerPhone.slice(0, 32) : undefined;
    const sellerEmail =
      typeof b.sellerEmail === 'string' ? b.sellerEmail.slice(0, 120) : undefined;
    const meetTime = typeof b.meetTime === 'string' ? b.meetTime.slice(0, 80) : undefined;
    const notes = typeof b.notes === 'string' ? b.notes.slice(0, 1000) : undefined;
    const sellerAddress =
      typeof b.sellerAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(b.sellerAddress)
        ? b.sellerAddress
        : undefined;
    const archived = typeof b.archived === 'boolean' ? b.archived : undefined;
    const meetLat =
      typeof b.meetLat === 'number' && Math.abs(b.meetLat) <= 90 ? b.meetLat : undefined;
    const meetLng =
      typeof b.meetLng === 'number' && Math.abs(b.meetLng) <= 180 ? b.meetLng : undefined;
    let image: string | undefined;
    if (b.image != null && b.image !== '') {
      if (typeof b.image !== 'string' || b.image.length > MAX_IMAGE) {
        return reply.code(400).send({ error: 'image too large or invalid (max ~2MB)' });
      }
      if (!/^data:image\//.test(b.image)) {
        return reply.code(400).send({ error: 'image must be a data:image/... URL' });
      }
      image = b.image;
    }
    db.upsertListingMeta(BigInt(req.params.id), {
      title,
      description,
      image,
      meetAddress,
      meetLat,
      meetLng,
      sellerPhone,
      sellerEmail,
      meetTime,
      notes,
      sellerAddress,
      archived,
    });
    return reply.code(201).send({ ok: true });
  });

  // Listings created by a given seller (for the "My listings" view).
  app.get<{ Params: { address: string } }>('/sellers/:address/listings', async (req, reply) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.address)) {
      return reply.code(400).send({ error: 'invalid address' });
    }
    return {
      listings: db.getSellerListings(req.params.address).map((r) => ({
        listingId: r.listing_id,
        title: r.title,
        image: r.image,
        meetAddress: r.meet_address,
        archived: r.archived === 1,
      })),
    };
  });

  // ---- Live meetup coordination per deal (each party shares location/phone) ----
  app.get<{ Params: { id: string } }>('/deals/:id/coordination', async (req, reply) => {
    if (!/^\d{1,78}$/.test(req.params.id)) {
      return reply.code(400).send({ error: 'invalid deal id' });
    }
    const rows = db.getCoordination(BigInt(req.params.id));
    const by = (role: 'buyer' | 'seller') => {
      const r = rows.find((x) => x.role === role);
      return r
        ? { lat: r.lat, lng: r.lng, phone: r.phone, email: r.email, note: r.note, updatedAt: r.updated_at }
        : null;
    };
    const listingId = rows.find((r) => r.listing_id)?.listing_id ?? null;
    return { buyer: by('buyer'), seller: by('seller'), listingId };
  });

  app.post<{
    Params: { id: string };
    Body: {
      role?: string;
      lat?: number;
      lng?: number;
      phone?: string;
      email?: string;
      note?: string;
      listingId?: string;
    };
  }>('/deals/:id/coordination', async (req, reply) => {
    if (!/^\d{1,78}$/.test(req.params.id)) {
      return reply.code(400).send({ error: 'invalid deal id' });
    }
    const b = req.body ?? {};
    if (b.role !== 'buyer' && b.role !== 'seller') {
      return reply.code(400).send({ error: 'role must be "buyer" or "seller"' });
    }
    const lat = typeof b.lat === 'number' && Math.abs(b.lat) <= 90 ? b.lat : undefined;
    const lng = typeof b.lng === 'number' && Math.abs(b.lng) <= 180 ? b.lng : undefined;
    const phone = typeof b.phone === 'string' ? b.phone.slice(0, 32) : undefined;
    const email = typeof b.email === 'string' ? b.email.slice(0, 120) : undefined;
    const note = typeof b.note === 'string' ? b.note.slice(0, 500) : undefined;
    const listingId =
      typeof b.listingId === 'string' && /^\d{1,78}$/.test(b.listingId) ? b.listingId : undefined;
    db.upsertCoordination(BigInt(req.params.id), b.role, { lat, lng, phone, email, note, listingId });
    return reply.code(201).send({ ok: true });
  });

  return app;
}

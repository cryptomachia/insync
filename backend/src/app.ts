// Fastify API. CORS is open (web app + CRE call it from anywhere in the demo). buildApp is
// pure wrt the DB it's handed, so tests can pass a temp sqlite. BigInt-bearing rows are
// serialised to strings already by the DB layer, so JSON.stringify is safe.
import Fastify, { type FastifyInstance } from 'fastify';
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

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true, service: 'handoff-backend', time: Date.now() }));

  app.get('/listings', async () => ({
    listings: db.getListings().map(serializeListing),
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
    if (!/^\d+$/.test(id)) {
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
      if (dealId == null || !/^\d+$/.test(String(dealId))) {
        return reply.code(400).send({ error: '`dealId` (numeric) is required' });
      }
      if (!event || typeof event !== 'string') {
        return reply.code(400).send({ error: '`event` (string) is required' });
      }
      const row = await notify(db, { dealId: BigInt(dealId), event, payload });
      return reply.code(201).send({ ok: true, notification: row });
    },
  );

  return app;
}

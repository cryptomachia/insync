// Event indexer. Subscribes to Escrow events over the configured RPC and keeps the sqlite
// mirror of listings/deals current. It does a one-time backfill (getLogs from the cursor)
// then watches for new events. Pure event-sourcing: each event maps to a DB mutation so the
// deal `state` always reflects the latest terminal/intermediate transition.
import {
  createPublicClient,
  http,
  webSocket,
  type Log,
  type PublicClient,
} from 'viem';
import { escrowAbi, DealState } from '@handoff/contracts-abi';
import type { Address } from '@handoff/contracts-abi';
import type { HandoffDb } from './db.ts';

export interface IndexerOptions {
  rpcUrl: string;
  escrowAddress: Address;
  db: HandoffDb;
  fromBlock?: bigint;
  // Poll interval for http transports (ms). Ignored for ws.
  pollingInterval?: number;
}

export interface Indexer {
  start(): Promise<void>;
  // Process an array of already-decoded logs (used by backfill + tests).
  applyLogs(logs: Log[]): void;
  stop(): void;
}

function makeClient(rpcUrl: string, pollingInterval?: number): PublicClient {
  const transport = rpcUrl.startsWith('ws')
    ? webSocket(rpcUrl)
    : http(rpcUrl, pollingInterval ? { batch: true } : undefined);
  return createPublicClient({ transport, pollingInterval }) as PublicClient;
}

// Map a single decoded Escrow event into DB writes. Exported for unit testing without a chain.
export function handleEvent(
  db: HandoffDb,
  ev: {
    eventName: string;
    args: Record<string, unknown>;
    blockNumber?: bigint | null;
    transactionHash?: string | null;
  },
): void {
  const a = ev.args;
  const block = ev.blockNumber ?? null;
  // Record each lifecycle transition once (with its tx hash) so the deal page can show a
  // timeline and the receipt can link to the on-chain proof.
  const mark = (dealId: bigint) =>
    db.recordEventOnce({
      dealId,
      event: ev.eventName,
      payload: { txHash: ev.transactionHash ?? null, block: block?.toString() ?? null },
    });
  switch (ev.eventName) {
    case 'Listed':
      db.upsertListing({
        listingId: a.listingId as bigint,
        seller: a.seller as string,
        priceUsd1e8: a.priceUsd1e8 as bigint,
        depositBps: Number(a.depositBps as bigint | number),
        payToken: a.payToken as string,
        active: true,
        block,
      });
      break;

    case 'Funded': {
      // The Funded event doesn't carry payToken — it's a property of the listing the deal
      // was funded against, so look it up from the already-indexed listing.
      const listingId = a.listingId as bigint;
      const payToken = db.getListing(listingId)?.pay_token ?? '';
      db.upsertDealFromFunded({
        dealId: a.dealId as bigint,
        listingId,
        buyer: a.buyer as string,
        seller: a.seller as string,
        payToken,
        tokenAmount: a.tokenAmount as bigint,
        freeCancelUntil: a.freeCancelUntil as bigint,
        expiry: a.expiry as bigint,
        block,
      });
      // A funded listing is no longer purchasable.
      db.setListingActive(listingId, false);
      mark(a.dealId as bigint);
      break;
    }

    case 'CheckedIn':
      db.setDealState(a.dealId as bigint, DealState.SellerCheckedIn, { sellerCheckedIn: true });
      mark(a.dealId as bigint);
      break;

    case 'Completed':
      db.setDealState(a.dealId as bigint, DealState.Completed, {
        sellerPaid: a.sellerPaid as bigint,
        buyerRefunded: a.buyerRefunded as bigint,
      });
      mark(a.dealId as bigint);
      break;

    case 'Refunded':
      db.setDealState(a.dealId as bigint, DealState.Refunded, {
        buyerRefunded: a.amount as bigint,
      });
      mark(a.dealId as bigint);
      break;

    case 'Forfeited':
      db.setDealState(a.dealId as bigint, DealState.Forfeited, {
        buyerRefunded: a.toBuyer as bigint,
        sellerPaid: a.toSeller as bigint,
      });
      mark(a.dealId as bigint);
      break;

    default:
      // Unknown event — ignore.
      break;
  }
}

export function createIndexer(opts: IndexerOptions): Indexer {
  const { db, escrowAddress } = opts;
  const client = makeClient(opts.rpcUrl, opts.pollingInterval);
  const unwatchers: Array<() => void> = [];

  function applyLogs(logs: Log[]): void {
    let maxBlock = db.getCursor();
    for (const log of logs) {
      const decoded = log as unknown as {
        eventName?: string;
        args?: Record<string, unknown>;
        blockNumber?: bigint | null;
        transactionHash?: string | null;
      };
      if (!decoded.eventName || !decoded.args) continue;
      // A single malformed/unexpected log shouldn't abort the whole backfill.
      try {
        handleEvent(db, {
          eventName: decoded.eventName,
          args: decoded.args,
          blockNumber: decoded.blockNumber ?? null,
          transactionHash: decoded.transactionHash ?? null,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            kind: 'indexer_event_error',
            event: decoded.eventName,
            error: String(err),
          }),
        );
      }
      if (decoded.blockNumber != null && decoded.blockNumber > maxBlock) {
        maxBlock = decoded.blockNumber;
      }
    }
    if (maxBlock > db.getCursor()) db.setCursor(maxBlock);
  }

  // Public RPCs cap eth_getLogs at ~50k blocks per request, so walk the range in windows.
  const MAX_RANGE = 45_000n;

  async function backfill(): Promise<void> {
    const cursor = db.getCursor();
    const head = await client.getBlockNumber();
    // Resume from the cursor if we have one; otherwise from the configured deploy block
    // (falling back to a recent window so we never scan from genesis).
    let from =
      cursor > 0n
        ? cursor + 1n
        : (opts.fromBlock ?? (head > MAX_RANGE ? head - MAX_RANGE : 0n));
    while (from <= head) {
      const to = from + MAX_RANGE - 1n > head ? head : from + MAX_RANGE - 1n;
      const logs = await client.getContractEvents({
        abi: escrowAbi,
        address: escrowAddress,
        fromBlock: from,
        toBlock: to,
      });
      applyLogs(logs as unknown as Log[]);
      if (to > db.getCursor()) db.setCursor(to);
      from = to + 1n;
    }
    if (head > db.getCursor()) db.setCursor(head);
  }

  async function start(): Promise<void> {
    await backfill();
    const unwatch = client.watchContractEvent({
      abi: escrowAbi,
      address: escrowAddress,
      onLogs: (logs) => applyLogs(logs as unknown as Log[]),
      onError: (err) =>
        console.error(JSON.stringify({ kind: 'indexer_watch_error', error: String(err) })),
    });
    unwatchers.push(unwatch);
    console.log(
      JSON.stringify({
        kind: 'indexer_started',
        escrow: escrowAddress,
        rpc: opts.rpcUrl,
        cursor: db.getCursor().toString(),
      }),
    );
  }

  function stop(): void {
    for (const u of unwatchers.splice(0)) u();
  }

  return { start, applyLogs, stop };
}

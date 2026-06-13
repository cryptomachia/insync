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
  ev: { eventName: string; args: Record<string, unknown>; blockNumber?: bigint | null },
): void {
  const a = ev.args;
  const block = ev.blockNumber ?? null;
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

    case 'Funded':
      db.upsertDealFromFunded({
        dealId: a.dealId as bigint,
        listingId: a.listingId as bigint,
        buyer: a.buyer as string,
        seller: a.seller as string,
        payToken: a.payToken as string,
        tokenAmount: a.tokenAmount as bigint,
        freeCancelUntil: a.freeCancelUntil as bigint,
        expiry: a.expiry as bigint,
        block,
      });
      // A funded listing is no longer purchasable.
      // (listingId carried on the Funded event lets us deactivate without a getListing read.)
      db.setListingActive(a.listingId as bigint, false);
      break;

    case 'CheckedIn':
      db.setDealState(a.dealId as bigint, DealState.SellerCheckedIn, { sellerCheckedIn: true });
      break;

    case 'Completed':
      db.setDealState(a.dealId as bigint, DealState.Completed, {
        sellerPaid: a.sellerPaid as bigint,
        buyerRefunded: a.buyerRefunded as bigint,
      });
      break;

    case 'Refunded':
      db.setDealState(a.dealId as bigint, DealState.Refunded, {
        buyerRefunded: a.amount as bigint,
      });
      break;

    case 'Forfeited':
      db.setDealState(a.dealId as bigint, DealState.Forfeited, {
        buyerRefunded: a.toBuyer as bigint,
        sellerPaid: a.toSeller as bigint,
      });
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
      };
      if (!decoded.eventName || !decoded.args) continue;
      handleEvent(db, {
        eventName: decoded.eventName,
        args: decoded.args,
        blockNumber: decoded.blockNumber ?? null,
      });
      if (decoded.blockNumber != null && decoded.blockNumber > maxBlock) {
        maxBlock = decoded.blockNumber;
      }
    }
    if (maxBlock > db.getCursor()) db.setCursor(maxBlock);
  }

  async function backfill(): Promise<void> {
    const cursor = db.getCursor();
    const fromBlock = opts.fromBlock ?? (cursor > 0n ? cursor + 1n : 0n);
    const logs = await client.getContractEvents({
      abi: escrowAbi,
      address: escrowAddress,
      fromBlock,
      toBlock: 'latest',
    });
    applyLogs(logs as unknown as Log[]);
    const head = await client.getBlockNumber();
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

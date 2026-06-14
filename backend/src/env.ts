// Centralised env/config. Backend runs in MOCK/local mode by default (no third-party keys).
import { getAddresses, IS_MOCK } from '@handoff/contracts-abi';
import type { Address } from '@handoff/contracts-abi';

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export interface Config {
  rpcUrl: string;
  escrowAddress?: Address;
  port: number;
  databasePath: string;
  isMock: boolean;
  indexerFromBlock?: bigint;
}

export function loadConfig(): Config {
  const { escrow } = getAddresses();
  // Block to start the backfill from (the contract's deploy block). Avoids scanning from
  // genesis, which public RPCs reject (eth_getLogs is capped at ~50k blocks).
  const fb = process.env.INDEXER_FROM_BLOCK;
  return {
    rpcUrl: str('RPC_URL', 'http://127.0.0.1:8545'),
    escrowAddress: escrow,
    port: num('PORT', 8787),
    databasePath: str('DATABASE_PATH', './handoff.db'),
    isMock: IS_MOCK,
    indexerFromBlock: fb && /^\d+$/.test(fb) ? BigInt(fb) : undefined,
  };
}

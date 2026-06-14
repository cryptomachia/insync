// Entrypoint: load config, open the DB, start the API, and (when an ESCROW_ADDRESS + RPC are
// available) start the event indexer. The API serves even if the indexer can't connect, so
// /health and seeded data work offline. `npm run dev` runs this under tsx watch.
import { loadConfig } from './env.ts';
import { openDb } from './db.ts';
import { buildApp } from './app.ts';
import { createIndexer } from './indexer.ts';
import { createFaucet } from './faucet.ts';

// Name the process so it shows up as "insync-backend" in Activity Monitor / `ps`.
process.title = 'insync-backend';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = openDb(cfg.databasePath);

  // Enable the test-USDC faucet only when a signer key + token address are configured.
  const faucet =
    cfg.faucetPrivateKey && cfg.usdcAddress
      ? createFaucet({
          rpcUrl: cfg.rpcUrl,
          privateKey: cfg.faucetPrivateKey,
          token: cfg.usdcAddress,
          chainId: cfg.chainId,
        })
      : undefined;

  const app = await buildApp({ db, logger: true, faucet });

  if (cfg.escrowAddress) {
    const indexer = createIndexer({
      rpcUrl: cfg.rpcUrl,
      escrowAddress: cfg.escrowAddress,
      db,
      fromBlock: cfg.indexerFromBlock,
    });
    // Don't crash the API if the chain is unreachable; log and keep serving.
    indexer.start().catch((err) => {
      app.log.error({ err: String(err) }, 'indexer failed to start; API continues serving');
    });
    const shutdown = () => {
      indexer.stop();
      db.close();
      app.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    app.log.warn(
      'ESCROW_ADDRESS not set — running API-only (no indexer). Set ESCROW_ADDRESS + RPC_URL to index.',
    );
  }

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  app.log.info(
    { port: cfg.port, db: cfg.databasePath, mock: cfg.isMock },
    'handoff backend listening',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

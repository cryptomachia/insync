# @handoff/backend — event indexer + API + notifications (AGENT 9, SPEC §11)

Node + Fastify + better-sqlite3 + viem. Mirrors Escrow on-chain state into sqlite and exposes
a small REST API for the web app and the CRE workflow. Runs fully offline in MOCK/local mode.

## Run

```bash
npm i
cp .env.example .env        # or rely on defaults
npm run seed                # optional: fill sqlite with sample data (no chain needed)
npm run dev                 # tsx watch; serves API + starts indexer if ESCROW_ADDRESS set
```

- With `ESCROW_ADDRESS` + a reachable `RPC_URL` (e.g. local anvil), the indexer backfills past
  Escrow events then watches for new ones, keeping deal state current.
- Without `ESCROW_ADDRESS`, the API serves seeded/stored data only (no indexer) — useful for
  frontend dev with no chain running.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/listings` | all listings |
| GET | `/deals?user=0x..` | deals where user is buyer or seller (omit `user` for all) |
| GET | `/deals/:id` | one deal + its notifications |
| POST | `/notify` | body `{ dealId, event, payload? }`; called by CRE; logs + stores a row |

CORS is open. All numeric/bigint fields are returned as decimal strings.

## Env

`RPC_URL`, `ESCROW_ADDRESS`, `PORT` (8787), `DATABASE_PATH`, `MOCK`.

## Notifications

`POST /notify` persists a row then dispatches through the active `NotificationProvider`
(`src/notifications.ts`). Default is a structured-log provider; swap in Twilio/FCM/APNs by
implementing `NotificationProvider.deliver` and calling `setNotificationProvider`.

## Test

```bash
npm run typecheck    # tsc --noEmit
npm test             # node:test against a temp sqlite
```

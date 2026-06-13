# `cre/` — Handoff Chainlink CRE workflow (the escrow's orchestration brain)

Handoff is a **trustless in-person escrow**: two strangers with no shared bank,
no cash, **final settlement (no chargebacks)**, and **provably-committed funds
before anyone travels**. The seller can see the buyer's money is real and locked
before agreeing to meet — that combination is impossible without crypto.

This package is the **Chainlink CRE workflow** — the part that runs autonomously
and keeps the escrow honest when humans don't show up. It is our anchor for the
**Best CRE workflow** prize.

> Built against `@chainlink/cre-sdk` v1.11.x (TypeScript). Docs:
> <https://docs.chain.link/cre> · templates:
> <https://github.com/smartcontractkit/cre-templates>.

---

## What it does (SPEC §12)

On a **cron schedule**, the workflow:

1. Reads active deals from the Escrow (`getDeal(dealId)` over viem/`escrowAbi`,
   iterating `dealId = 1..N`; it can also read the backend `GET /deals`).
2. Finds every deal **past its `expiry`** that is **not** in a terminal state
   (`Completed` / `Refunded` / `Forfeited`).
3. Calls **`reclaimExpired(dealId, report)`** on the Escrow — **the on-chain
   state change** that satisfies the prize. Per the §4 rules:
   - seller had **checked in** → buyer ghosted a present seller → **deposit → seller**;
   - seller **never showed** → **full refund → buyer**.
4. Builds `report` for **volatile** deals via `@handoff/datastreams.getReport`
   (mock = `0x`); stable USDC deals pass `0x`.
5. POSTs the backend **`/notify`** on each lifecycle change.

This is demo path #2 ("No-show: after expiry the CRE workflow calls
`reclaimExpired` → buyer refunded, or deposit→seller if the seller checked in").

---

## Exactly where Chainlink causes the state change

In the **live** workflow (`src/workflow.ts`), the reclaim is not a plain EOA tx —
it goes through the CRE report/receiver pipeline:

```
cron trigger (DON)                                  ← Chainlink schedules the run
  └─ EVMClient.callContract(getDeal)                ← DON consensus read of each deal
  └─ for each expired, non-terminal deal:
       calldata = encodeFunctionData(reclaimExpired, [dealId, dataStreamsReport])
       creReport = runtime.report(prepareReportRequest(calldata))   ← DON signs the report
       EVMClient.writeReport({ receiver, report: creReport })       ← DON SUBMITS THE TX  ★
         └─ receiver verifies DON signature → executes reclaimExpired
              └─ Escrow: Funded/CheckedIn → Refunded/Forfeited      ★ on-chain state change
  └─ HTTPClient POST {dealId,event} → backend /notify
```

The **★ lines are where Chainlink causes the state change**: the DON reaches
consensus, signs a report wrapping our `reclaimExpired` calldata, and broadcasts
the transaction; the on-chain receiver verifies the DON signature and executes
it, flipping the deal to a terminal state.

### Two different "reports" — don't conflate them

| name | produced by | purpose |
|---|---|---|
| **CRE report** | `runtime.report(prepareReportRequest(calldata))` | DON-signed wrapper around our calldata; the thing `writeReport` broadcasts |
| **Data Streams report** (`reclaimExpired`'s `bytes report` arg) | `@handoff/datastreams.getReport(feed)` | signed price report so the Escrow can value a **volatile** token in USD (SPEC §6); `0x` for stable USDC |

The Data Streams `report` is embedded **inside** the calldata, which is then
wrapped in the CRE report. In MOCK mode both collapse to `0x` payloads.

> Integration note: the live receiver must accept DON-signed reports. If the
> Escrow as written takes `reclaimExpired` as an ordinary public call (it is
> `external` and "anyone/CRE after expiry" per SPEC §3), the CRE write targets
> it through CRE's EVM forwarder/receiver; the **local keeper below calls the
> identical function directly**, which is the guaranteed-working demo path.

---

## Two ways to run it

### A. Fully offline — local keeper (no Chainlink account needed) ✅ demo-ready

`src/keeper.local.ts` performs the **identical reclaim sweep** with a plain viem
wallet (keeper `PRIVATE_KEY`) against **local anvil + the deployed Escrow**. It
imports the *same* domain rules (`src/deals.ts`) and sweep algorithm
(`src/sweep.ts`) as the CRE workflow, so the two cannot drift — only the final
transaction's transport differs (keeper EOA vs DON `writeReport`).

```bash
cd cre
npm i
cp .env.example .env          # then set ESCROW_ADDRESS (after deploy), keep MOCK=true

# read-only: list deals + show which the keeper/CRE would reclaim
npm run deals                 # from chain
npm run deals -- backend      # from backend GET /deals

# preview a sweep without sending any tx
npm run keeper:local -- --dry-run

# do it for real against anvil (sends reclaimExpired from the keeper key)
npm run keeper:local

# keep sweeping on an interval (acts like the cron)
npm run keeper:local -- --watch
```

No anvil, no chain, no Chainlink at all? The logic self-test runs entirely
in-memory against a mock Escrow seeded with deals in every state:

```bash
npm run keeper:dry-run        # exits non-zero if the reclaim set is wrong
```

### B. Live CRE — simulate, then deploy

Prereqs: [bun](https://bun.com/) + the
[CRE CLI](https://github.com/smartcontractkit/cre-cli).

```bash
cd cre
npm i

# (one-time) prepare the Javy WASM plugin used to compile TS → WASM
bunx cre-setup

# edit config.json: set evms[0].escrowAddress, chainSelectorName, stableToken

# SIMULATE locally (compiles to WASM, runs on your machine; real RPC/HTTP)
npm run simulate                       # reads only
./scripts/simulate.sh --broadcast      # also broadcasts reclaim txs
# equivalently:
cre workflow simulate --target local-simulation --config config.json src/workflow.ts

# DEPLOY to a live CRE DON (Early Access — needs CRE account + funded keys)
cre login
cre workflow deploy handoff-reclaim    # uses project.yaml's target
```

`scripts/simulate.sh` degrades gracefully: if the CRE CLI/bun aren't installed
it prints the exact manual commands and points you at the offline keeper.

---

## Files

| file | role |
|---|---|
| `src/workflow.ts` | **the CRE workflow** — cron → read deals → `reclaimExpired` via DON report → `/notify` |
| `src/keeper.local.ts` | offline keeper: same sweep with a viem keeper wallet vs anvil + Escrow |
| `src/sweep.ts` | shared reclaim-sweep algorithm (generic over a client) |
| `src/deals.ts` | shared domain rules: terminal/reclaimable/volatile predicates, decode `getDeal` |
| `src/escrow-client.ts` | viem read/write client for the Escrow (local side) |
| `src/scan-deals.ts` | read-only deal lister (chain or backend `GET /deals`) |
| `src/notify.ts` | backend `/notify` POST helper |
| `src/env.ts` | `.env` loader + SPEC §14 env resolution (local tools only) |
| `src/keeper.dry-run.ts` | in-memory self-test of the sweep (no chain, no keys) |
| `config.json` / `config.local.json` | CRE runtime config templates (schedule, escrow, evms) |
| `project.yaml` | CRE project/workflow/target config template |
| `secrets.json.template` | off-chain secrets template (Data Streams creds for live volatile) |
| `scripts/simulate.sh` | CRE CLI local-simulation runner (+ manual fallback) |
| `.env.example` | env template (SPEC §14) |

---

## Env (SPEC §14)

`RPC_URL`, `CHAIN_ID`, `ESCROW_ADDRESS`, `PRIVATE_KEY` (keeper key, local mode
only), `USDC_ADDRESS` (the stable token), `BACKEND_URL`, `DATASTREAMS_FEED_ETHUSD`,
`CHAINLINK_DATASTREAMS_API_KEY/SECRET`, `CRE_*`, and `MOCK=true` to run the whole
thing locally with no third-party accounts. The CRE workflow itself reads its
config from `config.json` (the WASM sandbox has no env); the `.env` vars drive
the offline keeper/scan tools.

---

## What needs the live CRE network / keys

- **Everything in section A works with zero Chainlink accounts** (mock mode).
- The **live workflow** (`cre workflow simulate`/`deploy` in section B) needs the
  **bun runtime + CRE CLI** to compile TS→WASM; `local-simulation` runs on your
  machine (no CRE account) but still needs the CLI, and `--broadcast`/deploy need
  a reachable RPC (anvil is fine for simulate).
- **Deploying to a live CRE DON** needs **CRE account access (Early Access) +
  funded keys** (`cre login`).
- A **live volatile-token** settlement needs real **Data Streams API
  credentials** so `getReport` returns a signed report the on-chain Verifier
  accepts; in MOCK mode it returns `0x`.

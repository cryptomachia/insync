# Handoff — Integration & Run Checklist

The precise order to assemble the 10 module clones into one tree, bring the stack
up locally (mock mode), run the tests, and swap to live sponsor keys.

This layer (`e2e/`, `scripts/`, `Makefile`, `DEMO.md`) was authored against the
**final integrated layout** in [`SPEC.md`](../SPEC.md) §2 — the other modules
(`contracts/script`, `apps/web`, `backend/`, `cre/`, the real `packages/*`) live
in separate clones and must be copied in before `make dev` works fully.

---

## A. Assemble the monorepo (once)

Copy each agent's directory into a single tree so the final layout matches §2:

```
handoff/
  SPEC.md README.md package.json .env.example .gitignore   (foundation)
  Makefile DEMO.md                                          (this layer)
  scripts/  e2e/                                            (this layer)
  packages/contracts-abi/   <- AGENT 1/2 real ABI JSON + frozen index.ts
  packages/datastreams/     <- AGENT 4
  packages/auth/            <- AGENT 5
  packages/funding/         <- AGENT 6
  packages/qr/              <- AGENT 7
  contracts/                <- AGENT 1 (Escrow.sol, script/Deploy.s.sol, test/) + AGENT 2 (Reputation.sol)
  apps/web/                 <- AGENT 8 (Next.js; transpilePackages set)
  backend/                  <- AGENT 9 (Fastify indexer + API)
  cre/                      <- AGENT 3 (Chainlink CRE workflow + local keeper)
```

**Must-haves for the scripts to work unchanged:**

- [ ] `contracts/script/Deploy.s.sol` exists and deploys (at minimum) the
      **Escrow** and a **USDC** token (MockERC20 on anvil). Reputation +
      MockVerifier optional. `scripts/deploy.sh` runs it with `--broadcast`.
- [ ] The deploy exposes addresses one of these ways (checked in order by
      `scripts/parse-deploy.mjs`):
  1. writes `contracts/deployments/<chainId>.json` as `{ "ESCROW_ADDRESS": "0x..", ... }` (most robust), **or**
  2. relies on the Foundry **broadcast artifact** `contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json` (contract names containing `escrow`/`erc20|usdc|stable`/`verifier`/`reputation` are auto-classified), **or**
  3. prints `ESCROW_ADDRESS=0x..` (or `Escrow: 0x..`) lines to stdout.
- [ ] `apps/web` has `npm run dev` (Next.js on port 3000) and reads
      `NEXT_PUBLIC_*` from `apps/web/.env.local`.
- [ ] `backend/` has `npm run dev` (Fastify on `PORT`, default 8787) with
      `GET /health`, and reads `backend/.env`.
- [ ] `cre/` has `npm run dev` for the local keeper loop (and ideally a one-shot
      `npm run reclaim`) reading `cre/.env`.
- [ ] `packages/*` keep the **frozen exports/signatures** from SPEC §5–§9.

> The `MockERC20` is expected to expose `mint(address,uint256)` so the buyer
> wallet can be funded by the script-level e2e. If it doesn't, have `Deploy.s.sol`
> pre-mint USDC to anvil accounts 0 and 1.

---

## B. Install (once per checkout)

```bash
make install
```

This runs `npm install` at the root (workspaces = `packages/*` + `apps/*`),
builds `@handoff/contracts-abi`, installs the **standalone** `backend/`, `cre/`,
and `e2e/` packages, runs `forge install` for contract libs, and installs the
Playwright chromium browser.

- [ ] Foundry installed (`forge`, `anvil`, `cast`). The scripts auto-detect
      `~/.foundry/bin`; if missing: `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
- [ ] Node ≥ 20 (repo developed on Node 24).

---

## C. Bring up the stack locally (mock mode)

```bash
make dev
```

Order (each step echoes; failures stop with a clear message):

1. **anvil** — local chain (chainId 31337), background, deterministic accounts.
2. **deploy** — `forge script Deploy.s.sol --broadcast` → parse addresses →
   write `.env`, `apps/web/.env.local`, `backend/.env`, `cre/.env`
   (idempotent; preserves any other keys you set).
3. **backend** — indexer + API; waits on `GET /health`.
4. **web** — Next.js dev server (mock auth/funding, real on-chain txs to anvil).
5. **cre** — local keeper loop (reclaim past-expiry deals against anvil).

URLs: web `:3000` · backend `:8787` · rpc `:8545`. **Ctrl-C** tears it all down.

Individual steps if you prefer:

```bash
make anvil-bg      # start anvil only (background)
make deploy        # deploy + write env (anvil must be up)
make down          # stop background anvil
make clean         # remove artifacts + local .env files
```

---

## D. Run the tests

```bash
make test          # forge tests + e2e (contract-level + Playwright UI)
```

Granular:

```bash
make contracts-test   # forge test -vv
make e2e-contract     # viem script-level: every §4 branch + volatile release
make e2e-ui           # Playwright: happy path + a cancel branch (boots apps/web)
make typecheck        # tsc --noEmit across TS + e2e
```

- The **script-level e2e** (`e2e/scripts/contract-e2e.ts`) needs anvil up +
  contracts deployed (`make anvil-bg && make deploy`) and reads addresses from
  the root `.env`. It uses anvil account 0 (seller) and 1 (buyer).
- The **Playwright e2e** boots `apps/web` itself in `NEXT_PUBLIC_MOCK=true`
  (or reuses a server you already started with `make dev` — set `REUSE_SERVER=1`
  to never manage one). Selectors are role/text-based (`e2e/tests/_helpers.ts`);
  adjust the regexes there if AGENT 8's labels differ.

---

## E. Swap mock → live sponsor keys

Mock is the default everywhere (`MOCK=true` / `NEXT_PUBLIC_MOCK=true`). To go
live, edit the **root `.env`** (and re-run `make deploy` if you change chain
config), then restart `make dev`:

1. **Turn off mock:** set `MOCK=false` and `NEXT_PUBLIC_MOCK=false`.
2. **Chain (Base Sepolia):**
   - `CHAIN_ID=84532`, `RPC_URL=<your Base Sepolia RPC>`
   - `PRIVATE_KEY=<deployer/keeper key>` (a real funded testnet key — never a
     mainnet key).
   - `USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e` *(verify before
     use)*, or deploy your own.
3. **Dynamic (auth):** `NEXT_PUBLIC_DYNAMIC_ENV_ID=<env id>`.
4. **Blink (funding):** `NEXT_PUBLIC_BLINK_API_KEY=<key>`.
5. **Chainlink Data Streams:** `CHAINLINK_DATASTREAMS_API_KEY` +
   `CHAINLINK_DATASTREAMS_API_SECRET`, and set
   `DATASTREAMS_FEED_ETHUSD` / `NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD` to the real
   feed id. Set `VERIFIER_PROXY_ADDRESS` to the live Data Streams Verifier proxy
   so volatile deals are accepted on-chain.
6. **Chainlink CRE:** populate `CRE_*` and deploy/simulate the workflow per
   `cre/README.md`; point `BACKEND_URL` at your reachable backend.

> Each module gates its live integration behind these env flags (SPEC §2), so you
> can flip them on **one at a time** — e.g. live Dynamic auth while everything
> else stays mock — to de-risk the demo.

Re-run `make dev`; the deploy step rewrites the address keys and leaves your live
keys intact (the env writer is non-destructive).

---

## F. Pre-demo smoke test (do right before presenting)

```bash
make clean && make dev          # fresh stack
make e2e-contract               # ~5s: proves all §4 outcomes + volatile release
```

Then walk [`DEMO.md`](../DEMO.md) paths 1–3. If any UI step misbehaves on stage,
`make e2e-contract` is your deterministic fallback that proves the chain logic.

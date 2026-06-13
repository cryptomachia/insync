# Handoff

Trustless in-person escrow for buying from strangers. The seller sees the buyer's funds are
**real and locked before anyone travels** (kills flaking); at the meet the buyer scans the
seller's QR and funds settle **instantly and finally — no bank, no chargeback**. Two strangers
with no shared financial institution can transact safely. That's impossible without crypto.

- **In-person, dispute-free** escrow with a **commitment-deposit** (earnest-money) cancellation model.
- **Dynamic** embedded wallets (email login) · **Blink** one-tap USDC funding.
- **Chainlink CRE** orchestrates auto-refunds; **Chainlink Data Streams** price-locks volatile-token payments.

See [SPEC.md](./SPEC.md) for the full architecture and module contracts.
Run instructions and the demo script are appended below / in `DEMO.md` after integration.

## Layout
`contracts/` Solidity escrow + reputation · `packages/*` (auth/funding/qr/datastreams/contracts-abi)
· `apps/web/` Next.js app · `backend/` indexer+API · `cre/` Chainlink workflow · `e2e/` tests.

> Everything runs locally with `MOCK=true` (no third-party accounts). Live sponsor infra
> activates by dropping real keys into `.env`.

## Run it

Everything runs locally with **no third-party accounts** (`MOCK=true`). You need
[Foundry](https://book.getfoundry.sh/getting-started/installation)
(`forge`/`anvil`/`cast`) and Node ≥ 20.

```bash
make install     # deps for contracts + packages + apps + standalone e2e/backend/cre
make dev         # anvil + deploy + backend + web + Chainlink CRE local keeper
```

`make dev` brings up the whole stack and prints the URLs:

```
web      http://127.0.0.1:3000     # the app (mobile-first; open in a phone-sized window)
backend  http://127.0.0.1:8787     # indexer + API
rpc      http://127.0.0.1:8545     # local anvil chain (id 31337)
```

In mock mode you're auto-logged-in (Dynamic mock), funding does a real on-chain
USDC approve+`fund` on anvil (Blink mock), and the QR step has a paste fallback.
**Ctrl-C** tears the stack down.

### Test

```bash
make test          # forge tests + e2e (contract-level via viem + Playwright UI)
make e2e-contract  # ~5s: every §4 cancellation outcome + the volatile Data Streams release
make e2e-ui        # Playwright: happy path + a cancel branch (boots apps/web in mock mode)
make typecheck     # tsc --noEmit across TS + e2e
```

### Common targets

| Target | What it does |
|---|---|
| `make dev` | Full local stack (anvil + deploy + backend + web + CRE keeper). |
| `make build` | `forge build` + all JS workspaces. |
| `make test` | Foundry tests + e2e. |
| `make anvil-bg` / `make deploy` | Start anvil / deploy contracts + write all `.env` files. |
| `make down` / `make clean` | Stop background anvil / remove artifacts + local env files. |
| `make help` | List every target. |

### Going live

Drop real keys into the root `.env` (Dynamic, Blink, Chainlink Data Streams,
Base Sepolia RPC + `PRIVATE_KEY`), set `MOCK=false`/`NEXT_PUBLIC_MOCK=false`, and
re-run `make dev`. You can flip sponsors on one at a time. Full steps:
[`e2e/CHECKLIST.md`](./e2e/CHECKLIST.md).

### The demo

The 3-path live demo (happy · no-show CRE reclaim · volatile Data Streams) is in
[`DEMO.md`](./DEMO.md). The exact integration order is in
[`e2e/CHECKLIST.md`](./e2e/CHECKLIST.md).

> **Note:** this devx layer (`scripts/`, `e2e/`, `Makefile`, `DEMO.md`) is built
> against the final integrated layout (SPEC §2). The other module clones must be
> assembled into one tree before `make dev` runs the full stack — see the
> checklist. The scripts fail with clear messages if a module dir is missing.

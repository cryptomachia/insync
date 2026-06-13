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

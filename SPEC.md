# inSync — Build Specification (the bible)

> This spec is the single source of truth — build each module against the
> interfaces defined here. Do not change interfaces without it being reflected here.
> Treat function signatures, event signatures, module exports, and env var names as a
> frozen contract between modules.

## 1. What we're building

**inSync** — trustless escrow for buying from a stranger on Marketplace/Craigslist, where
funds release only at the in-person handoff. The structural pitch (say it in every README):
two strangers with no shared bank, no cash changing hands, **final settlement (no
chargebacks)**, and **provably-committed funds before anyone travels** (the seller sees the
buyer's money is real and locked before agreeing to meet — this kills flaking, the #1
Marketplace pain). That combination is impossible without crypto.

### Locked product decisions
- **In-person only.** Release = buyer scans the seller's one-time QR at the meet.
- **Dispute-free.** No judge/jury/AI adjudication. Every outcome is a deterministic rule or a
  mutual on-chain signature (trivial in person).
- **Cancellation = commitment-deposit ("earnest money") model** (see §4). The item price is
  always safe for the buyer; only a small, seller-set deposit is ever at risk, and only when
  the buyer flakes after the seller has shown up.
- **Wallets:** Dynamic embedded wallets (email login).
- **Funding:** Blink one-tap USDC deposit.
- **Chainlink (deep):** CRE workflow (orchestration/auto-refund) = anchor; Data Streams
  price-lock for volatile-token payment = second track.

### Sponsor prize targets (context for READMEs/demo)
- Chainlink Best CRE workflow (anchor) · Chainlink Connect-the-World (Data Streams) ·
  Blink Best consumer app (Scratch) · Dynamic Best Money App.

## 2. Monorepo layout & ownership

```
handoff/
  SPEC.md  README.md  .gitignore  .env.example  package.json   (foundation — do not rewrite)
  packages/contracts-abi/   (foundation stub; contracts build overwrites with real ABI)
  contracts/                Escrow.sol + Reputation.sol + tests + deploy
  packages/datastreams/     Chainlink Data Streams price helper + report fetch
  packages/auth/            Dynamic embedded wallets (email login)
  packages/funding/         Blink one-tap USDC funding
  packages/qr/              QR handshake (in-person release)
  apps/web/                 Next.js app; imports the packages above
  backend/                  notification API + event indexer
  cre/                      Chainlink CRE workflow
  e2e/  scripts/  Makefile  DEMO.md   integration, e2e, devx, docs
```

Module boundaries (keep the codebase conflict-free):
- **Each module owns the files inside its directory.** Never edit another module's
  dir or the foundation files. The contracts module shares `contracts/` but different files (see §3).
- Every package is its own npm package named `@handoff/<dir>` with its own `package.json`.
- Frontend modules (auth/funding/qr/datastreams) are standalone packages that `apps/web`
  imports; `apps/web` sets `transpilePackages` for them.
- Code against the **ABI in `packages/contracts-abi`** (a stub now; real artifact at
  integration — identical signatures, so your code keeps working).
- Anything needing a live third-party key MUST support a **mock mode** gated by an env flag
  so the app builds and the local e2e runs offline. `NEXT_PUBLIC_MOCK=true` (frontend) /
  `MOCK=true` (node) enables mocks.

## 3. Smart contracts

Solidity `^0.8.24`. Prefer **Foundry** (install via `curl -L https://foundry.paradigm.xyz | bash && foundryup`);
if that fails in this environment, use **Hardhat + viem**. Either way: a real, **passing**
test suite is the deliverable. Use OpenZeppelin (`SafeERC20`, `ReentrancyGuard`, `Ownable`).

### Denomination
- `priceUsd1e8`: item price in USD with **8 decimals** ($80.00 = `80_00000000`).
- `depositBps`: deposit as basis points of price (e.g. `1000` = 10%).
- USDC has 6 decimals → `usdcAmount = priceUsd1e8 / 100`.
- A "stable" `payToken` (USDC) needs no oracle. A volatile `payToken` is priced at
  release/cancel via Data Streams (§6).

### `contracts/src/Escrow.sol`

States: `enum State { None, Funded, SellerCheckedIn, Completed, Refunded, Forfeited }`

Functions (exact signatures — the ABI stub mirrors these):
```solidity
// The SELLER sets the cancellation timing policy on the listing (durations in seconds applied
// from fund time): freeCancelWindow = how long the buyer may cancel for a full refund; dealTtl =
// when the deal expires/becomes reclaimable. Buyer-supplied timing is NOT accepted, so the buyer
// can't widen their own free-refund window and neuter the deposit-at-risk. Require dealTtl > 0 and
// freeCancelWindow <= dealTtl (validated in list()).
// bondAmount: the SELLER's no-show bond, staked in payToken at list time and held by the escrow.
// Returned to the seller on every honest outcome; FORFEITED TO THE BUYER if the seller no-shows
// (mirror of the buyer deposit → symmetric ghosting). Listings are single-use (funding consumes
// them); cancelListing() lets the seller withdraw an unfunded listing and reclaim the bond.
function list(uint256 priceUsd1e8, uint16 depositBps, address payToken, uint64 freeCancelWindow, uint64 dealTtl, uint256 bondAmount) external returns (uint256 listingId);
function cancelListing(uint256 listingId) external;
function getListing(uint256 listingId) external view returns (address seller, uint256 priceUsd1e8, uint16 depositBps, address payToken, bool active, uint64 freeCancelWindow, uint64 dealTtl, uint256 bond);
function bondOf(uint256 dealId) external view returns (uint256);

// buyer locks tokenAmount of payToken (must cover price+deposit, with buffer if volatile).
// The deal's freeCancelUntil/expiry are DERIVED on-chain from the listing's policy + the fund
// block timestamp; the buyer passes no timing.
function fund(uint256 listingId, uint256 tokenAmount) external returns (uint256 dealId);

function checkIn(uint256 dealId) external;                       // seller, at the meet; gates forfeiture
function confirmReceipt(uint256 dealId, bytes calldata report) external;  // buyer; success
function agreeCancel(uint256 dealId) external;                   // seller; full refund to buyer
function buyerCancel(uint256 dealId, bytes calldata report) external;     // buyer; see §4 rules
function reclaimExpired(uint256 dealId, bytes calldata report) external;  // anyone/CRE after expiry

function getDeal(uint256 dealId) external view returns (
  uint8 state, address buyer, address seller, address payToken,
  uint256 priceUsd1e8, uint256 tokenAmount, uint16 depositBps,
  uint64 freeCancelUntil, uint64 expiry, bool sellerCheckedIn);
```
`report` is the Data Streams payload; ignored when `payToken` is the configured stable
(USDC). For a stable token `report` may be empty bytes.

Events (indexers/CRE/frontend depend on these — freeze them):
```solidity
event Listed(uint256 indexed listingId, address indexed seller, uint256 priceUsd1e8, uint16 depositBps, address payToken, uint64 freeCancelWindow, uint64 dealTtl, uint256 bond);
event ListingCancelled(uint256 indexed listingId);
event BondSettled(uint256 indexed dealId, address indexed to, uint256 amount); // to==seller: returned; to==buyer: forfeited
event Funded(uint256 indexed dealId, uint256 indexed listingId, address indexed buyer, address seller, uint256 tokenAmount, uint64 freeCancelUntil, uint64 expiry);
event CheckedIn(uint256 indexed dealId);
event Completed(uint256 indexed dealId, uint256 sellerPaid, uint256 buyerRefunded);
event Refunded(uint256 indexed dealId, uint256 amount);
event Forfeited(uint256 indexed dealId, uint256 toBuyer, uint256 toSeller);
```
Config (constructor / owner-set): `stableToken` (USDC), `verifierProxy` (Data Streams, may be
`address(0)` → then only stable deals allowed), optional `reputation` (IReputation, §3b).
On every terminal transition, if `reputation != address(0)`, call the matching hook.

Security: `nonReentrant` on all money-moving fns, `SafeERC20`, checks-effects-interactions,
explicit state guards, custom errors. Document the volatility shortfall edge case in NatSpec.

Deliver: `contracts/src/Escrow.sol`, interfaces, full tests in `contracts/test/`
(happy path, every cancel branch in §4, volatile-token release with a mock verifier,
reentrancy, access control), `contracts/script/Deploy.s.sol` (or Hardhat deploy),
`foundry.toml`/`hardhat.config`, and **export the ABI to `packages/contracts-abi/src/Escrow.json`**.
Provide a `MockERC20` and a `MockVerifier` for tests and local anvil.

### `contracts/src/Reputation.sol` + `IReputation`

On-chain tally of outcomes, written **only by the Escrow** (set `escrow` address; `onlyEscrow`).
```solidity
interface IReputation {
  function onCompleted(address buyer, address seller) external;
  function onBuyerFlake(address buyer, address seller) external;   // deposit forfeited
  function onSellerNoShow(address buyer, address seller) external; // refunded, seller absent
  function onMutualCancel(address buyer, address seller) external;
}
```
Store per-address counters + view getters (`scoreOf`, `statsOf`). Add tests. Coordinate with
the module only through this interface (it lives in `contracts/src/IReputation.sol`; the module
imports it and calls it if configured). Also deliver an optional tiny UI badge component in
`packages/auth`? No — keep it contract-only; the frontend reads scores via the ABI.
Append your ABI to `packages/contracts-abi/src/Reputation.json`.

## 4. Cancellation rules (the commitment-deposit model)

Held at fund = item price portion + deposit portion (in `payToken`). Outcomes:

The seller also stakes a **no-show bond** at list time (see §3). It is returned to the seller on
every honest outcome and **forfeited to the buyer** when the seller no-shows (the two `seller not
checked in` rows below) — the mirror of the buyer deposit, making ghosting two-sided.

| Trigger | Item price | Deposit | Seller bond |
|---|---|---|---|
| `confirmReceipt` (success) | → seller | → back to buyer | → seller |
| `agreeCancel` (seller co-signs) | → buyer | → buyer | → seller |
| `buyerCancel` **before** `freeCancelUntil` | → buyer | → buyer | → seller |
| `buyerCancel` **after** free window **and** seller `checkIn`ed | → buyer | **→ seller** | → seller |
| `buyerCancel` after free window, seller **not** checked in | → buyer | → buyer | **→ buyer** |
| `reclaimExpired` (after `expiry`), seller `checkIn`ed | → buyer | → seller | → seller |
| `reclaimExpired`, seller not checked in | → buyer | → buyer | **→ buyer** |

For volatile `payToken`, "item price"/"deposit" are computed in USD via Data Streams at the
moment of the call; surplus token returns to the buyer. If the deposit/price worth exceeds
the held amount (token crashed past buffer), pay out what's available preferring the buyer's
price portion first; document this. Seller-set `depositBps` is the per-listing cancellation
policy; buyer sees it before funding.

## 5. Shared ABI package (`packages/contracts-abi`) — FOUNDATION (stub) → the module/2 (real)

Exports for all TS consumers:
- `escrowAbi` (viem human-readable array, frozen to §3), `reputationAbi`.
- `getAddresses()` reading `*_ESCROW_ADDRESS` / `*_REPUTATION_ADDRESS` / `*_USDC_ADDRESS`
  from env (both `NEXT_PUBLIC_` and plain).
The contracts build replaces the JSON artifacts but **must keep these exports and the
signatures** so frontend/backend/cre keep compiling.

## 6. Data Streams package (`packages/datastreams`)

Purpose: fetch a signed Chainlink Data Streams report for a feed and produce the `bytes`
blob passed to `confirmReceipt`/`buyerCancel`/`reclaimExpired`; plus a price helper for UI.
Read the docs: https://docs.chain.link/data-streams . The on-chain side verifies the report
through the Verifier proxy; coordinate the report encoding with the module's `MockVerifier` so
local tests/e2e work without live keys.

Exports (frozen):
```ts
export async function getReport(feedId: string): Promise<`0x${string}`>;       // live or mock
export async function getTokenPriceUsd1e8(feedId: string): Promise<bigint>;    // for UI estimates
export const FEEDS: Record<string, string>;  // e.g. { 'ETH/USD': '0x...' }
export const MOCK: boolean;                   // true when MOCK/NEXT_PUBLIC_MOCK set
```
Mock mode: `getReport` returns a deterministic blob the `MockVerifier` accepts and
`getTokenPriceUsd1e8` returns a fixed price (e.g. `4000_00000000`). Include unit tests.

## 7. Auth package (`packages/auth`) (Dynamic)

Dynamic embedded wallets, email login. Docs:
https://www.dynamic.xyz/docs . Exports (frozen depends on these):
```ts
export function HandoffAuthProvider(props: { children: React.ReactNode }): JSX.Element;
export function useAuth(): { ready: boolean; isConnected: boolean; address?: `0x${string}`;
  email?: string; login: () => void; logout: () => void };
export function useWalletClient(): import('viem').WalletClient | undefined; // for tx signing
```
Env: `NEXT_PUBLIC_DYNAMIC_ENV_ID`. Mock mode (`NEXT_PUBLIC_MOCK=true`): a fake provider that
"logs in" with a deterministic local anvil account and returns a viem wallet client for it,
so the app runs with no Dynamic account. Peer deps: react, viem. Ship a tiny `<AuthButton/>`.

## 8. Funding package (`packages/funding`) (Blink)

One-tap USDC deposit that approves+calls `Escrow.fund`. Docs:
https://docs.blink.cash/introduction . Exports (frozen):
```ts
// Renders the one-tap fund button; on success resolves with the new dealId.
export function FundButton(props: { listingId: bigint; tokenAmount: bigint;
  freeCancelUntil: bigint; expiry: bigint; walletClient: import('viem').WalletClient;
  onFunded: (dealId: bigint) => void; onError?: (e: unknown) => void }): JSX.Element;
export function useFunding(): { fund: (args: { listingId: bigint; tokenAmount: bigint;
  freeCancelUntil: bigint; expiry: bigint; walletClient: import('viem').WalletClient })
  => Promise<bigint> };
```
Env: `NEXT_PUBLIC_BLINK_API_KEY`. Mock mode: skip Blink, just do ERC20 approve + `fund` with
the provided wallet client against local anvil (still a real on-chain tx locally). Peer deps:
react, viem. Use `escrowAbi`/`getAddresses` from `@handoff/contracts-abi`.

## 9. QR handshake package (`packages/qr`)

The in-person release. Seller shows a one-time QR encoding `{ dealId, nonce }` (and optionally
a short-lived signature). Buyer scans → app calls `confirmReceipt(dealId, report)`.
Exports (frozen):
```ts
export function ReleaseQR(props: { dealId: bigint }): JSX.Element;          // seller side
export function ScanToRelease(props: { onScan: (p: { dealId: bigint }) => void;
  onError?: (e: unknown) => void }): JSX.Element;                           // buyer side, camera
export function encodeHandoff(p: { dealId: bigint; nonce: string }): string;
export function decodeHandoff(s: string): { dealId: bigint; nonce: string };
```
Use `qrcode` for generation and `html5-qrcode` (or `@yudiel/react-qr-scanner`) for scanning.
Peer dep: react. Pure module — no chain calls (the module wires the scan result to
`confirmReceipt`). Include a non-camera fallback (paste the code) for desktop demo.

## 10. Web app (`apps/web`) (frontend lead)

Next.js 14 (app router) + TS + Tailwind + viem/wagmi. Mobile-first (it's a meetup app).
Owns the whole `apps/web` tree and **imports** `@handoff/auth`, `@handoff/funding`,
`@handoff/qr`, `@handoff/datastreams`, `@handoff/contracts-abi`. Set
`transpilePackages: ['@handoff/auth','@handoff/funding','@handoff/qr','@handoff/datastreams','@handoff/contracts-abi']`
in `next.config`. Screens:
1. **Sell** — create a listing (`list`): price (USD), deposit policy (`depositBps`), token.
2. **Buy** — view a listing; see the deposit policy; **FundButton** to lock funds; show
   "funds committed" state the seller can verify.
3. **Deal** — lifecycle UI for both roles: seller `checkIn` + `ReleaseQR`; buyer
   `ScanToRelease` → `confirmReceipt`; cancel actions (`buyerCancel`/`agreeCancel`) with the
   §4 outcomes shown plainly ("cancel now: you get your $80 back, seller keeps the $8 deposit").
4. **Status/My deals** — list via backend (`@handoff/...` not needed; fetch `BACKEND_URL`).
Read deal/listing state via viem using `escrowAbi`. For volatile tokens, call
`@handoff/datastreams.getReport` and pass it into `confirmReceipt`. Everything must run with
`NEXT_PUBLIC_MOCK=true` against local anvil. Deliver a clean, demo-ready UI.

## 11. Backend (`backend/`)

Node + Fastify + better-sqlite3 + viem. Two jobs:
- **Indexer:** subscribe to Escrow events (RPC from env), persist deals/listings to sqlite.
- **API:** `GET /health`, `GET /deals?user=0x..`, `GET /deals/:id`, `GET /listings`,
  `POST /notify` `{ dealId, event }` (called by CRE — stub push/SMS by logging + storing a
  notification row; structure it so a real provider drops in). CORS open for the web app.
Env: `RPC_URL`, `ESCROW_ADDRESS`, `PORT` (default 8787), `DATABASE_PATH`. Use `escrowAbi`
from `@handoff/contracts-abi`. Provide `npm run dev` and a seed script. Add a couple of tests.

## 12. CRE workflow (`cre/`)

Chainlink CRE workflow (TypeScript SDK). Docs: https://docs.chain.link/cre ,
templates: https://github.com/smartcontractkit/cre-templates . The workflow is the escrow's
orchestration brain:
- On a schedule, read active deals from the Escrow (or the backend `GET /deals`), find any
  past `expiry` not in a terminal state, and **call `reclaimExpired(dealId, report)`** (the
  required on-chain state change; build the `report` via `@handoff/datastreams.getReport` for
  volatile deals).
- On lifecycle changes, `POST` the backend `/notify`.
Deliver the workflow source, a **CRE CLI simulation** command/script that demonstrates a
successful run (the prize lets them deploy a simulated workflow live), config templates, and a
README explaining the simulate/deploy steps and exactly where Chainlink causes the state
change. Provide a `MOCK`/local mode that targets local anvil + the deployed Escrow so it can
be demoed without the live CRE network. Env: `RPC_URL`, `ESCROW_ADDRESS`, `BACKEND_URL`,
`CRE_*`, `PRIVATE_KEY` (a keeper key for the reclaim tx in local mode).

## 13. Integration / e2e / devx (`e2e/`, `scripts/`, `Makefile`, `DEMO.md`)

- `scripts/`: start local anvil, deploy contracts (call the contracts deploy), write
  resulting addresses into `.env`/`.env.local` for all apps.
- Root `npm` scripts + `Makefile`: `make dev` (anvil + deploy + backend + web + cre local),
  `make test` (contracts + e2e), `make build`.
- `e2e/`: Playwright test covering the **happy path** (login → list → fund → checkIn → scan →
  released) and at least one **cancel branch**, all in `NEXT_PUBLIC_MOCK=true` against local
  anvil. Also a script-level e2e hitting the contract directly via viem for the volatile-token
  release and each §4 branch.
- `DEMO.md`: the 3-path live demo script (happy / no-show CRE reclaim / volatile Data Streams
  settlement) with exact click-by-click steps.
- Assemble the final root `README.md` "Run it" section and an integration checklist.
You may read every other dir but only **create** files in yours + the root `README.md` "Run"
section (append; don't clobber foundation text) + `Makefile` + `DEMO.md`.

## 14. Env vars (see `.env.example`)
Chain: `RPC_URL`, `CHAIN_ID` (84532 Base Sepolia / 31337 anvil), `PRIVATE_KEY`,
`USDC_ADDRESS`, `ESCROW_ADDRESS`, `REPUTATION_ADDRESS`, `VERIFIER_PROXY_ADDRESS`.
Frontend (`NEXT_PUBLIC_`): `MOCK`, `CHAIN_ID`, `RPC_URL`, `ESCROW_ADDRESS`,
`REPUTATION_ADDRESS`, `USDC_ADDRESS`, `DYNAMIC_ENV_ID`, `BLINK_API_KEY`, `BACKEND_URL`,
`DATASTREAMS_FEED_ETHUSD`.
Data Streams: `CHAINLINK_DATASTREAMS_API_KEY`, `CHAINLINK_DATASTREAMS_API_SECRET`,
`DATASTREAMS_FEED_ETHUSD`. Backend: `PORT`, `DATABASE_PATH`. CRE: `CRE_*`, `BACKEND_URL`.
`MOCK=true` everywhere makes the whole system run locally with no third-party accounts.

## 15. Tech pins
Solidity 0.8.24 · Foundry (fallback Hardhat) · OpenZeppelin · Next.js 14 · React 18 · TS 5 ·
Tailwind · viem 2 · wagmi 2 · @dynamic-labs/sdk-react-core · qrcode + html5-qrcode · Fastify ·
better-sqlite3 · Node 24 · npm workspaces · Base Sepolia (84532), anvil (31337).
Default USDC (Base Sepolia): `0x036CbD53842c5426634e7929541eC2318f3dCF7e` — **verify** before
mainnet/testnet use; for local anvil deploy `MockERC20` and use its address.

## 16. Demo script (the win condition)
1. **Happy:** seller lists a bike $80 / 10% deposit → buyer logs in (email) → one-tap funds
   $88 → seller sees "funds committed" → they "meet": seller checks in + shows QR → buyer
   scans → `Completed`: seller paid $80, buyer refunded $8 deposit. Final, no bank.
2. **No-show:** buyer funds, nobody completes → after expiry the **CRE** workflow calls
   `reclaimExpired` → buyer refunded (or deposit→seller if seller had checked in).
3. **Volatile + Data Streams:** buyer pays in a volatile token → at release **Data Streams**
   prices it so the seller receives exactly $80-worth, surplus back to the buyer.

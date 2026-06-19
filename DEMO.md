# inSync — Live Demo Script (the win condition)

Three paths, ~4 minutes total. Everything runs locally with `MOCK=true` (no
third-party accounts); the same flows work against Base Sepolia by dropping real
keys into `.env` (see [`e2e/CHECKLIST.md`](./e2e/CHECKLIST.md)).

> **One-liner before you present:** the seller sees the buyer's money is *real and
> locked before anyone travels* (kills flaking), and at the meet funds settle
> *instantly and finally — no bank, no chargeback*. Impossible without crypto.

> **Since this script was written, the app also has:** a **seller no-show bond**
> (the seller stakes too, forfeited to the buyer if the seller ghosts — flaking is
> now penalised on *both* sides), **pre-deal chat + offers** (buyers message and
> "Make offer"; sellers Accept/Decline from a `/messages` inbox), **browse by
> category / condition / price / distance**, and **multi-photo galleries**. The
> three paths below still demo the escrow core; mention the bond when you list.

---

## 0. Pre-flight (do this once, before the audience)

```bash
make install        # deps for contracts + all packages/apps + e2e
make dev            # anvil + deploy + backend + web + CRE local keeper
```

`make dev` echoes each step and prints:

```
✓ inSync is up:
    web      http://127.0.0.1:3000
    backend  http://127.0.0.1:8787
    rpc      http://127.0.0.1:8545
```

Open **http://127.0.0.1:3000** on a phone-sized window (the app is mobile-first).
In mock mode you are auto-logged-in as a demo email (anvil account 0). Have a
second browser profile / incognito window ready for the **buyer** role.

Sanity check (optional, proves the chain logic end-to-end in ~5s):

```bash
make e2e-contract   # runs every §4 branch + the volatile release via viem
```

---

## Path 1 — Happy path (the core pitch) · ~90s

**Story:** "I'm selling a bike for \$80 with a 10% deposit. A stranger funds it,
we meet, they scan my QR, done — final settlement, no bank."

| # | Who | Click-by-click | What to say |
|---|-----|----------------|-------------|
| 1 | Seller | Open the app → **Sell** | "I list a bike." |
| 2 | Seller | Price = **80**, Deposit policy = **10%**, Token = **USDC** → **Create listing** | "Price \$80, I set a 10% earnest deposit so buyers can't flake on me." |
| 3 | Seller | Copy the listing link / show the listing | "Here's the listing a buyer would see." |
| 4 | Buyer | Open the listing (second window) → **Buy** | "The buyer logs in with just an email — Dynamic embedded wallet, no seed phrase." |
| 5 | Buyer | Read the deposit policy, then tap **Fund (one tap)** | "One tap funds \$88 — \$80 price + \$8 deposit — via Blink. This is a real on-chain USDC lock." |
| 6 | Seller | Refresh the Deal screen → **"funds committed"** | "**This is the magic:** I can *see the money is real and locked* before I drive anywhere. Flaking is dead." |
| 7 | Both | "We meet in person." Seller taps **Check in** | "I show up and check in — that's what gates the deposit rules." |
| 8 | Seller | A **Release QR** appears | "I show my one-time QR." |
| 9 | Buyer | Tap **Scan to release** → scan (or **paste the handoff code** on desktop) → **Confirm receipt** | "Buyer scans, confirms they got the bike." |
| 10 | Both | Deal → **Completed**: *seller paid \$80, buyer refunded the \$8 deposit* | "Settled. **Final. No chargeback. No bank.** The deposit comes back because the deal succeeded." |

**Prize beat:** Dynamic (email login) · Blink (one-tap fund).

---

## Path 2 — No-show → **Chainlink CRE** auto-reclaim · ~60s

**Story:** "Buyer funds, then nobody completes. After the deadline, Chainlink's
CRE workflow reclaims the funds automatically — no one has to babysit it."

| # | Who | Click-by-click | What to say |
|---|-----|----------------|-------------|
| 1 | Buyer | List + fund a new item exactly like Path 1, but with a **short expiry** (the demo listing uses a near-term `expiry`) | "Buyer funds again, but this time we never meet." |
| 2 | — | Wait for `expiry` to pass (a few seconds on anvil; the CRE local keeper polls on a schedule) | "Nobody completes. The deadline passes." |
| 3 | CRE | Watch the **`[cre]`** logs in the `make dev` terminal: it finds the past-expiry deal and calls **`reclaimExpired(dealId, report)`** | "**This is the Chainlink state change:** the CRE workflow — not a human — submits the on-chain reclaim transaction." |
| 4 | Buyer | Deal → **Refunded** (full \$88 back; the seller never checked in → no-show protection) | "Buyer is made whole automatically. If the *seller* had checked in and the buyer ghosted, the \$8 deposit would go to the seller instead (§4)." |

If you want to force it instantly instead of waiting:

```bash
# from the cre/ dir, the keeper does a single one-shot sweep by default:
cd cre && npm run keeper:local        # one-shot reclaim sweep
# (npm run keeper:local -- --watch   keeps sweeping on an interval — this is
#  what `make dev` runs; npm run keeper:local -- --dry-run previews, no tx)
```

**Prize beat:** Chainlink **CRE** (the anchor) — orchestration + auto-refund,
with the reclaim tx as the concrete on-chain state change.

---

## Path 3 — Volatile token → **Chainlink Data Streams** price-lock · ~60s

**Story:** "The buyer wants to pay in a volatile token (e.g. ETH). At the moment
of release, Chainlink Data Streams prices it so the seller receives *exactly
\$80-worth* and the surplus goes back to the buyer."

| # | Who | Click-by-click | What to say |
|---|-----|----------------|-------------|
| 1 | Seller | **Sell** a new item, choose a **volatile token** as the pay token (ETH/USD feed) | "Same \$80 bike, but priced in a volatile token." |
| 2 | Buyer | **Buy** → the UI shows a live USD estimate from `getTokenPriceUsd1e8` (Data Streams) and funds with a **buffer** | "Buyer locks enough token to cover \$88 plus a buffer for price moves." |
| 3 | Both | Meet → seller **Check in** + **Release QR** | "We meet, same as before." |
| 4 | Buyer | **Scan / paste** → **Confirm receipt**. Under the hood the app fetches a signed **Data Streams report** and passes it into `confirmReceipt(dealId, report)` | "**This is the second Chainlink track:** the signed Data Streams report is verified on-chain to price the token *at the instant of settlement*." |
| 5 | Both | **Completed**: seller receives exactly **\$80-worth** of the token; **surplus returns to the buyer** | "Seller gets exactly what they asked for in USD; the buyer isn't overpaying because the token moved. No oracle lag, no haggling." |

> Edge case worth a sentence: if the token crashes past the buffer, the contract
> pays out what's available, **preferring the buyer's price portion first** (§4 /
> NatSpec). Deterministic, dispute-free.

**Prize beat:** Chainlink **Data Streams** (Connect-the-World) — pull-based,
sub-second price for the volatile-token settlement.

---

## If something hiccups on stage

- **Web not loading?** It's mock mode — refresh; the auth provider auto-connects.
  Confirm `make dev` printed all three URLs and there are no `[web]` errors.
- **`funds committed` not showing for the seller?** Refresh the Deal screen; the
  backend indexer (`[backend]` logs) picks up the `Funded` event within a block.
- **CRE didn't fire?** Run the one-shot reclaim (`cd cre && npm run keeper:local`).
- **Fall back to the chain truth:** `make e2e-contract` proves all 7 §4 outcomes
  + the volatile release deterministically in ~5 seconds — run it live if a UI
  step misbehaves.
- **Reset everything:** `make down && make clean && make dev`.

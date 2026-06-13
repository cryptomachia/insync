#!/usr/bin/env bash
# ============================================================================
# simulate.sh — run the Handoff CRE reclaim workflow with the CRE CLI locally.
#
# This is the "CRE CLI simulation" deliverable (SPEC §12). It compiles the
# TypeScript workflow to WASM and executes it on your machine via the CRE CLI's
# local-simulation target. With --broadcast, the simulated workflow actually
# sends the reclaimExpired transaction to whatever RPC chainSelectorName
# resolves to (point that at anvil for a fully local on-chain state change).
#
# Prereqs (see README "Live / simulate"):
#   * bun            https://bun.com/         (CRE TS tooling + WASM compile)
#   * cre CLI        https://github.com/smartcontractkit/cre-cli
#   * npm i          (installs @chainlink/cre-sdk used by the compile step)
#
# Usage:
#   ./scripts/simulate.sh                 # dry simulate (reads only)
#   ./scripts/simulate.sh --broadcast     # simulate AND broadcast reclaim txs
#
# If the CRE CLI / bun are not installed, this script prints the exact manual
# commands and exits 0 (so a CI run on a machine without the CLI is not a hard
# failure) — and reminds you that `npm run keeper:dry-run` / `keeper:local`
# demonstrate the same logic with no Chainlink tooling at all.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."   # → cre/

CONFIG="${CRE_CONFIG:-config.json}"
WORKFLOW="src/workflow.ts"
EXTRA=()
if [[ "${1:-}" == "--broadcast" ]]; then
  EXTRA+=(--broadcast)
fi

echo "=== Handoff CRE workflow — local simulation ==="
echo "  workflow : $WORKFLOW"
echo "  config   : $CONFIG"
echo "  target   : local-simulation ${EXTRA[*]:-}"
echo ""

if ! command -v cre >/dev/null 2>&1; then
  cat <<'EOF'
[!] CRE CLI not found on PATH.

Install it, then run the simulation manually:

  # 1. install bun + the CRE CLI
  curl -fsSL https://bun.com/install | bash
  #    (CRE CLI: https://github.com/smartcontractkit/cre-cli/releases)

  # 2. one-time CRE setup inside cre/ (prepares the Javy WASM plugin)
  bunx cre-setup            # or: bun x @chainlink/cre-sdk cre-setup

  # 3. simulate (reads only)
  cre workflow simulate --target local-simulation --config config.json src/workflow.ts

  # 4. simulate AND broadcast the reclaimExpired tx (point RPC at anvil)
  cre workflow simulate --target local-simulation --config config.json --broadcast src/workflow.ts

No CLI? The SAME reclaim logic runs with zero Chainlink tooling:
  npm run keeper:dry-run     # in-memory, no chain
  npm run keeper:local       # viem against anvil + the deployed Escrow
EOF
  exit 0
fi

# CRE CLI is present — run the real simulation.
echo "[*] cre workflow simulate ..."
cre workflow simulate \
  --target local-simulation \
  --config "$CONFIG" \
  "${EXTRA[@]}" \
  "$WORKFLOW"

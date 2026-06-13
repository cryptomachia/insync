#!/usr/bin/env bash
# scripts/deploy.sh — deploy the Handoff contracts to the local anvil node and
# write the resulting addresses into every app's env file.
#
# Steps:
#   1. ensure anvil is reachable (RPC_URL)
#   2. run contracts/script/Deploy.s.sol with --broadcast (deployer = PRIVATE_KEY)
#   3. extract ESCROW/USDC/REPUTATION/VERIFIER addresses (scripts/parse-deploy.mjs)
#   4. write them into .env, apps/web/.env.local, backend/.env, cre/.env
#      (scripts/write-env.mjs — idempotent, preserves other keys)
#
# Run after `make anvil` (or `scripts/anvil.sh --bg`). Idempotent: re-running
# redeploys fresh contracts and rewrites the env files.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_foundry
[ -d "${CONTRACTS_DIR}" ] || die "contracts/ not found at ${CONTRACTS_DIR} (run after integration)"

DEPLOY_SCRIPT="${CONTRACTS_DIR}/script/Deploy.s.sol"
[ -f "${DEPLOY_SCRIPT}" ] || die "missing ${DEPLOY_SCRIPT} — AGENT 1 owns this file; deploy needs it"

# 1. anvil must be live
if ! anvil_up; then
  warn "anvil not reachable on ${RPC_URL}; trying to start one in the background"
  "${SCRIPT_DIR}/anvil.sh" --bg
fi
wait_for_anvil 60

# 2. forge script. We capture stdout so parse-deploy can scrape it as a fallback.
LOG_FILE="${RUN_DIR}/deploy.log"
step "Deploying contracts (forge script Deploy.s.sol --broadcast)"
info "deployer: anvil account 0 · rpc: ${RPC_URL}"
set +e
( cd "${CONTRACTS_DIR}" && forge script script/Deploy.s.sol:Deploy \
    --rpc-url "${RPC_URL}" \
    --private-key "${PRIVATE_KEY}" \
    --broadcast \
    -vvv ) 2>&1 | tee "${LOG_FILE}"
DEPLOY_RC=${PIPESTATUS[0]}
set -e
# Some deploy scripts name the contract differently from the file; retry without
# the explicit :Deploy target if the first form failed to resolve a contract.
if [ "${DEPLOY_RC}" -ne 0 ]; then
  warn "forge script ...:Deploy failed (rc=${DEPLOY_RC}); retrying without explicit contract name"
  set +e
  ( cd "${CONTRACTS_DIR}" && forge script script/Deploy.s.sol \
      --rpc-url "${RPC_URL}" \
      --private-key "${PRIVATE_KEY}" \
      --broadcast \
      -vvv ) 2>&1 | tee "${LOG_FILE}"
  DEPLOY_RC=${PIPESTATUS[0]}
  set -e
fi
[ "${DEPLOY_RC}" -eq 0 ] || die "forge deploy failed (rc=${DEPLOY_RC}); see ${LOG_FILE}"
ok "contracts deployed"

# 3. extract addresses
step "Extracting deployed addresses"
ADDRS_JSON="$(node "${SCRIPT_DIR}/parse-deploy.mjs" "${LOG_FILE}")" \
  || die "could not parse deployed addresses (see ${LOG_FILE})"
echo "${ADDRS_JSON}" >"${RUN_DIR}/deploy.json"
ok "addresses parsed -> ${RUN_DIR}/deploy.json"

# 4. write env files
step "Writing env files (.env, apps/web/.env.local, backend/.env, cre/.env)"
node "${SCRIPT_DIR}/write-env.mjs" "${ADDRS_JSON}"
ok "env files updated"

echo
ok "deploy complete — addresses live in all app env files"

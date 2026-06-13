#!/usr/bin/env bash
# scripts/lib.sh — shared helpers for the Handoff devx scripts (AGENT 10).
# Sourced by every other script in scripts/. Pure bash, no external deps beyond
# foundry (forge/anvil/cast) + jq. Resilient: clear echoed steps, safe defaults.
#
# Layout assumption (post-integration, per SPEC §2):
#   <root>/
#     contracts/script/Deploy.s.sol   (AGENT 1)
#     apps/web/                        (AGENT 8)  -> .env.local
#     backend/                         (AGENT 9)  -> .env
#     cre/                             (AGENT 3)  -> .env
#     .env                             (root; this layer writes it)

set -euo pipefail

# ---- paths -----------------------------------------------------------------
# ROOT = repo root (parent of scripts/). Robust to being sourced from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export ROOT SCRIPT_DIR

CONTRACTS_DIR="${ROOT}/contracts"
WEB_DIR="${ROOT}/apps/web"
BACKEND_DIR="${ROOT}/backend"
CRE_DIR="${ROOT}/cre"
RUN_DIR="${ROOT}/.handoff"          # scratch dir: pid files, deploy snapshot, logs
export CONTRACTS_DIR WEB_DIR BACKEND_DIR CRE_DIR RUN_DIR
mkdir -p "${RUN_DIR}"

# ---- defaults (override via env or root .env) ------------------------------
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
CHAIN_ID="${CHAIN_ID:-31337}"
# anvil default account 0 — local only, never a real key.
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_HOST="${ANVIL_HOST:-127.0.0.1}"
BACKEND_PORT="${PORT:-8787}"
WEB_PORT="${WEB_PORT:-3000}"
MOCK="${MOCK:-true}"
export RPC_URL CHAIN_ID PRIVATE_KEY ANVIL_PORT ANVIL_HOST BACKEND_PORT WEB_PORT MOCK

# ---- logging ---------------------------------------------------------------
_c() { # color helper; no-op if not a tty
  if [ -t 1 ]; then printf '%s' "$1"; fi
}
BOLD="$(_c $'\033[1m')"; DIM="$(_c $'\033[2m')"; RED="$(_c $'\033[31m')"
GRN="$(_c $'\033[32m')"; YLW="$(_c $'\033[33m')"; RST="$(_c $'\033[0m')"

step() { echo "${BOLD}==> ${1}${RST}"; }
info() { echo "${DIM}    ${1}${RST}"; }
ok()   { echo "${GRN}    ✓ ${1}${RST}"; }
warn() { echo "${YLW}    ! ${1}${RST}" >&2; }
die()  { echo "${RED}    ✗ ${1}${RST}" >&2; exit 1; }

# ---- foundry on PATH -------------------------------------------------------
# Foundry is often installed to ~/.foundry/bin but not on PATH in non-login
# shells. Add it if present so forge/anvil/cast resolve.
ensure_foundry_path() {
  if ! command -v forge >/dev/null 2>&1; then
    if [ -x "${HOME}/.foundry/bin/forge" ]; then
      export PATH="${HOME}/.foundry/bin:${PATH}"
    fi
  fi
}
ensure_foundry_path

have() { command -v "$1" >/dev/null 2>&1; }

require_foundry() {
  ensure_foundry_path
  have forge || die "forge not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  have anvil || die "anvil not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  have cast  || die "cast not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
}

# ---- anvil readiness -------------------------------------------------------
anvil_up() {
  # eth_chainId returns success only when the JSON-RPC is actually serving.
  cast chain-id --rpc-url "${RPC_URL}" >/dev/null 2>&1
}

wait_for_anvil() {
  local tries="${1:-60}" i=0
  step "Waiting for anvil on ${RPC_URL}"
  while [ "${i}" -lt "${tries}" ]; do
    if anvil_up; then ok "anvil is live (chainId $(cast chain-id --rpc-url "${RPC_URL}" 2>/dev/null || echo '?'))"; return 0; fi
    i=$((i + 1)); sleep 0.5
  done
  die "anvil did not become ready after ${tries} tries — is it running? (make anvil)"
}

# ---- HTTP readiness (backend) ---------------------------------------------
wait_for_http() {
  local url="$1" tries="${2:-60}" i=0
  step "Waiting for ${url}"
  while [ "${i}" -lt "${tries}" ]; do
    if curl -fsS "${url}" >/dev/null 2>&1; then ok "${url} is live"; return 0; fi
    i=$((i + 1)); sleep 0.5
  done
  warn "${url} not ready after ${tries} tries (continuing anyway)"
  return 1
}

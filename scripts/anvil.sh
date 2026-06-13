#!/usr/bin/env bash
# scripts/anvil.sh — start a local anvil node (foreground by default).
# Usage:
#   scripts/anvil.sh            # run anvil in the foreground (Ctrl-C to stop)
#   scripts/anvil.sh --bg       # start in background, write pid to .handoff/anvil.pid
#   scripts/anvil.sh --stop     # stop a backgrounded anvil
#
# Deterministic mnemonic so the deployer (account 0) is always the same key the
# mock auth/funding packages sign with (SPEC §7/§8 use anvil account 0).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

PID_FILE="${RUN_DIR}/anvil.pid"
LOG_FILE="${RUN_DIR}/anvil.log"

start_fg() {
  require_foundry
  if anvil_up; then ok "anvil already running on ${RPC_URL} — reusing it"; exit 0; fi
  step "Starting anvil (chainId ${CHAIN_ID}) on ${ANVIL_HOST}:${ANVIL_PORT}"
  exec anvil \
    --host "${ANVIL_HOST}" \
    --port "${ANVIL_PORT}" \
    --chain-id "${CHAIN_ID}" \
    --block-time 1
}

start_bg() {
  require_foundry
  if anvil_up; then ok "anvil already running on ${RPC_URL} — reusing it"; exit 0; fi
  step "Starting anvil in background (chainId ${CHAIN_ID}) on ${ANVIL_HOST}:${ANVIL_PORT}"
  anvil \
    --host "${ANVIL_HOST}" \
    --port "${ANVIL_PORT}" \
    --chain-id "${CHAIN_ID}" \
    --block-time 1 \
    >"${LOG_FILE}" 2>&1 &
  echo $! >"${PID_FILE}"
  info "pid $(cat "${PID_FILE}") · logs: ${LOG_FILE}"
  wait_for_anvil 60
}

stop_bg() {
  if [ -f "${PID_FILE}" ]; then
    local pid; pid="$(cat "${PID_FILE}")"
    if kill -0 "${pid}" 2>/dev/null; then
      step "Stopping anvil (pid ${pid})"; kill "${pid}" 2>/dev/null || true
      ok "stopped"
    else
      warn "anvil pid ${pid} not running"
    fi
    rm -f "${PID_FILE}"
  else
    warn "no anvil pid file (${PID_FILE}); nothing to stop"
  fi
}

case "${1:-}" in
  --bg)   start_bg ;;
  --stop) stop_bg ;;
  "")     start_fg ;;
  *)      die "unknown arg '${1}' (use --bg | --stop | <none>)" ;;
esac

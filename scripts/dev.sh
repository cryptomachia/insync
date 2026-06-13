#!/usr/bin/env bash
# scripts/dev.sh — one-command bring-up of the whole Handoff stack locally.
#
#   anvil  ->  deploy contracts + write env  ->  backend (indexer+API)
#          ->  web (Next.js)  ->  cre local keeper (reclaim loop)
#
# Everything runs with MOCK=true (no third-party accounts). Ctrl-C tears the
# whole stack down. Each long-running service streams into .handoff/<svc>.log
# and is also echoed (prefixed) so you can watch one terminal.
#
# Resilient by design: if a service dir is missing (e.g. you haven't integrated
# backend/ yet) it is skipped with a clear warning instead of aborting.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

PIDS=()
cleanup() {
  echo
  step "Shutting down Handoff stack"
  # kill children we spawned
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid:-}" ] && kill "${pid}" 2>/dev/null || true
  done
  # kill backgrounded anvil if we started it
  "${SCRIPT_DIR}/anvil.sh" --stop 2>/dev/null || true
  ok "stack down"
}
trap cleanup INT TERM EXIT

# Stream a service: run cmd in dir, tee to log, prefix output, record pid.
run_svc() {
  local name="$1" dir="$2"; shift 2
  if [ ! -d "${dir}" ]; then
    warn "${name}: directory ${dir} missing — skipping (integrate it, then re-run)"
    return 0
  fi
  local log="${RUN_DIR}/${name}.log"
  step "Starting ${name} (${dir})"
  ( cd "${dir}" && "$@" ) >"${log}" 2>&1 &
  local pid=$!
  PIDS+=("${pid}")
  info "${name} pid ${pid} · logs: ${log}"
  # live-tail with a prefix, in the background, so one terminal shows all services
  ( tail -n +1 -f "${log}" | sed "s/^/[${name}] /" ) &
  PIDS+=("$!")
}

export MOCK=true NEXT_PUBLIC_MOCK=true

step "Handoff dev bring-up (MOCK=true)"
info "root: ${ROOT}"

# 1. anvil (background) + 2. deploy + write env
"${SCRIPT_DIR}/anvil.sh" --bg
"${SCRIPT_DIR}/deploy.sh"

# Load the freshly written root .env so child services inherit addresses.
if [ -f "${ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
  ok "loaded ${ROOT}/.env"
fi

# 3. backend (indexer + API). Standalone package: npm run dev.
run_svc backend "${BACKEND_DIR}" npm run dev

# Give the backend a moment, then wait on /health (best-effort).
wait_for_http "http://127.0.0.1:${BACKEND_PORT}/health" 40 || true

# 4. web (Next.js). apps/web npm run dev.
run_svc web "${WEB_DIR}" npm run dev

# 5. cre local keeper (reclaim loop against local anvil). MOCK/local mode.
run_svc cre "${CRE_DIR}" npm run dev

echo
ok "Handoff is up:"
info "web      http://127.0.0.1:${WEB_PORT}"
info "backend  http://127.0.0.1:${BACKEND_PORT}"
info "rpc      ${RPC_URL}"
info "Press Ctrl-C to stop everything."

# Wait on all background jobs; trap handles teardown.
wait

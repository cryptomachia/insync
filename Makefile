# Handoff — root Makefile (AGENT 10 / devx).
# Orchestrates the whole local stack: anvil + contracts + backend + web + CRE.
# Everything runs with MOCK=true (no third-party accounts). See DEMO.md for the
# live demo script and e2e/CHECKLIST.md for the precise integration order.
#
# Quick start (after integration):
#   make install      # install JS deps everywhere + build the ABI package
#   make dev          # anvil + deploy + backend + web + cre local keeper
#   make test         # forge tests + e2e (Playwright + viem script-level)
#
# The scripts auto-detect Foundry at ~/.foundry/bin if it's not on PATH.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
SCRIPTS := $(ROOT)/scripts
CONTRACTS := $(ROOT)/contracts
WEB := $(ROOT)/apps/web
BACKEND := $(ROOT)/backend
CRE := $(ROOT)/cre
E2E := $(ROOT)/e2e

# Foundry may live at ~/.foundry/bin without being on PATH.
export PATH := $(HOME)/.foundry/bin:$(PATH)

# MOCK everywhere unless the caller overrides it.
export MOCK ?= true
export NEXT_PUBLIC_MOCK ?= true

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@echo "Handoff — make targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

# ----------------------------------------------------------------------------
# Setup
# ----------------------------------------------------------------------------
.PHONY: install
install: ## Install all JS deps (root workspaces + standalone backend/cre/e2e) and forge libs
	@echo "==> Installing root workspace deps (packages/* + apps/*)"
	@npm install
	@echo "==> Building @handoff/contracts-abi (consumed by every TS module)"
	@npm run build --workspace @handoff/contracts-abi --if-present || echo "    (no build script; src is consumed directly)"
	@for d in backend cre e2e; do \
		if [ -f "$(ROOT)/$$d/package.json" ]; then \
			echo "==> Installing $$d (standalone) deps"; \
			( cd "$(ROOT)/$$d" && npm install ); \
		else \
			echo "    ! $$d not present yet — skip (integrate it, then re-run make install)"; \
		fi; \
	done
	@echo "==> Installing Foundry libraries (forge install)"
	@if command -v forge >/dev/null 2>&1; then \
		( cd "$(CONTRACTS)" && forge install >/dev/null 2>&1 || true ) ; \
		echo "    ✓ forge libs ready"; \
	else \
		echo "    ! forge not found — install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"; \
	fi
	@echo "==> Installing Playwright browsers (chromium)"
	@if [ -f "$(E2E)/package.json" ]; then ( cd "$(E2E)" && npx playwright install chromium >/dev/null 2>&1 || true ); fi
	@echo "✓ install complete"

# ----------------------------------------------------------------------------
# Chain + deploy
# ----------------------------------------------------------------------------
.PHONY: anvil
anvil: ## Start a local anvil node in the FOREGROUND (Ctrl-C to stop)
	@bash "$(SCRIPTS)/anvil.sh"

.PHONY: anvil-bg
anvil-bg: ## Start anvil in the background (pid in .handoff/anvil.pid)
	@bash "$(SCRIPTS)/anvil.sh" --bg

.PHONY: anvil-stop
anvil-stop: ## Stop a backgrounded anvil
	@bash "$(SCRIPTS)/anvil.sh" --stop

.PHONY: deploy
deploy: ## Deploy contracts to anvil + write addresses into all app env files
	@bash "$(SCRIPTS)/deploy.sh"

# ----------------------------------------------------------------------------
# Run
# ----------------------------------------------------------------------------
.PHONY: dev
dev: ## Full local stack: anvil + deploy + backend + web + cre keeper (MOCK=true)
	@bash "$(SCRIPTS)/dev.sh"

.PHONY: down
down: ## Stop background services started by the dev scripts
	@echo "==> Stopping background anvil"
	@bash "$(SCRIPTS)/anvil.sh" --stop || true
	@echo "    (web/backend/cre run in the foreground under 'make dev'; Ctrl-C there)"

# ----------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------
.PHONY: build
build: ## Build contracts (forge) + all JS workspaces + web app
	@echo "==> Building contracts (forge build)"
	@if command -v forge >/dev/null 2>&1; then ( cd "$(CONTRACTS)" && forge build ); \
		else echo "    ! forge not found — skipping contract build"; fi
	@echo "==> Building JS workspaces (packages/* + apps/*)"
	@npm run build --if-present
	@for d in backend cre; do \
		if [ -f "$(ROOT)/$$d/package.json" ]; then \
			echo "==> Building $$d"; \
			( cd "$(ROOT)/$$d" && npm run build --if-present ); \
		fi; \
	done
	@echo "✓ build complete"

# ----------------------------------------------------------------------------
# Test
# ----------------------------------------------------------------------------
.PHONY: contracts-test
contracts-test: ## Run the Foundry test suite (contracts/)
	@echo "==> forge test"
	@if command -v forge >/dev/null 2>&1; then ( cd "$(CONTRACTS)" && forge test -vv ); \
		else echo "    ! forge not found — install Foundry to run contract tests"; exit 1; fi

.PHONY: e2e
e2e: ## Run the e2e suite (script-level viem branches + Playwright UI flows)
	@echo "==> e2e (requires anvil + deployed contracts; run 'make anvil-bg deploy' first)"
	@if [ -f "$(E2E)/package.json" ]; then ( cd "$(E2E)" && npm test ); \
		else echo "    ! e2e/ not present"; exit 1; fi

.PHONY: e2e-contract
e2e-contract: ## Run only the viem script-level contract e2e (no browser)
	@if [ -f "$(E2E)/package.json" ]; then ( cd "$(E2E)" && npm run test:contract ); fi

.PHONY: e2e-ui
e2e-ui: ## Run only the Playwright UI e2e (happy path + cancel branch)
	@if [ -f "$(E2E)/package.json" ]; then ( cd "$(E2E)" && npm run test:ui ); fi

.PHONY: test
test: contracts-test e2e ## Run everything: forge tests + e2e
	@echo "✓ all tests complete"

# ----------------------------------------------------------------------------
# Misc
# ----------------------------------------------------------------------------
.PHONY: typecheck
typecheck: ## Type-check all TS workspaces + e2e
	@npm run typecheck --if-present || true
	@if [ -f "$(E2E)/package.json" ]; then ( cd "$(E2E)" && npx tsc --noEmit ); fi

.PHONY: clean
clean: ## Remove build artifacts, scratch dir, and local env files
	@echo "==> Cleaning"
	@rm -rf "$(ROOT)/.handoff"
	@rm -rf "$(CONTRACTS)/out" "$(CONTRACTS)/cache" "$(CONTRACTS)/broadcast"
	@rm -f "$(ROOT)/.env" "$(WEB)/.env.local" "$(BACKEND)/.env" "$(CRE)/.env"
	@echo "✓ clean (kept .env.example and node_modules)"

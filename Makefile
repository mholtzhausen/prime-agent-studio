# Prime Agent Studio Nix — developer targets
# Run `make help` to list commands.

ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

NPM ?= npm
NODE ?= node

.PHONY: help init install setup-runtime dev start start-silent stop check test test-ui format docs-check docs-sync desktop-dev desktop-build desktop-release-bootstrap desktop-release-check desktop-manifest clean version

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "; printf "\nPrime Agent Studio Nix — local GUI for Prime Agent\n\nUsage: make <target>\n\n"} \
		/^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2} \
		END {printf "\n"}' $(MAKEFILE_LIST)

init: install ## First-time setup: install deps (run setup-runtime when Prime Agent is available)
	@echo "Dependencies ready. Optional: make setup-runtime (needs Prime Agent + uv)."
	@echo "Start with: make dev   →  http://127.0.0.1:3088"

install: ## Install npm dependencies (frozen lockfile)
	cd "$(ROOT)" && $(NPM) ci

setup-runtime: ## Prepare Python kernel / skills runtime for the current directory
	cd "$(ROOT)" && $(NPM) run setup:runtime

dev: ## Start the local server in the foreground (logs in terminal)
	cd "$(ROOT)" && $(NPM) start

# Prerequisite-only alias (do not recurse via $(MAKE): Cursor AppImage exports
# ARGV0, which GNU make treats as MAKE and would re-exec the AppImage).
start: dev ## Alias for make dev

start-silent: ## Start server in the background and open the browser
	cd "$(ROOT)" && $(NPM) run start:silent

stop: ## Stop the Studio server and active runs
	cd "$(ROOT)" && $(NPM) run stop

check: ## Syntax, translations, and bilingual docs checks
	cd "$(ROOT)" && $(NPM) run check

test: ## Unit / integration tests (node --test; no paid model calls)
	cd "$(ROOT)" && $(NPM) test

test-ui: ## Browser UI smoke (Playwright; prefer Chrome/Chromium on Linux)
	cd "$(ROOT)" && $(NPM) run test:ui

format: ## Format sources with Prettier
	cd "$(ROOT)" && $(NPM) run format

docs-check: ## Verify bilingual documentation pairs, links, and anchors
	cd "$(ROOT)" && $(NPM) run check:docs

docs-sync: ## Record doc review fingerprints (pass ID: make docs-sync ID=…)
	@test -n "$(ID)" || { echo "Usage: make docs-sync ID=<doc-identifier>"; exit 1; }
	cd "$(ROOT)" && $(NPM) run docs:sync -- $(ID)

desktop-dev: ## Run the Linux Tauri desktop shell (needs Rust + WebKitGTK)
	cd "$(ROOT)" && $(NPM) run desktop:dev

desktop-build: ## Build Linux AppImage and deb packages
	cd "$(ROOT)" && $(NPM) run desktop:build

desktop-release-bootstrap: ## Sync nix signing key pubkey + updater URLs (optional: SET_SECRETS=1)
	cd "$(ROOT)" && $(NPM) run desktop:release:bootstrap -- $(if $(filter 1 true yes,$(SET_SECRETS)),--set-github-secrets,)

desktop-release-check: ## Verify local nix key matches tauri.conf.json updater settings
	cd "$(ROOT)" && $(NPM) run desktop:release:check

desktop-manifest: ## Prepare signed AppImage catalog under .local/desktop-release/
	cd "$(ROOT)" && $(NPM) run desktop:manifest

clean: ## Remove node_modules, desktop build dirs, and test-results
	rm -rf "$(ROOT)node_modules" "$(ROOT).desktop-build" "$(ROOT)src-tauri/target" "$(ROOT)test-results"
	@echo "cleaned"

version: ## Print package version
	@$(NODE) -p "JSON.parse(require('fs').readFileSync('$(ROOT)package.json','utf8')).version"

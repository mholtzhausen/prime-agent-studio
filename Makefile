# Prime Agent Studio — developer targets
# Run `make help` to list commands.

ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

NPM ?= npm
NODE ?= node

.PHONY: help init install setup-runtime dev start stop check test test-ui format docs-check docs-sync desktop-dev desktop-build clean version

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "; printf "\nPrime Agent Studio — local GUI for Prime Agent\n\nUsage: make <target>\n\n"} \
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

start: ## Alias for make dev
	@$(MAKE) --no-print-directory dev

stop: ## Stop the Studio server and active runs
	cd "$(ROOT)" && $(NPM) run stop

check: ## Syntax, translations, and bilingual docs checks
	cd "$(ROOT)" && $(NPM) run check

test: ## Unit / integration tests (node --test; no paid model calls)
	cd "$(ROOT)" && $(NPM) test

test-ui: ## Browser UI smoke (Playwright; Edge by default, or PRIME_STUDIO_TEST_BROWSER=chrome)
	cd "$(ROOT)" && $(NPM) run test:ui

format: ## Format sources with Prettier
	cd "$(ROOT)" && $(NPM) run format

docs-check: ## Verify bilingual documentation pairs, links, and anchors
	cd "$(ROOT)" && $(NPM) run check:docs

docs-sync: ## Record doc review fingerprints (pass ID: make docs-sync ID=…)
	@test -n "$(ID)" || { echo "Usage: make docs-sync ID=<doc-identifier>"; exit 1; }
	cd "$(ROOT)" && $(NPM) run docs:sync -- $(ID)

desktop-dev: ## Run the Tauri desktop shell (Windows-oriented; needs Rust toolchain)
	cd "$(ROOT)" && $(NPM) run desktop:dev

desktop-build: ## Build the desktop installer / package
	cd "$(ROOT)" && $(NPM) run desktop:build

clean: ## Remove node_modules, desktop build dirs, and test-results
	rm -rf "$(ROOT)node_modules" "$(ROOT).desktop-build" "$(ROOT)src-tauri/target" "$(ROOT)test-results"
	@echo "cleaned"

version: ## Print package version
	@$(NODE) -p "JSON.parse(require('fs').readFileSync('$(ROOT)package.json','utf8')).version"

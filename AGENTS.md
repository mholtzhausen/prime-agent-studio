# Agents

Guidance for LLM / coding agents working in this repository.

## Project summary

**Prime Agent Studio** (v3.4.1) is a local French/English workspace UI around [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent). It serves a vanilla browser client from this repo, drives the installed Prime Agent CLI/supervisor, and optionally wraps that stack in a Linux Tauri app (AppImage/deb).

Canonical product docs: [README.md](README.md) · internals: [docs/en/development.md](docs/en/development.md) · system map: [ARCHITECTURE.md](ARCHITECTURE.md).

## Before you change anything

1. Prefer `make <target>` over raw npm when a Makefile target exists (`make help`).
2. Match existing ESM style: no new bundler, framework, or package manager.
3. Do not modify installed Prime Agent package files; Studio uses in-memory loaders under `runtime/`.
4. Keep bilingual docs in sync when editing user-facing guides (`docs/` ↔ `docs/en/`). After edits: review both languages, then `make docs-sync ID=<identifier>`.
5. Never commit `.local/`, `.env*`, credentials, or real session data.

## Stack boundaries

| Layer | Path | Do | Don't |
| --- | --- | --- | --- |
| HTTP API | `server.mjs` | Route, auth, wire services from `lib/` | Embed large domain logic |
| Domain | `lib/*.mjs` | Stores, agents, MCP, LAN, roadmap, files | Import DOM / browser APIs |
| UI | `public/`, `index.html` | Vanilla JS/CSS; use `i18n` for labels | Talk to filesystem or secrets |
| Runtime hooks | `runtime/` | In-memory adapters for Studio-launched processes | Patch global Prime Agent installs |
| Desktop | `src-tauri/`, `desktop/` | Tauri shell, tray, updater, folder pickers | Expose a generic shell to the web UI |
| Scripts / tests | `scripts/`, `test/` | Isolated temp data, fake engines | Touch user `~/.prime` or paid accounts |

## Development commands

```sh
make init            # npm ci
make setup-runtime   # optional; needs Prime Agent + uv
make dev             # node server.mjs → http://127.0.0.1:3088
make start-silent    # background server + browser (scripts/start-studio.sh)
make check           # syntax + translations + docs
make test            # node --test under test/
make format          # prettier
make stop            # shut down server / runs
```

Default listen: `127.0.0.1` port `PORT` or **3088**. Product surfaces are Linux-only: Node web server + browser (`make dev`) and the Linux Tauri desktop shell. Background launchers are `scripts/start-studio.sh`, `scripts/stop-studio.sh`, and `make start-silent`. Browser UI tests expect Chrome/Chromium on Linux (override with `PRIME_STUDIO_TEST_BROWSER`). Several `test/*.test.mjs` cases need an installed Prime Agent CLI (expect HTTP 503 / skipped adapters without it).

## Important paths

| Path | Role |
| --- | --- |
| `server.mjs` | `createApp()`, local HTTP + SSE |
| `lib/agent.mjs` | CLI/supervisor lifecycle, runs, streaming |
| `lib/store.mjs` | Native sessions + Studio workspace metadata |
| `lib/lan.mjs` / `remote-network.mjs` | LAN / Tailscale gateways and PIN auth |
| `lib/mcp-*.mjs` / `provider-*.mjs` | Native MCP and provider credential flows |
| `lib/kernel.mjs` | Managed Python skill runtime under `.local/` |
| `public/app.js` | Main client orchestration |
| `public/translations.js` | Single FR/EN message table |
| `runtime/*-loader.mjs` | Env-only hooks for Studio child processes |
| `.local/` | Studio data (gitignored): workspace, attachments, kernel venvs |

## Conventions

- **No build step** for the web UI; Markdown/i18n assets are served from `node_modules` / `public/`.
- **Secrets stay on the host**: provider keys and MCP OAuth live in Prime Agent storage; the browser never receives raw secrets.
- **Remote gateway allowlists** matter: provider/config routes stay loopback-only; do not widen without an explicit security review.
- **Translations**: add strings to `public/translations.js` (one row, both languages). `make check` validates params and references.
- **Tests**: default suite uses temp dirs and simulated engines. Native/Luna smokes are opt-in and may consume model quota — do not run them unless asked.
- **Active sessions**: Studio serves the checkout live. Prefer a separate git worktree when changing UI while a real Studio instance is running from the same tree.

## Context to load first

| Task | Start here |
| --- | --- |
| HTTP routes / bootstrap | `server.mjs`, [docs/en/development.md](docs/en/development.md) |
| Agent runs / stop / SSE | `lib/agent.mjs`, `lib/live-messages.mjs` |
| UI / composer / i18n | `public/app.js`, `public/composer.js`, `public/i18n.js` |
| MCP / providers | `lib/mcp-service.mjs`, `lib/provider-service.mjs` |
| Mobile / PWA / Tailscale | `lib/lan.mjs`, `lib/pwa.mjs`, `lib/tailscale-https.mjs` |
| Roadmap / knowledge | `lib/roadmap.mjs`, `lib/knowledge.mjs` |
| Desktop shell | `src-tauri/`, [docs/en/desktop.md](docs/en/desktop.md) |
| Kernel / Python skills | `lib/kernel.mjs`, `runtime/kernel-loader.mjs` |

## Living documents

After a feature, refactor, or architecture change that affects setup, layout, or agent workflows, update:

- [README.md](README.md) (and [README.fr.md](README.fr.md) when user-facing)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AGENTS.md](AGENTS.md) (this file)
- Relevant guides under `docs/` / `docs/en/`

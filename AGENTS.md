# Agents

Guidance for LLM / coding agents working in this repository.

## Project summary

**Prime Agent Studio Nix** (v4.1.2) is a local French/English workspace UI around [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent). It serves a vanilla browser client from this repo, drives the installed Prime Agent CLI/supervisor, and optionally wraps that stack in a Linux Tauri app (AppImage/deb).

**Engine compatibility:** Studio expects Prime Agent **0.9.4+** (daemon hello on a private socket; `utils/shell#resolveKernelBashShell`). From **0.9.5** the daemon may fork a supervisor child — Studio accepts that descendant when it listens on the Studio-owned socket. An incompatible engine reports `engine_incompatible` with a probe `check`/`detail`, not a path error.

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
make dev             # node server.mjs → http://127.0.0.1:3088
make start-silent    # background server + browser (scripts/start-studio.sh)
make check           # syntax + translations + docs
make test            # node --test under test/
make format          # prettier
make stop            # shut down server / runs
```

`make setup-runtime` / `npm run setup:runtime` is obsolete (no-op); Prime Agent bootstraps its own Python kernel.

Default listen: `127.0.0.1` port `PORT` or **3088**. Product surfaces are Linux-only: Node web server + browser (`make dev`) and the Linux Tauri desktop shell. Background launchers are `scripts/start-studio.sh`, `scripts/stop-studio.sh`, and `make start-silent`. Browser UI tests expect Chrome/Chromium on Linux (override with `PRIME_STUDIO_TEST_BROWSER`). Several `test/*.test.mjs` cases need an installed Prime Agent CLI (expect HTTP 503 / skipped adapters without it).

## Important paths

| Path | Role |
| --- | --- |
| `server.mjs` | `createApp()`, local HTTP + SSE |
| `lib/agent.mjs` | CLI/supervisor lifecycle, runs, streaming |
| `lib/store.mjs` | Native sessions + Studio workspace metadata |
| `lib/lan.mjs` / `remote-network.mjs` | LAN / Tailscale gateways and PIN auth |
| `lib/mcp-*.mjs` / `provider-*.mjs` | Native MCP and provider credential flows |
| `lib/kernel.mjs` | Legacy helpers (`localKernelPython` marker / `execute`); Studio does not prep kernels |
| `public/app.js` | Main client orchestration |
| `public/translations.js` | Single FR/EN message table |
| `runtime/*-loader.mjs` | Env-only hooks for Studio child processes; keep `PRIME_GUI_CLI_ROOT` across PA 0.9.5+ `cli.js` → `cli-node.js` (`runtime/npm-bridge.mjs`) |
| `.local/` | Studio data (gitignored): workspace, attachments; legacy kernel markers may exist |

## Conventions

- **No build step** for the web UI; Markdown/i18n assets are served from `node_modules` / `public/`.
- **Secrets stay on the host**: provider keys and MCP OAuth live in Prime Agent storage; the browser never receives raw secrets.
- **Remote gateway allowlists** matter: provider/config routes stay loopback-only; do not widen without an explicit security review.
- **Translations**: add strings to `public/translations.js` (one row, both languages). `make check` validates params and references.
- **Appearance density**: client-only preference (`comfortable` / `compact` / `dense`, default `compact`) in `prime-studio.preferences`; applied as `html[data-density]` by `public/theme.js` and spacing tokens in CSS. Do not send density to the server.
- **Extension providers in the model catalog**: opt-in Studio preference `includeExtensionProviders` (server store / `/api/studio-preferences`), toggled on the Providers panel. When on, `scripts/model-catalog-worker.mjs` loads `~/.prime/agent/extensions` via native `discoverAndLoadExtensions` and registers their providers. Default off — extensions are arbitrary code.
- **Desktop packages**: `make build` → unsigned AppImage/deb; `make build-release` → ensure nix signing key + pubkey sync, signed bundles, and `.local/desktop-release/v*` catalog (`NOTES=path/to/notes.md` optional; `SET_SECRETS=1` uploads GitHub signing secrets). Lower-level aliases remain (`desktop-build`, `desktop-release-bootstrap`, …). Publish from `mholtzhausen/prime-agent-studio`. Cut versions with `/version-bump [major|minor|patch|build]`. AppImage AppRun injects `PYTHONHOME`/`PYTHONPATH`; clear them in the desktop shell and component/agent env (Studio ships no Python).
- **Binary paths (Prime Agent only)**: Preferences → System only (`public/components-settings.js`, `/api/system/components*`), plus bash capability for shell. Same UX in the browser and desktop app webview. Storage is `engine/selection.json` + `installation.json` under `componentsDataRoot()` (`lib/desktop-components.mjs`). Env vars win at launch; empty Prime Agent path soft-discovers from PATH + well-known dirs. Studio does not manage uv or Python paths — Prime Agent owns the Python skill kernel (optional advanced PA env: `PRIME_AGENT_KERNEL_PYTHON`). Capability validation only (no managed download of Prime Agent). Loopback-only — not on the LAN allowlist.
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
| Kernel / Python skills | Owned by Prime Agent; `lib/kernel.mjs` is legacy helpers only |

## Living documents

After a feature, refactor, or architecture change that affects setup, layout, or agent workflows, update:

- [README.md](README.md) (and [README.fr.md](README.fr.md) when user-facing)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [AGENTS.md](AGENTS.md) (this file)
- Relevant guides under `docs/` / `docs/en/`

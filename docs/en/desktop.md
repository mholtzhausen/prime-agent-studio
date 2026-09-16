# Linux application

**English** · [Français](../desktop.md) · [← Back to README](../../README.md)

The **Prime Agent Studio Nix** application, built with Tauri 2, opens Studio in a dedicated Linux window (WebKitGTK). Its launcher starts the server in the background or reuses the running instance. Source checkouts can use `scripts/start-studio.sh` / `make start-silent` instead.

## Installation and first launch

Download the amd64 [AppImage](https://github.com/mholtzhausen/prime-agent-studio/releases/latest) or [deb](https://github.com/mholtzhausen/prime-agent-studio/releases/latest) from the latest release. The AppImage is portable; the deb installs desktop integration. Node.js is bundled. Packages use the system WebKitGTK stack—no separate browser runtime installer is required.

Builds containing guided setup download **Prime Agent, private npm, uv and Python** on demand. These components are not bundled in the package. No previous Node, npm or Python installation, PATH changes or terminal commands are needed. An initial network connection is required. **A working `bash` remains a separate prerequisite** for engine shell commands; its absence is reported.

On first launch, review component states, then choose **Install missing components**, **Choose an existing installation** or **Later — open Studio**. Downloads require an explicit click on the install button. “Later” preserves access to settings and history; engine actions ask you to finish setup. After validation, configure a provider in **Connections**: preparation neither signs into an account nor sends a paid prompt. If you previously used a source checkout, select **Use an existing installation** and choose its folder containing `server.mjs` and `.local`.

Migration copies projects, subagent defaults, attachments and remote access settings, including the PIN. The original installation remains intact. If its server is running, the application connects immediately and postpones copying until the first launch when that server is stopped. It interrupts no runs. Prime Agent sessions remain in their usual location. After migration, use the application to open Studio; the old launcher retains its own copy of the settings.

Browser appearance preferences and drafts are not copied: the Tauri window has its own persistent storage.

## Preparation, repair and compatibility

**Preferences → System** (and the desktop launcher’s component fields) share the same path editor for Prime Agent, `uv` and Python. Existing installation selection accepts the Prime Agent package root, `uv` or `python`. Studio auto-detects common Linux installs and validates them before saving. `PRIME_AGENT_CLI`, `PRIME_GUI_UV` and `PRIME_AGENT_KERNEL_PYTHON` take precedence, followed by saved selections, the managed installation, then customary external locations. Invalid explicit paths must be corrected; they are never silently replaced. A valid external Python is only validated, without installing into it or requiring uv. External picks pass capability checks (structure + probe); they need not match the exact policy version string—an amber warning appears when the version differs. A successful selection that diagnoses ready writes `installation.json` immediately (activate), so Studio stops requiring component setup.

The versioned policy in `lib/desktop-components.mjs` pairs Studio with **Prime Agent 0.9.4**, **npm 10.9.4** and **uv 0.8.22** for **managed downloads**, using Python 3.11. Packaging targets Linux x86_64 with Node 22 ≥ 22.16 or Node 24; the engine requires ≥ 22.8. A later Studio version may require another exact engine for the install button: the button then installs that version after explicit consent. There is no periodic monitoring, blind “stable” selection or automatic update of external installations.

Preparation reads the origin contract from the [official installer](https://app.primeintellect.ai/prime-agent/install.sh), without executing that script. The engine archive and its three Prime packages are checked against `releases/v<version>/SHA256SUMS`. npm comes from the [versioned official registry](https://registry.npmjs.org/npm/10.9.4), verified using its SHA-512 integrity before extraction; Studio Node executes its `npm-cli.js`. The [uv Linux x86_64 archive](https://github.com/astral-sh/uv/releases/tag/0.8.22) is checked against its `.sha256` file. These HTTPS references from the same origin provide transfer integrity, not an independent signature. Allowed hosts are fixed and any origin rotation fails closed. An automatically detected external tool is validated before being saved as a soft default selection.

npm scripts are disabled (`--ignore-scripts`). Prime's postinstall only prepares optional tools and its own kernel when requested; Studio uses `ensureLocalKernel`. Installation retains complete resources and dependencies, checks native provider, model, command, MCP and Photon imports before validation. npm retains its lockfile to diagnose resolved transitive dependencies. uv downloads managed Python when needed (`UV_PYTHON_DOWNLOADS=automatic`, `UV_PYTHON_PREFERENCE=only-managed`). Existing code validates Python imports, kernel protocol and essential skills. Optional tools, including fd/rg and account integrations, are not all installed by this preparation.

Components live in `engine/prime-agent/<version-id>`, `engine/uv/<version-id>`, `engine/npm/<version-id>` and `engine/python`, under the application data directory. `engine/prepared.json` retains validated components for retries; `engine/installation.json` atomically selects paths, versions, provenance and digests after Python validation. `engine/selection.json` stores explicit selections. Kernels remain in `.local`. Archives use fresh staging, size limits and rejection of traversal and links. Previous versions and external installations are never deleted.

Progress shows actual stages and received bytes, without an invented overall percentage. Cancellation or failure allows retrying without losing validated components. A lock prevents simultaneous preparations and recovers a stopped owner. `engine/logs/components.log` contains only stages, codes and bytes. Downloads never start merely by opening a remote page or signing in.

Completed preparation restarts only a server whose ownership and inactivity Studio verifies. If agents are working or another launcher owns the server, activation remains deferred until an appropriate restart. No global Node process is stopped. Engine and kernel generations remain available for existing processes.

## Window and background work

- **Closing the window** hides it and keeps the tray icon. Agents, the server and mobile access continue.
- Clicking this icon or launching the shortcut again brings back the same window.
- The icon’s menu offers **Open Studio**, **App settings** and **Quit application**. Quitting closes Tauri but leaves the server and agents working.
- In **App settings**, **Start with session** is disabled by default. Enabling it starts Studio in the background when you log in, without opening its window. A startup error shows the window so you can retry.
- External links open in your usual browser. LAN, Tailscale, HTTPS and the mobile PWA still use the same server.

To reconnect to a stopped server, open **App settings → Open Studio**. This button reuses an existing instance and never stops agents.

A desktop entry or launcher command can use the `--settings` argument to open application settings directly, including when the app is already running in the background.

## Data and updates

Desktop data uses the XDG / Tauri application data directory, typically `~/.local/share/com.primeagent.studio.nix`:

| Location       | Contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `data`         | Projects, attachments, hashed PIN, network settings and server logs |
| `.local`       | Persistent Python kernels                                           |
| `versions`     | Immutable copies of server files and Node.js                        |
| `webview`      | Window preferences and storage                                      |
| `desktop.json` | Launcher preferences and installation to migrate                    |

An update installs the new application and prepares a new server copy. **Preferences → Updates** distinguishes the installed application version from the running server version. Old copies are not automatically removed, preserving any processes still using them.

**Upgrading to 3.0.0:** if the previous server stays running after installation, Studio still shows that server’s version and features. Wait for agents to finish, then use **Preferences → Updates → Restart server** in the Linux application to load V3. [Collapsible project navigation](navigation.md) and [project knowledge](knowledge.md) then become available; new runs and their subagents receive the history search and reading tools.

In Studio, open **Preferences → Updates → Check for updates**. When a newer stable version is published on GitHub, its release notes and an **Install and relaunch** button appear. Download progress is displayed, then Tauri verifies the signature before starting installation. Installation requires this explicit click.

The **Restart the server after installation** option applies the new version when the server is idle. If agents are still working, the server stays running and settings open after relaunch. **Restart server** then displays a confirmation: restarting may interrupt runs and will temporarily disconnect devices. Projects and saved history are preserved. Activity is checked again before stopping; a server started by another installation is not stopped.

These controls also remain available in **App settings** through the tray icon, even when the older server does not yet have the new category. In a browser or on a phone, the page directs you to the Linux application to install or restart.

Web links, including Codex sign-in, open in the default browser. File drops use the HTML composer directly, without another file bridge. Only update and restart commands are allowed from the local Studio window; other native settings remain restricted to the launcher.

A network error, missing catalog or invalid signature is never reported as “up to date”. You can retry; technical details are in `desktop-update-error.log` in the data folder. The catalog becomes available with the first release containing `latest.json`. Checking is manual, with no periodic background polling.

Updates carry a Tauri cryptographic signature (minisign). There is no Windows Authenticode or NSIS packaging on this port.

## Build and verify

`npm run test:components` checks resolution, local-server download fixtures, digests, hostile archives, locks and the FR/EN flow in Chrome/Chromium without real installation. `npm run test:components:download` requires `.desktop-build` resources: it launches bundled Node in an isolated temporary directory with a reduced local PATH, downloads real components, prepares Python, checks `/api/version` and rejects any download during a second preparation. It retains its diagnostics directory without hiding or deleting user tools. It uses no account or paid model. To validate sessions with a simulated provider, run `scripts/test-commands-native.mjs` with `PRIME_AGENT_CLI` and `PRIME_AGENT_KERNEL_PYTHON` from this isolated manifest.

These checks do not replace testing the wizard in a packaged Tauri binary, in FR/EN, on a clean Linux x86_64 machine. That step requires the Rust toolchain and WebKitGTK development packages.

On Linux, install Rust and the [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/) (including `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`), then run:

```sh
npm ci
npm run desktop:build
# local AppImage/deb without updater signatures:
make desktop-build-unsigned
# or: npm run desktop:build -- --unsigned
```

Packages appear under `src-tauri/target/release/bundle/appimage` and `…/bundle/deb`. `npm run desktop:dev` prepares resources and starts the development build. `npm run desktop:icons` regenerates icons from the SVG.

The build validates module, worker and native helper references before creating packages. `npm run test:desktop-runtime` exercises the resources prepared in `.desktop-build` using real Prime Agent workers and an isolated project and account storage: Python skills, prompts and providers.

`npm run test:desktop` tests the previously compiled debug executable: resources extracted by the executable, messages and the Python kernel using a simulated local HTTP model, provider and command APIs, reusing a server with an active simulated agent, starting the bundled server, single instance behavior and server survival when the Tauri process closes. Prime Agent and uv must be available. Pass another executable path after `--` to test a different build. `npm run test:desktop-ui` checks presentation changes in Chrome/Chromium. Tests make no paid model calls.

For isolated tests, `PRIME_STUDIO_DESKTOP_DATA_ROOT` and `PRIME_STUDIO_DESKTOP_PORT` override the data folder and port. Leave them unset for normal use. Source installations can use `scripts/start-studio.sh` / `make start-silent`.

`npm run test:desktop-updates` and `npm run test:settings-updates` check both panels in French and English. `npm run test:desktop-lifecycle` validates a real Tauri restart with a busy server, confirmation, preserved data and activation of the installed version. `cargo test --manifest-path src-tauri/Cargo.toml --locked` tests the actual updater client against a local server: valid signature, tampered file, equal/older versions and invalid catalog. Tests never execute an installer.

For native tests alongside your application, compile a separate test identity: `TAURI_CONFIG='{"identifier":"com.primeagent.studio.nix.interaction-test"}' cargo build --manifest-path src-tauri/Cargo.toml --locked`. Unset the variable afterward before a distribution build. `npm run test:desktop-interactions` tests web and synthetic OAuth links, attachments, clipboard, export and permissions in the WebKitGTK webview. It opens test tabs in the default browser without signing into an account.

## Prepare an update release

Bootstrap once on the release machine (generates or reuses `~/.tauri/prime-agent-studio-nix.key`, syncs the embedded updater pubkey and catalog URL, and can upload GitHub Actions secrets):

```sh
make desktop-release-bootstrap
# optional: make desktop-release-bootstrap SET_SECRETS=1
make desktop-release-check
```

The private signing key stays outside the repository. Back it up securely: installed applications trust its embedded public key, and an incompatible replacement key would prevent updates. `desktop:build` uses this local key or `TAURI_SIGNING_PRIVATE_KEY` (path or content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. For local installs, `make desktop-build-unsigned` (or `npm run desktop:build -- --unsigned`) builds the AppImage and deb without updater `.sig` artifacts. Without a key and without `--unsigned`, `npm run desktop:build -- --no-bundle` builds only the executable.

After a signed build, run `npm run desktop:manifest -- path/notes.md` (notes are optional), or `make desktop-manifest`. `.local/desktop-release/v<version>` contains the files to attach together to stable release `v<version>`: the AppImage with a space-free name, its `.sig` signature, `latest.json`, and usually the matching `.deb`. Do not rename the AppImage afterward: the catalog contains its exact URL.

Release downloads and the in-app updater catalog are published from [mholtzhausen/prime-agent-studio](https://github.com/mholtzhausen/prime-agent-studio/releases). The GitHub **Linux desktop release** workflow runs manually with an existing stable tag matching `package.json`. It tests, builds, signs and prepares a **draft release** containing these files. Configure repository secrets `TAURI_SIGNING_PRIVATE_KEY` and, for an encrypted key, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (bootstrap can set both). It refuses to overwrite a published release. The workflows never sign a manually uploaded package: they always rebuild from the tag before signing. Review the draft, then publish it as the latest stable release to make the update available. Do not subsequently publish a stable release without its catalog and AppImage.

When bumping the package version for a release, use the Cursor `/version-bump` skill with an explicit bump type (`major`, `minor`, `patch`, or `build`) so `package.json`, `src-tauri/Cargo.toml`, and bilingual changelogs stay aligned.

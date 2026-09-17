# Linux application

**English** · [Français](../desktop.md) · [← Back to README](../../README.md)

The **Prime Agent Studio Nix** application, built with Tauri 2, opens Studio in a dedicated Linux window (WebKitGTK). Its launcher starts the server in the background or reuses the running instance. Source checkouts can use `scripts/start-studio.sh` / `make start-silent` instead.

## Installation and first launch

Download the amd64 [AppImage](https://github.com/mholtzhausen/prime-agent-studio/releases/latest) or [deb](https://github.com/mholtzhausen/prime-agent-studio/releases/latest) from the latest release. The AppImage is portable; the deb installs desktop integration. Node.js is bundled. Packages use the system WebKitGTK stack—no separate browser runtime installer is required. The AppImage runtime would otherwise set `PYTHONHOME`/`PYTHONPATH` under `$APPDIR`; Studio clears them because it does not ship Python.

Install **Prime Agent** yourself if it is not already available; Studio does not download Prime Agent, npm, uv or Python. **A working `bash` remains a separate prerequisite** for engine shell commands; its absence is reported.

On first launch, review component status, then choose **Choose an existing installation** or **Later — open Studio** as needed. After validation, configure a provider in **Connections**. If you previously used a source checkout, select **Use an existing installation** and choose its folder containing `server.mjs` and `.local`.

Migration copies projects, subagent defaults, attachments and remote access settings, including the PIN. The original installation remains intact. If its server is running, the application connects immediately and postpones copying until the first launch when that server is stopped. It interrupts no runs. Prime Agent sessions remain in their usual location. After migration, use the application to open Studio; the old launcher retains its own copy of the settings.

Browser appearance preferences and drafts are not copied: the Tauri window has its own persistent storage.

## Preparation, repair and compatibility

**Preferences → System** is the only path editor for **Prime Agent** (identical in the browser and the desktop Studio webview). The desktop launcher no longer hosts a component setup panel. An empty field soft-defaults from PATH and well-known locations (`~/.local`, nvm); a saved or typed path is never overwritten. Changes apply immediately with live status; **Reset** clears the field and rediscovers it. Install Prime Agent yourself — Studio does not download it.

`PRIME_AGENT_CLI` takes precedence, followed by the saved selection in `engine/selection.json`. Invalid explicit paths must be corrected; they are never silently replaced. Capability checks cover package layout and probes for the engine (shell/pyenv shims are accepted when they work). Optional `PRIME_AGENT_KERNEL_PYTHON` is a **Prime Agent** environment override only, not a Studio System field. A successful diagnosis that is ready writes `installation.json` (activate) so Studio clears the components-required gate.

Packaging targets Linux x86_64 with Node 22 ≥ 22.16 or Node 24; the engine requires ≥ 22.8. There is no periodic monitoring or automatic update of external installations.

Studio does not run `ensureLocalKernel` or provision Python under `.local`. Prime Agent owns its skill kernel.

## Window and background work

- **Closing the window** hides it and keeps the tray icon. Agents, the server and mobile access continue.
- Clicking this icon or launching the shortcut again brings back the same window.
- The icon’s menu offers **Open Studio**, **App settings** and **Quit application**. Quitting stops the managed Studio server and closes Tauri. Closing the window only hides the UI; the server keeps running for LAN/mobile until you Quit. Prime Agent’s own daemon may continue independently.
- In **App settings**, **Start with session** is disabled by default. Enabling it starts Studio in the background when you log in, without opening its window. A startup error shows the window so you can retry.
- External links open in your usual browser. LAN, Tailscale, HTTPS and the mobile PWA still use the same server.

To reconnect to a stopped server, open **App settings → Open Studio**. This button reuses an existing instance and never stops agents.

A desktop entry or launcher command can use the `--settings` argument to open application settings directly, including when the app is already running in the background.

## Data and updates

Desktop data uses the XDG / Tauri application data directory, typically `~/.local/share/com.primeagent.studio.nix`:

| Location       | Contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `data`         | Projects, attachments, hashed PIN, network settings and server logs |
| `.local`       | Studio data; legacy kernel markers may exist; Prime Agent owns its kernel |
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

`npm run test:components` checks path resolution, soft-discover, capability validation and the launcher UI (no component setup panel) in Chrome/Chromium. It uses no account or paid model.

On Linux, install Rust and the [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/) (including `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`), then run:

```sh
make init
make build            # finished unsigned AppImage/deb
make build-release    # signing key + signed packages + .local/desktop-release catalog
# optional release notes: make build-release NOTES=path/to/notes.md
```

Packages appear under `src-tauri/target/release/bundle/appimage` and `…/bundle/deb`. A signed release tree is also copied to `.local/desktop-release/v<version>` (space-free AppImage name, `.sig`, `latest.json`, and usually the matching `.deb`). `npm run desktop:dev` prepares resources and starts the development build. `npm run desktop:icons` regenerates icons from the SVG.

The build validates module, worker and native helper references before creating packages. `npm run test:desktop-runtime` exercises the resources prepared in `.desktop-build` using real Prime Agent workers and an isolated project and account storage: Python skills, prompts and providers.

`npm run test:desktop` tests the previously compiled debug executable: resources extracted by the executable, messages and Python skills using a simulated local HTTP model, provider and command APIs, reusing a server with an active simulated agent, starting the bundled server, single instance behavior and server survival when the Tauri process closes. Prime Agent must be available. Pass another executable path after `--` to test a different build. `npm run test:desktop-ui` checks presentation changes in Chrome/Chromium. Tests make no paid model calls.

For isolated tests, `PRIME_STUDIO_DESKTOP_DATA_ROOT` and `PRIME_STUDIO_DESKTOP_PORT` override the data folder and port. Leave them unset for normal use. Source installations can use `scripts/start-studio.sh` / `make start-silent`.

`npm run test:desktop-updates` and `npm run test:settings-updates` check both panels in French and English. `npm run test:desktop-lifecycle` validates a real Tauri restart with a busy server, confirmation, preserved data and activation of the installed version. `cargo test --manifest-path src-tauri/Cargo.toml --locked` tests the actual updater client against a local server: valid signature, tampered file, equal/older versions and invalid catalog. Tests never execute an installer.

For native tests alongside your application, compile a separate test identity: `TAURI_CONFIG='{"identifier":"com.primeagent.studio.nix.interaction-test"}' cargo build --manifest-path src-tauri/Cargo.toml --locked`. Unset the variable afterward before a distribution build. `npm run test:desktop-interactions` tests web and synthetic OAuth links, attachments, clipboard, export and permissions in the WebKitGTK webview. It opens test tabs in the default browser without signing into an account.

## Prepare an update release

`make build-release` is enough for a finished signed tree: it ensures `~/.tauri/prime-agent-studio-nix.key` exists, syncs the embedded updater pubkey and catalog URL into `src-tauri/tauri.conf.json`, builds signed AppImage/deb, and prepares `.local/desktop-release/v<version>`. Optional: `SET_SECRETS=1` uploads GitHub Actions signing secrets; `NOTES=path/to/notes.md` fills release notes in `latest.json`.

Lower-level steps remain available when you need them separately:

```sh
make desktop-release-bootstrap
# optional: make desktop-release-bootstrap SET_SECRETS=1
make desktop-release-check
make desktop-build
make desktop-manifest
```

The private signing key stays outside the repository. Back it up securely: installed applications trust its embedded public key, and an incompatible replacement key would prevent updates. Signed builds use this local key or `TAURI_SIGNING_PRIVATE_KEY` (path or content) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. For local installs without updater artifacts, use `make build` (alias: `make desktop-build-unsigned`). Without a key and without `--unsigned`, `npm run desktop:build -- --no-bundle` builds only the executable.

Do not rename the AppImage after packaging: the catalog contains its exact URL.

Release downloads and the in-app updater catalog are published from [mholtzhausen/prime-agent-studio](https://github.com/mholtzhausen/prime-agent-studio/releases). The GitHub **Linux desktop release** workflow runs manually with an existing stable tag matching `package.json`. It tests, builds, signs and prepares a **draft release** containing these files. Configure repository secrets `TAURI_SIGNING_PRIVATE_KEY` and, for an encrypted key, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (bootstrap can set both). It refuses to overwrite a published release. The workflows never sign a manually uploaded package: they always rebuild from the tag before signing. Review the draft, then publish it as the latest stable release to make the update available. Do not subsequently publish a stable release without its catalog and AppImage.

When bumping the package version for a release, use the Cursor `/version-bump` skill with an explicit bump type (`major`, `minor`, `patch`, or `build`) so `package.json`, `src-tauri/Cargo.toml`, and bilingual changelogs stay aligned.

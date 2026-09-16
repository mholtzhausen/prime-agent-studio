import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const unsigned = rawArgs.includes('--unsigned');
const args = rawArgs.filter((arg) => arg !== '--unsigned');
const env = { ...process.env };
const localKey = join(homedir(), '.tauri', 'prime-agent-studio-nix.key');
const noBundle = args.includes('--no-bundle');
if (unsigned) {
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
} else if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(localKey)) {
  // `tauri build` expects key contents in TAURI_SIGNING_PRIVATE_KEY (not a path).
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(localKey, 'utf8');
}
if (!unsigned) {
  // Prefer contents over a path when both somehow appear in the environment.
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  // Pass an empty password for unencrypted keys so the signer does not try to read a TTY.
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
}
if (!noBundle && !unsigned && !env.TAURI_SIGNING_PRIVATE_KEY)
  throw new Error(
    'Signing key required for signed bundles. Use --unsigned for local AppImage/deb without updater signatures, or --no-bundle for the executable only. See docs/desktop.md.',
  );
const tauriArgs = [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...args];
if (unsigned) {
  tauriArgs.push('-c', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
}
const result = spawnSync(process.execPath, tauriArgs, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

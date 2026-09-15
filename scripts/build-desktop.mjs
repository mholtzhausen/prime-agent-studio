import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const env = { ...process.env };
const localKey = join(homedir(), '.tauri', 'prime-agent-studio-nix.key');
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(localKey)) {
  // `tauri build` expects key contents in TAURI_SIGNING_PRIVATE_KEY (not a path).
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(localKey, 'utf8');
}
// Prefer contents over a path when both somehow appear in the environment.
delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
// Pass an empty password for unencrypted keys so the signer does not try to read a TTY.
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
if (!args.includes('--no-bundle') && !env.TAURI_SIGNING_PRIVATE_KEY)
  throw new Error('Signing key required: set TAURI_SIGNING_PRIVATE_KEY. See docs/desktop.md.');
const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...args],
  { cwd: root, env, stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

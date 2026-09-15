#!/usr/bin/env node
/**
 * Bootstrap Linux desktop release signing and updater coordinates.
 *
 * - Ensures ~/.tauri/prime-agent-studio-nix.key (+ .pub) exist
 * - Syncs the public key and latest.json endpoint into src-tauri/tauri.conf.json
 * - Optionally uploads the private key to GitHub Actions secrets
 *
 * Usage:
 *   node scripts/bootstrap-desktop-release.mjs
 *   node scripts/bootstrap-desktop-release.mjs --set-github-secrets
 *   node scripts/bootstrap-desktop-release.mjs --check
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  GITHUB_RELEASE_REPO,
  SIGNING_KEY_BASENAME,
  UPDATER_LATEST_JSON_URL,
} from '../lib/desktop-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const setSecrets = args.has('--set-github-secrets');
const keyDir = join(homedir(), '.tauri');
const keyPath = join(keyDir, SIGNING_KEY_BASENAME);
const pubPath = `${keyPath}.pub`;
const tauriConfPath = join(root, 'src-tauri/tauri.conf.json');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${commandArgs.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

function normalizePubkey(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trimEnd();
  if (!text) throw new Error(`Empty public key: ${pubPath}`);
  return `${text}\n`;
}

function ensureSigningKey() {
  mkdirSync(keyDir, { recursive: true });
  if (existsSync(keyPath) && existsSync(pubPath)) return false;
  if (existsSync(keyPath) !== existsSync(pubPath)) {
    throw new Error(
      `Incomplete signing key pair under ${keyDir}. Keep ${SIGNING_KEY_BASENAME} and ${SIGNING_KEY_BASENAME}.pub together, or remove both and re-run.`,
    );
  }
  if (checkOnly) throw new Error(`Missing signing key: ${keyPath}`);
  const tauriCli = join(root, 'node_modules/@tauri-apps/cli/tauri.js');
  if (!existsSync(tauriCli)) throw new Error('Run npm ci before generating a signing key.');
  console.log(`Generating updater signing key at ${keyPath}`);
  run(process.execPath, [tauriCli, 'signer', 'generate', '-w', keyPath], { stdio: 'inherit' });
  if (!existsSync(keyPath) || !existsSync(pubPath)) {
    throw new Error('tauri signer generate did not create the expected key pair.');
  }
  return true;
}

function syncTauriConfig(pubkey) {
  const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  conf.plugins ??= {};
  conf.plugins.updater ??= {};
  const before = {
    pubkey: conf.plugins.updater.pubkey,
    endpoints: conf.plugins.updater.endpoints,
  };
  conf.plugins.updater.pubkey = pubkey;
  conf.plugins.updater.endpoints = [UPDATER_LATEST_JSON_URL];
  const changed =
    before.pubkey !== conf.plugins.updater.pubkey ||
    JSON.stringify(before.endpoints) !== JSON.stringify(conf.plugins.updater.endpoints);
  if (changed && !checkOnly) {
    writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`);
  }
  if (checkOnly && changed) {
    throw new Error(
      'tauri.conf.json updater pubkey/endpoints are out of sync with the local nix key and release repo. Re-run without --check.',
    );
  }
  return changed;
}

function uploadGithubSecrets() {
  run(
    'gh',
    [
      'secret',
      'set',
      'TAURI_SIGNING_PRIVATE_KEY',
      '-R',
      GITHUB_RELEASE_REPO,
      '--body',
      readFileSync(keyPath, 'utf8'),
    ],
    { stdio: 'inherit' },
  );
  // Empty password is valid for an unencrypted key; keeps workflow env defined.
  run(
    'gh',
    [
      'secret',
      'set',
      'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
      '-R',
      GITHUB_RELEASE_REPO,
      '--body',
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
    ],
    { stdio: 'inherit' },
  );
}

const generated = ensureSigningKey();
const pubkey = normalizePubkey(readFileSync(pubPath, 'utf8'));
const confChanged = syncTauriConfig(pubkey);

if (setSecrets) {
  if (checkOnly) throw new Error('--set-github-secrets cannot be combined with --check');
  uploadGithubSecrets();
}

console.log(
  [
    'Desktop release bootstrap',
    `  repository : ${GITHUB_RELEASE_REPO}`,
    `  private key: ${keyPath}${generated ? ' (created)' : ''}`,
    `  public key : ${pubPath}`,
    `  updater    : ${UPDATER_LATEST_JSON_URL}`,
    `  tauri.conf : ${confChanged ? (checkOnly ? 'needs sync' : 'updated') : 'already synced'}`,
    setSecrets
      ? '  secrets    : TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD) uploaded'
      : `  secrets    : gh secret set TAURI_SIGNING_PRIVATE_KEY -R ${GITHUB_RELEASE_REPO} < ${keyPath}`,
    '',
    'Next:',
    '  1. Commit the tauri.conf.json pubkey/endpoint change if updated',
    '  2. make desktop-build && npm run desktop:manifest',
    '  3. Tag vX.Y.Z matching package.json, then run the Linux desktop release workflow',
    '  4. When cutting a version bump, use /version-bump [major|minor|patch|build]',
  ].join('\n'),
);

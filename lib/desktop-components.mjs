import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverCli, agentEnvironment } from './agent.mjs';
import { ensureLocalKernel, execute } from './kernel.mjs';
import { extractTgz } from './component-archives.mjs';
import { acquireLock } from '../scripts/launcher-common.mjs';

export const COMPONENT_POLICY = Object.freeze({
  engine: '0.9.4',
  npm: '10.9.4',
  uv: '0.8.22',
  installer: 'https://app.primeintellect.ai/prime-agent/install.sh',
});
// Trust boundary: fixed official hosts only. No wildcard. Rotation fails closed
// and needs an explicit policy update. Evidence (read-only, 2026-09-13):
// installer host app.primeintellect.ai serves install.sh with default base_url
// https://pub-728493de92a943e2a9b2d17b4719f318.r2.dev ; npm has no redirect;
// uv github.com redirects to release-assets.githubusercontent.com.
export const ALLOWED_DOWNLOAD_HOSTS = Object.freeze([
  'app.primeintellect.ai',
  'pub-728493de92a943e2a9b2d17b4719f318.r2.dev',
  'registry.npmjs.org',
  'github.com',
  'release-assets.githubusercontent.com',
]);
// Exact current engine origin only. Another *.r2.dev bucket is not trusted.
export const ALLOWED_ENGINE_ORIGINS = Object.freeze([
  'https://pub-728493de92a943e2a9b2d17b4719f318.r2.dev',
]);
const PROBE = fileURLToPath(new URL('../scripts/component-probe.mjs', import.meta.url));
// Minimal environment for engine probing: PATH/temp/locale plus the precise
// non-secret runtime vars. Provider keys and other user secrets are never
// inherited by the probed engine code.
export function probeEnvironment(env = process.env) {
  const clean = {};
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR'])
    if (typeof env[key] === 'string' && env[key]) clean[key] = env[key];
  if (typeof env.PRIME_AGENT_CODING_AGENT_DIR === 'string' && env.PRIME_AGENT_CODING_AGENT_DIR)
    clean.PRIME_AGENT_CODING_AGENT_DIR = env.PRIME_AGENT_CODING_AGENT_DIR;
  // NODE_OPTIONS is never inherited: runtimeEnv may carry an injectable
  // --require/--import chain. Probing does not need the Studio preload.
  clean.PRIME_GUI_SILENT = '1';
  clean.NO_COLOR = '1';
  clean.FORCE_COLOR = '0';
  return clean;
}
const json = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('manifest_invalid');
  }
};
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
export function checkNode(version = process.versions.node, platform = process.platform, arch = process.arch) {
  if (platform !== 'linux' || arch !== 'x64') throw new Error('architecture_unsupported');
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  // Only the maintained Node lines actually covered by Studio's compatibility policy.
  if (!((major === 22 && minor >= 16) || major === 24)) throw new Error('node_incompatible');
}

/**
 * Shared root for engine/selection.json and installation.json.
 * Desktop: Tauri data root (PRIME_STUDIO_DESKTOP_DATA_ROOT / KERNEL_ROOT).
 * Browser / make dev: KERNEL_ROOT, else parent of DATA_DIR when it ends with data/, else DATA_DIR.
 */
export function componentsDataRoot(env = process.env) {
  if (typeof env.PRIME_STUDIO_DESKTOP_DATA_ROOT === 'string' && env.PRIME_STUDIO_DESKTOP_DATA_ROOT)
    return resolve(env.PRIME_STUDIO_DESKTOP_DATA_ROOT);
  if (typeof env.PRIME_AGENT_GUI_KERNEL_ROOT === 'string' && env.PRIME_AGENT_GUI_KERNEL_ROOT)
    return resolve(env.PRIME_AGENT_GUI_KERNEL_ROOT);
  const dataDir = resolve(env.PRIME_AGENT_GUI_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '.local'));
  if (dirname(dataDir) !== dataDir && /(?:^|[/\\])data$/i.test(dataDir)) return dirname(dataDir);
  return dataDir;
}

function expandUserPath(value) {
  if (typeof value !== 'string' || !value) return undefined;
  return resolve(/^~[\\/]/.test(value) ? join(homedir(), value.slice(2)) : value);
}

export function isComponentsActivated(manifest, resolved, externalPython) {
  return Boolean(
    manifest?.validatedAt &&
      manifest.shellValidated === true &&
      resolved?.path &&
      resolved.path === manifest.components?.engine?.path &&
      (!externalPython || externalPython === manifest.components?.python?.path),
  );
}

export async function selectedEnvironment(dataRoot, env = process.env) {
  const root = resolve(dataRoot);
  const manifest = await json(join(root, 'engine/installation.json'));
  const selection = await json(join(root, 'engine/selection.json'));
  const result = { ...env };
  for (const [key, name] of [
    ['PRIME_AGENT_CLI', 'engine'],
    ['PRIME_GUI_UV', 'uv'],
    ['PRIME_AGENT_KERNEL_PYTHON', 'python'],
  ]) {
    const saved = selection[name];
    const managed = name === 'python' ? undefined : manifest.components?.[name]?.path;
    if (!result[key] && (saved || managed)) result[key] = saved || managed;
  }
  result.PRIME_AGENT_GUI_KERNEL_ROOT = root;
  if (env.PRIME_STUDIO_DESKTOP_DATA_ROOT || env.PRIME_STUDIO_COMPONENTS_REQUIRED === '1')
    result.PRIME_STUDIO_DESKTOP_DATA_ROOT = root;
  const resolved = discoverCli(result.PRIME_AGENT_CLI || null, result);
  const externalPython = expandUserPath(result.PRIME_AGENT_KERNEL_PYTHON);
  const activated = isComponentsActivated(manifest, resolved, externalPython);
  // Desktop / incomplete setup stays gated until activation. Browser make-dev stays open
  // unless an explicit COMPONENTS_REQUIRED=1 was already set.
  result.PRIME_STUDIO_COMPONENTS_REQUIRED = activated
    ? '0'
    : env.PRIME_STUDIO_DESKTOP_DATA_ROOT || env.PRIME_STUDIO_COMPONENTS_REQUIRED === '1'
      ? '1'
      : '0';
  result.UV_PYTHON_INSTALL_DIR = join(root, 'engine/python');
  result.UV_CACHE_DIR = join(root, 'engine/cache/uv');
  result.UV_PYTHON_DOWNLOADS = 'automatic';
  result.UV_PYTHON_PREFERENCE = 'only-managed';
  return result;
}
export async function download(
  url,
  { signal, onProgress = () => {}, limit = 128 * 1024 * 1024, fetchImpl = fetch, allowLocal = false } = {},
) {
  const timeout = AbortSignal.timeout(180000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let redirects = 0; redirects < 6; redirects++) {
    const parsed = new URL(url);
    const isLocal =
      allowLocal && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
    if (
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== 'https:' && !isLocal) ||
      (!isLocal && !ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname.toLowerCase()))
    )
      throw new Error('source_invalid');
    const response = await fetchImpl(url, { signal: combined, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('source_invalid');
      try {
        url = new URL(location, url).href;
      } catch {
        throw new Error('source_invalid');
      }
      continue;
    }
    if (!response.ok || !response.body) throw new Error('download_failed');
    const total = Number(response.headers.get('content-length')) || undefined;
    if (total > limit) {
      await response.body.cancel();
      throw new Error('download_too_large');
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > limit) throw new Error('download_too_large');
      chunks.push(chunk);
      onProgress({ received, total });
    }
    if (total && received !== total) throw new Error('download_failed');
    return Buffer.concat(chunks);
  }
  throw new Error('source_invalid');
}
export function checksum(inventory, name) {
  const matches = inventory
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i))
    .filter((match) => match && match[2] === name);
  if (matches.length !== 1) throw new Error('checksum_missing');
  return matches[0][1].toLowerCase();
}
export function verifyDigest(buffer, expected, algorithm = 'sha256', encoding = 'hex') {
  if (createHash(algorithm).update(buffer).digest(encoding) !== expected)
    throw new Error('checksum_mismatch');
}
export function releaseOrigin(installer) {
  const matches = [
    ...installer.matchAll(/prime_agent_base_url="\$\{PRIME_AGENT_DOWNLOAD_BASE_URL:-([^}]+)\}"/g),
  ];
  if (matches.length !== 1) throw new Error('source_contract_changed');
  const url = new URL(matches[0][1]);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('source_contract_changed');
  return url.origin;
}
export function assertAllowedEngineOrigin(origin) {
  if (!ALLOWED_ENGINE_ORIGINS.includes(origin)) throw new Error('source_contract_changed');
  return origin;
}
// Static triage only: no process is started, no module is imported.
// External / user picks: capability checks only. Managed installs still pin exact policy version.
export async function inspectEngineStatic(path, env = process.env, { requirePolicyVersion = false } = {}) {
  const cli = discoverCli(path, env);
  if (!cli?.packageDir || !cli.node || cli.path !== join(cli.packageDir, 'dist/bundle/cli.js'))
    throw new Error('engine_incompatible');
  const pkg = await json(join(cli.packageDir, 'package.json'));
  if (pkg.name !== 'prime-agent') throw new Error('engine_incompatible');
  if (requirePolicyVersion && pkg.version !== COMPONENT_POLICY.engine) throw new Error('engine_incompatible');
  if (pkg.engines?.node && pkg.engines.node !== '>=22.8.0' && requirePolicyVersion)
    throw new Error('engine_incompatible');
  return { cli, pkg, policyMatch: pkg.version === COMPONENT_POLICY.engine };
}
// Managed path alone is not provenance: require the download receipt saved by
// prepareComponents. Same-user writers can still forge dataRoot JSON, so this
// raises the bar but does not isolate mutually untrusted same-user processes.
export function hasManagedEngineReceipt(candidate, { cached = {}, installed = {} } = {}) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const expectedProvenance = `${ALLOWED_ENGINE_ORIGINS[0]}/releases/v${COMPONENT_POLICY.engine}/prime-agent-${COMPONENT_POLICY.engine}.tgz`;
  const records = [];
  if (installed.components?.engine?.path === candidate) records.push(installed.components.engine);
  if (cached.engine?.path === candidate) records.push(cached.engine);
  if (!records.length) return false;
  return records.some(
    (info) =>
      info.version === COMPONENT_POLICY.engine &&
      /^[a-f0-9]{64}$/i.test(info.sha256 || '') &&
      info.provenance === expectedProvenance &&
      (!info.installer || info.installer === COMPONENT_POLICY.installer),
  );
}
function uvReleaseAsset() {
  return 'uv-x86_64-unknown-linux-gnu.tar.gz';
}

export function hasManagedUvReceipt(candidate, { cached = {}, installed = {} } = {}) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const expectedProvenance = `https://github.com/astral-sh/uv/releases/download/${COMPONENT_POLICY.uv}/${uvReleaseAsset()}`;
  const records = [];
  if (cached.uv?.path === candidate) records.push(cached.uv);
  if (installed.components?.uv?.path === candidate) records.push(installed.components.uv);
  if (!records.length) return false;
  return records.some(
    (info) =>
      info.version === COMPONENT_POLICY.uv &&
      /^[a-f0-9]{64}$/i.test(info.sha256 || '') &&
      info.provenance === expectedProvenance,
  );
}
export async function validateEngine(path, env, signal, { requirePolicyVersion = false } = {}) {
  const { cli, policyMatch } = await inspectEngineStatic(path, env, { requirePolicyVersion });
  const probeEnv = probeEnvironment(env);
  const version = await promisify(execFile)(process.execPath, [cli.path, '--version'], {
    env: probeEnv,
    windowsHide: true,
    shell: false,
    timeout: 30000,
    maxBuffer: 65536,
    signal,
  });
  const reported = [version.stdout.trim(), version.stderr.trim()].find((line) => /\d+\.\d+/.test(line));
  if (requirePolicyVersion && !reported?.includes(COMPONENT_POLICY.engine))
    throw new Error('engine_incompatible');
  if (!reported) throw new Error('engine_incompatible');
  const probe = JSON.parse(
    await execute(
      process.execPath,
      [
        PROBE,
        cli.packageDir,
        join(env.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent'), 'settings.json'),
      ],
      probeEnv,
      30000,
      signal,
    ),
  );
  return {
    path: cli.path,
    packageDir: cli.packageDir,
    version: cli.version || reported,
    bash: probe.bash,
    policyMatch: policyMatch && reported.includes(COMPONENT_POLICY.engine),
  };
}
export async function validateUv(path, env, signal, { requirePolicyVersion = false } = {}) {
  const output = await execute(path, ['--version'], probeEnvironment(env), 10000, signal);
  const version = output.match(/^uv (\d+\.\d+\.\d+)/)?.[1];
  if (!version) throw new Error('uv_incompatible');
  if (requirePolicyVersion && version !== COMPONENT_POLICY.uv) throw new Error('uv_incompatible');
  // ELF 64-bit little-endian AMD64 (EM_X86_64 = 62).
  const bin = await readFile(path);
  if (bin.length < 20 || bin.readUInt32LE(0) !== 0x464c457f || bin[4] !== 2 || bin.readUInt16LE(18) !== 62)
    throw new Error('uv_incompatible');
  return { path, version, policyMatch: version === COMPONENT_POLICY.uv };
}
const componentError = (error) =>
  /ENOSPC|not enough space/i.test(`${error.code} ${error.message}`)
    ? 'disk_full'
    : /EACCES|EPERM|permission denied/i.test(`${error.code} ${error.message}`)
      ? 'write_denied'
      : error.name === 'AbortError'
        ? 'cancelled'
        : error.name === 'TimeoutError'
          ? 'download_failed'
          : /^[a-z_]+$/.test(error.message || '')
            ? error.message
            : 'validation_failed';

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export function listUvCandidates(dataRoot, env = process.env, cached = {}) {
  return uniquePaths([
    env.PRIME_GUI_UV,
    join(homedir(), '.local/bin/uv'),
    join(homedir(), '.cargo/bin/uv'),
    ...(env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .map((p) => join(p, 'uv')),
    cached.uv?.path,
  ]).filter((path) => path && existsSync(path));
}

export function listEngineCandidates(dataRoot, env = process.env, cached = {}) {
  return uniquePaths([
    env.PRIME_AGENT_CLI,
    ...discoverCli(null, env, { all: true }).map((cli) => cli.packageDir || cli.path),
    cached.engine?.path,
  ]).filter(Boolean);
}

export function listPythonCandidates(env = process.env) {
  return uniquePaths([
    env.PRIME_AGENT_KERNEL_PYTHON,
    join(homedir(), '.local/bin/python3.11'),
    join(homedir(), '.local/bin/python3'),
    '/usr/bin/python3.11',
    '/usr/bin/python3',
    ...(env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .flatMap((p) => [join(p, 'python3.11'), join(p, 'python3')]),
  ]).filter((path) => path && existsSync(path));
}

export async function listCandidates({ dataRoot, env = process.env } = {}) {
  const root = resolve(dataRoot || componentsDataRoot(env));
  const cached = await json(join(root, 'engine/prepared.json'));
  const selected = await selectedEnvironment(root, env);
  return {
    engine: listEngineCandidates(root, selected, cached),
    uv: listUvCandidates(root, selected, cached),
    python: listPythonCandidates(selected),
  };
}

export async function activateComponents({ dataRoot, result, env = process.env } = {}) {
  if (!result?.ready) return result;
  const base = join(resolve(dataRoot), 'engine');
  await mkdir(base, { recursive: true });
  const release = await acquireLock({ lock: join(base, 'install.lock') }, { timeout: 1200 });
  try {
    const current = await json(join(base, 'installation.json'));
    if (
      current.shellValidated !== true ||
      current.components?.engine?.path !== result.components.engine.path ||
      current.components?.python?.path !== result.components.python.path
    )
      await atomicJson(join(base, 'installation.json'), {
        schema: 1,
        validatedAt: new Date().toISOString(),
        shellValidated: true,
        components: result.components,
      });
  } finally {
    await release();
  }
  return result;
}

async function persistSelection(dataRoot, patch) {
  const base = join(resolve(dataRoot), 'engine');
  await mkdir(base, { recursive: true });
  const release = await acquireLock({ lock: join(base, 'install.lock') }, { timeout: 1200 });
  try {
    const current = await json(join(base, 'selection.json'));
    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') delete next[key];
      else if (typeof value === 'string') {
        if (key === 'engine') {
          const resolved = discoverCli(value);
          next[key] = resolved?.packageDir || value;
        } else if (key === 'uv') {
          next[key] = (await resolveUvBinary(value)) || value;
        } else next[key] = value;
      }
    }
    await atomicJson(join(base, 'selection.json'), next);
    return next;
  } finally {
    await release();
  }
}

/** Prefer a real ELF uv over pyenv/shell shims. */
async function resolveUvBinary(path) {
  if (typeof path !== 'string' || !path) return path;
  const candidates = [path];
  try {
    if (existsSync(path)) {
      const head = (await readFile(path)).subarray(0, 4);
      // Not ELF — try common real locations and dirname/uv.
      if (head.readUInt32LE(0) !== 0x464c457f) {
        candidates.push(
          join(homedir(), '.local/bin/uv'),
          join(homedir(), '.cargo/bin/uv'),
          join(dirname(path), 'uv'),
        );
        // pyenv shim → versions/*/bin/uv
        if (path.includes('.pyenv/shims/')) {
          const versions = join(homedir(), '.pyenv/versions');
          if (existsSync(versions)) {
            const { readdirSync } = await import('node:fs');
            for (const name of readdirSync(versions))
              candidates.push(join(versions, name, 'bin/uv'));
          }
        }
      }
    }
  } catch {
    /* keep original */
  }
  for (const candidate of uniquePaths(candidates)) {
    try {
      await validateUv(candidate, process.env);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return path;
}

/** Apply path selection, diagnose, and activate when ready. */
export async function applySelection(
  { dataRoot, env = process.env, signal, paths = {}, discover = false },
  deps = {},
) {
  const root = resolve(dataRoot);
  if (discover) {
    const candidates = await listCandidates({ dataRoot: root, env });
    const selection = await json(join(root, 'engine/selection.json'));
    const patch = {};
    if (!env.PRIME_AGENT_CLI && !selection.engine && candidates.engine[0])
      patch.engine = candidates.engine[0];
    if (!env.PRIME_GUI_UV && !selection.uv && candidates.uv[0]) patch.uv = candidates.uv[0];
    // Do not soft-default PATH python: Studio prefers a managed kernel once uv is ready.
    if (Object.keys(patch).length) await persistSelection(root, patch);
  }
  const hasPaths = ['engine', 'uv', 'python'].some((key) => key in paths);
  if (hasPaths) {
    const patch = {};
    for (const key of ['engine', 'uv', 'python']) {
      if (!(key in paths)) continue;
      const value = paths[key];
      if (value !== null && value !== undefined && typeof value !== 'string')
        throw new Error('selection_invalid');
      patch[key] = value;
    }
    await persistSelection(root, patch);
  }
  let result = await diagnoseComponents(
    { dataRoot: root, env, signal, autoDiscover: !hasPaths && !discover },
    deps,
  );
  // When engine+uv are ready but no kernel exists yet, prepare a managed Python once.
  if (
    result.components?.engine?.status === 'ready' &&
    result.components?.uv?.status === 'ready' &&
    result.components?.python?.status !== 'ready' &&
    !(env.PRIME_AGENT_KERNEL_PYTHON || result.selection?.python)
  ) {
    const selected = await selectedEnvironment(root, env);
    if (result.components.uv.path) selected.PRIME_GUI_UV = result.components.uv.path;
    selected.PRIME_STUDIO_COMPONENTS_REQUIRED = '0';
    const home = selected.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent');
    await mkdir(home, { recursive: true });
    try {
      await (deps.ensureKernel || ensureLocalKernel)({
        packageDir: result.components.engine.packageDir,
        root,
        cwd: home,
        agentHome: home,
        env: agentEnvironment({ env: selected }),
        signal,
      });
      result = await diagnoseComponents({ dataRoot: root, env: selected, signal }, deps);
    } catch {
      /* leave python status for the UI */
    }
  }
  if (result.ready) result = (await activateComponents({ dataRoot: root, result, env })) || result;
  result.selection = await json(join(root, 'engine/selection.json'));
  result.candidates = await listCandidates({ dataRoot: root, env: await selectedEnvironment(root, env) });
  result.policy = { ...COMPONENT_POLICY };
  return result;
}

export async function diagnoseComponents(
  { dataRoot, env = process.env, signal, autoDiscover = false },
  deps = {},
) {
  const root = resolve(dataRoot);
  let selection = await json(join(root, 'engine/selection.json'));
  // Soft-default: validate PATH/conventional tools and persist the first working path
  // when the user has not configured env or selection yet.
  if (autoDiscover) {
    const patch = {};
    if (!env.PRIME_AGENT_CLI && !selection.engine) {
      for (const candidate of listEngineCandidates(root, env, await json(join(root, 'engine/prepared.json')))) {
        try {
          await (deps.validateEngine || validateEngine)(candidate, agentEnvironment({ env }), signal);
          patch.engine = candidate;
          break;
        } catch {
          /* try next */
        }
      }
    }
    if (!env.PRIME_GUI_UV && !selection.uv) {
      for (const candidate of listUvCandidates(root, env, await json(join(root, 'engine/prepared.json')))) {
        try {
          await (deps.validateUv || validateUv)(candidate, agentEnvironment({ env }), signal);
          patch.uv = candidate;
          break;
        } catch {
          /* try next */
        }
      }
    }
    if (Object.keys(patch).length) {
      selection = await persistSelection(root, patch);
    }
  }
  const selected = await selectedEnvironment(root, env);
  const home = selected.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent');
  const runtimeEnv = agentEnvironment({ env: selected });
  const cached = await json(join(root, 'engine/prepared.json'));
  const installed = await json(join(root, 'engine/installation.json'));
  const result = { components: {}, ready: false, dataRoot: root };
  try {
    (deps.checkNode || checkNode)();
    result.components.node = { status: 'ready', version: process.versions.node };
  } catch (e) {
    result.components.node = { status: 'error', error: componentError(e) };
    return result;
  }
  const explicit = env.PRIME_AGENT_CLI || selection.engine;
  // Explicit / selected / managed-with-receipt may run. Soft-default selection is explicit.
  const candidates = selected.PRIME_AGENT_CLI
    ? [{ path: selected.PRIME_AGENT_CLI, trusted: true }]
    : [...discoverCli(null, selected, { all: true }).map((cli) => cli.path), cached.engine?.path]
        .filter(Boolean)
        .map((path) => ({
          path,
          trusted:
            path.includes(join(root, 'engine')) &&
            hasManagedEngineReceipt(path, { cached, installed }),
        }));
  result.components.engine = { status: 'error', error: 'missing', explicit: Boolean(explicit) };
  for (const { path: candidate, trusted } of candidates) {
    if (!trusted && !explicit && !selected.PRIME_AGENT_CLI) continue;
    try {
      const validated = await (deps.validateEngine || validateEngine)(candidate, runtimeEnv, signal);
      result.components.engine = {
        ...validated,
        status: 'ready',
        source: explicit
          ? 'explicit'
          : candidate.includes(join(root, 'engine'))
            ? 'managed'
            : 'external',
        warning:
          validated.policyMatch === false
            ? 'engine_version_mismatch'
            : undefined,
      };
      break;
    } catch (e) {
      result.components.engine = { status: 'error', error: componentError(e), explicit: Boolean(explicit) };
    }
  }
  const engine = result.components.engine;
  if (engine.status === 'ready') {
    try {
      const python = await (deps.ensureKernel || ensureLocalKernel)({
        packageDir: engine.packageDir,
        root,
        cwd: existsSync(home) ? home : homedir(),
        agentHome: home,
        env: runtimeEnv,
        signal,
        readOnly: true,
      });
      result.components.python = {
        status: python ? 'ready' : 'missing',
        path: python,
        source: selected.PRIME_AGENT_KERNEL_PYTHON ? 'explicit' : 'managed',
      };
    } catch (e) {
      result.components.python = {
        status: 'error',
        error: componentError(e),
        explicit: Boolean(selected.PRIME_AGENT_KERNEL_PYTHON),
      };
    }
    try {
      if (!engine.bash) throw new Error('bash_missing');
      const output = await (deps.execute || execute)(
        engine.bash,
        ['--noprofile', '--norc', '-c', 'printf studio-shell-ok'],
        runtimeEnv,
        10000,
        signal,
      );
      if (output !== 'studio-shell-ok') throw new Error('bash_missing');
      result.components.bash = { status: 'ready', path: engine.bash };
    } catch {
      result.components.bash = { status: 'error', error: 'bash_missing' };
    }
  } else result.components.python = { status: 'pending' };
  const uvRequired = !selected.PRIME_AGENT_KERNEL_PYTHON && result.components.python.status !== 'ready';
  const uvExplicit = env.PRIME_GUI_UV || selection.uv;
  const uvCandidates = selected.PRIME_GUI_UV
    ? [{ path: selected.PRIME_GUI_UV, trusted: true }]
    : listUvCandidates(root, selected, cached).map((path) => ({
        path,
        trusted:
          path.includes(join(root, 'engine')) && hasManagedUvReceipt(path, { cached, installed }),
      }));
  result.components.uv = { status: uvRequired || uvExplicit ? 'missing' : 'not_required' };
  if (uvRequired || selected.PRIME_GUI_UV || uvExplicit)
    for (const { path, trusted } of uvCandidates) {
      if (!trusted && !uvExplicit && !selected.PRIME_GUI_UV) continue;
      try {
        const validated = await (deps.validateUv || validateUv)(path, runtimeEnv, signal);
        result.components.uv = {
          ...validated,
          status: 'ready',
          source: uvExplicit ? 'explicit' : path.includes(join(root, 'engine')) ? 'managed' : 'external',
          warning: validated.policyMatch === false ? 'uv_version_mismatch' : undefined,
        };
        break;
      } catch (e) {
        if (uvExplicit) {
          result.components.uv = { status: 'error', explicit: true, error: componentError(e) };
          break;
        }
      }
    }
  result.ready =
    ['engine', 'python', 'bash'].every((key) => result.components[key]?.status === 'ready') &&
    !Object.values(result.components).some((c) => c.explicit && c.status === 'error');
  for (const name of ['engine', 'uv']) {
    const info = installed.components?.[name] || cached[name];
    if (info?.path && info.path === result.components[name]?.path) {
      result.components[name].provenance = info.provenance;
      result.components[name].sha256 = info.sha256;
    }
  }
  result.selection = selection;
  return result;
}

export async function prepareComponents(
  { dataRoot, env = process.env, signal, onProgress = () => {}, selection },
  deps = {},
) {
  (deps.checkNode || checkNode)();
  const base = join(resolve(dataRoot), 'engine');
  await mkdir(base, { recursive: true });
  const release = await acquireLock({ lock: join(base, 'install.lock') }, { timeout: 1200 });
  const emit = (component, stage, extra = {}) => onProgress({ component, stage, ...extra });
  let component = 'engine';
  try {
    if (selection) {
      if (!['engine', 'uv', 'python'].includes(selection.component) || typeof selection.path !== 'string')
        throw new Error('selection_invalid');
      const settings = await json(join(base, 'selection.json'));
      await atomicJson(join(base, 'selection.json'), { ...settings, [selection.component]: selection.path });
    }
    let state = await diagnoseComponents({ dataRoot, env, signal }, deps);
    if (Object.values(state.components).some((c) => c.explicit && c.status === 'error'))
      throw new Error('explicit_invalid');
    const prepared = await json(join(base, 'prepared.json'));
    const runtimeEnv = agentEnvironment({ env: await selectedEnvironment(dataRoot, env) });
    runtimeEnv.PRIME_STUDIO_COMPONENTS_REQUIRED = '0';
    // Resume a fully validated component after a later Python/network failure.
    // Same gate as diagnose: managed path with receipt only, never execute untrusted.
    if (state.components.engine.status !== 'ready' && prepared.engine?.path) {
      const resumePath = prepared.engine.path;
      const resumeInstalled = await json(join(base, 'installation.json'));
      const resumeTrusted =
        resumePath.includes(base) &&
        hasManagedEngineReceipt(resumePath, { cached: prepared, installed: resumeInstalled });
      if (resumeTrusted) {
        try {
          state.components.engine = {
            ...((await (deps.validateEngine || validateEngine)(resumePath, runtimeEnv, signal))),
            status: 'ready',
            source: 'managed',
          };
        } catch {
          /* An old or damaged prepared engine must be replaced. */
        }
      }
    }
    const fetchBytes = async (url, limit) =>
      (deps.download || download)(url, {
        signal,
        limit,
        onProgress: (bytes) => emit(component, 'download', bytes),
      });
    const text = async (url) => (await fetchBytes(url, 2 * 1024 * 1024)).toString('utf8');
    async function save(name, info) {
      prepared[name] = info;
      await atomicJson(join(base, 'prepared.json'), prepared);
    }
    async function stage(name, install) {
      const id = randomUUID();
      const work = join(base, 'staging', id);
      await mkdir(work, { recursive: true });
      emit(name, 'install');
      const installed = await install(work);
      signal?.throwIfAborted();
      const destination = join(
        base,
        name === 'engine' ? 'prime-agent' : name,
        `${COMPONENT_POLICY[name]}-${id}`,
      );
      await mkdir(dirname(destination), { recursive: true });
      await rename(installed, destination);
      return destination;
    }
    if (state.components.engine.status !== 'ready') {
      component = 'npm';
      let npm = prepared.npm;
      if (npm)
        try {
          if (
            (await execute(process.execPath, [npm.path, '--version'], runtimeEnv, 15000, signal)).trim() !==
            COMPONENT_POLICY.npm
          )
            npm = null;
        } catch {
          npm = null;
        }
      if (!npm) {
        const source = `https://registry.npmjs.org/npm/${COMPONENT_POLICY.npm}`;
        const metadata = JSON.parse(await text(source));
        const url = `https://registry.npmjs.org/npm/-/npm-${COMPONENT_POLICY.npm}.tgz`;
        if (
          metadata.version !== COMPONENT_POLICY.npm ||
          metadata.dist?.tarball !== url ||
          !/^sha512-[A-Za-z0-9+/]{86}==$/.test(metadata.dist?.integrity)
        )
          throw new Error('source_invalid');
        const archive = await fetchBytes(url);
        emit(component, 'verify');
        verifyDigest(archive, metadata.dist.integrity.slice(7), 'sha512', 'base64');
        const directory = await stage('npm', async (work) => {
          await extractTgz(archive, join(work, 'unpacked'));
          return join(work, 'unpacked/package');
        });
        npm = {
          path: join(directory, 'bin/npm-cli.js'),
          version: COMPONENT_POLICY.npm,
          source,
          integrity: metadata.dist.integrity,
          sha256: createHash('sha256').update(archive).digest('hex'),
        };
        if (
          (await execute(process.execPath, [npm.path, '--version'], runtimeEnv, 15000, signal)).trim() !==
          npm.version
        )
          throw new Error('npm_incompatible');
        await save('npm', npm);
      }
      component = 'engine';
      const origin = assertAllowedEngineOrigin(releaseOrigin(await text(COMPONENT_POLICY.installer)));
      const releaseUrl = `${origin}/releases/v${COMPONENT_POLICY.engine}`;
      const inventory = await text(`${releaseUrl}/SHA256SUMS`);
      const name = `prime-agent-${COMPONENT_POLICY.engine}.tgz`,
        source = `${releaseUrl}/${name}`;
      const sha256 = checksum(inventory, name);
      const archive = await fetchBytes(source);
      emit(component, 'verify');
      verifyDigest(archive, sha256);
      const directory = await stage('engine', async (work) => {
        await extractTgz(archive, join(work, 'unpacked'));
        const packageDir = join(work, 'unpacked/package');
        const pkg = await json(join(packageDir, 'package.json'));
        if (pkg.name !== 'prime-agent' || pkg.version !== COMPONENT_POLICY.engine)
          throw new Error('engine_incompatible');
        // Verify all three first-party dependencies against the SAME official inventory.
        // Local tarballs keep the versioned graph intact without trusting unchecked remote URLs.
        for (const [key, value] of Object.entries(pkg.dependencies || {})) {
          if (!key.startsWith('@earendil-works/')) continue;
          const depName = new URL(value).pathname.split('/').at(-1);
          if (
            value !== `${releaseUrl}/${depName}` ||
            !/^prime-agent-(ai|core|tui)-0\.9\.4\.tgz$/.test(depName)
          )
            throw new Error('source_invalid');
          const dep = await fetchBytes(value);
          verifyDigest(dep, checksum(inventory, depName));
          await extractTgz(dep, join(work, depName + '-checked'));
          await writeFile(join(work, depName), dep, { flag: 'wx' });
          pkg.dependencies[key] = `file:${join(work, depName).replaceAll('\\', '/')}`;
        }
        await writeFile(join(packageDir, 'package.json'), JSON.stringify(pkg));
        // Install directly at the package root: native workers require packageDir/node_modules.
        const emptyConfig = join(work, 'empty.npmrc');
        await writeFile(emptyConfig, '');
        const globalConfig = join(work, 'global.npmrc');
        await writeFile(globalConfig, '');
        const npmEnv = {
          ...runtimeEnv,
          PATH: `${dirname(process.execPath)}${delimiter}${runtimeEnv.PATH || ''}`,
          npm_config_userconfig: emptyConfig,
          npm_config_globalconfig: globalConfig,
          npm_config_cache: join(base, 'cache/npm'),
          npm_config_registry: 'https://registry.npmjs.org/',
          PRIME_AGENT_BOOTSTRAP_TOOLS_ON_INSTALL: '0',
          PRIME_AGENT_BOOTSTRAP_KERNEL_ON_INSTALL: '0',
        };
        await execute(
          process.execPath,
          [
            npm.path,
            'install',
            '--prefix',
            packageDir,
            '--install-strategy=nested',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--package-lock=true',
            '--fetch-retries=2',
            '--fetch-timeout=60000',
            '--registry=https://registry.npmjs.org/',
          ],
          npmEnv,
          600000,
          signal,
          { cwd: packageDir },
        );
        // No lifecycle scripts are necessary for 0.9.4's essential integrations.
        // Preserve upstream metadata after resolving dependencies; retain npm's lock as evidence.
        const original = JSON.parse((await readFile(join(work, 'unpacked/package/package.json'))).toString());
        for (const [key, value] of Object.entries(original.dependencies))
          if (key.startsWith('@earendil-works/'))
            original.dependencies[key] = `${releaseUrl}/${new URL(value).pathname.split('/').at(-1)}`;
        await writeFile(join(packageDir, 'package.json'), JSON.stringify(original, null, 2));
        await validateEngine(packageDir, runtimeEnv, signal, { requirePolicyVersion: true });
        return packageDir;
      });
      const engine = await validateEngine(directory, runtimeEnv, signal, { requirePolicyVersion: true });
      await save('engine', {
        ...engine,
        provenance: source,
        sha256,
        installer: COMPONENT_POLICY.installer,
        validatedAt: new Date().toISOString(),
      });
      state.components.engine = { ...engine, status: 'ready', source: 'managed' };
    }
    component = 'uv';
    if (
      !runtimeEnv.PRIME_AGENT_KERNEL_PYTHON &&
      state.components.python.status !== 'ready' &&
      state.components.uv.status !== 'ready'
    ) {
      const name = uvReleaseAsset();
      const source = `https://github.com/astral-sh/uv/releases/download/${COMPONENT_POLICY.uv}/${name}`;
      const sha256 = checksum(await text(source + '.sha256'), name);
      const archive = await fetchBytes(source);
      emit(component, 'verify');
      verifyDigest(archive, sha256);
      const directory = await stage('uv', async (work) => {
        const target = join(work, 'unpacked');
        await extractTgz(archive, target);
        return target;
      });
      const uv = await validateUv(join(directory, 'uv'), runtimeEnv, signal, {
        requirePolicyVersion: true,
      });
      await save('uv', { ...uv, provenance: source, sha256, validatedAt: new Date().toISOString() });
      state.components.uv = { ...uv, status: 'ready', source: 'managed' };
    }
    if (state.components.uv.path) runtimeEnv.PRIME_GUI_UV = state.components.uv.path;
    const engine = state.components.engine;
    component = 'python';
    emit(component, 'python');
    const home = runtimeEnv.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent');
    await mkdir(home, { recursive: true });
    const python = await (deps.ensureKernel || ensureLocalKernel)({
      packageDir: engine.packageDir,
      root: dataRoot,
      cwd: home,
      agentHome: home,
      env: runtimeEnv,
      signal,
      onProgress: () => emit(component, 'python'),
    });
    signal?.throwIfAborted();
    emit('engine', 'validation');
    const components = {
      engine: { ...(engine.source === 'managed' ? prepared.engine : {}), ...engine },
      uv: { ...(state.components.uv.source === 'managed' ? prepared.uv : {}), ...state.components.uv },
      python: { path: python, source: runtimeEnv.PRIME_AGENT_KERNEL_PYTHON ? 'explicit' : 'managed' },
      npm: prepared.npm,
    };
    let shellValidated = false;
    if (engine.bash)
      try {
        shellValidated =
          (await (deps.execute || execute)(
            engine.bash,
            ['--noprofile', '--norc', '-c', 'printf studio-shell-ok'],
            runtimeEnv,
            10000,
            signal,
          )) === 'studio-shell-ok';
      } catch {
        /* Retain prepared components, but keep shell setup visibly incomplete. */
      }
    signal?.throwIfAborted();
    await atomicJson(join(base, 'installation.json'), {
      schema: 1,
      validatedAt: new Date().toISOString(),
      shellValidated,
      components,
    });
    return await diagnoseComponents({ dataRoot, env, signal }, deps);
  } catch (error) {
    const code = signal?.aborted ? 'cancelled' : componentError(error);
    emit(component, 'error', { error: code });
    throw Object.assign(new Error(code, { cause: error }), { component });
  } finally {
    await release();
  }
}

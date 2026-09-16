import { readFile, mkdir, rename, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverCli, agentEnvironment } from './agent.mjs';
import { execute } from './kernel.mjs';
import { acquireLock } from '../scripts/launcher-common.mjs';

const PROBE = fileURLToPath(new URL('../scripts/component-probe.mjs', import.meta.url));

const COMPONENT_ENV_KEYS = {
  engine: 'PRIME_AGENT_CLI',
};

/** Launch-time overrides (desktop). Captured once before selection is merged into the child env. */
let launchComponentEnv;

function emptyToUndef(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Snapshot shell/desktop parent env before selection is applied. Safe to call repeatedly. */
export function captureComponentLaunchEnv(env = process.env) {
  if (launchComponentEnv) return launchComponentEnv;
  if (typeof env.PRIME_STUDIO_COMPONENT_LAUNCH === 'string' && env.PRIME_STUDIO_COMPONENT_LAUNCH) {
    try {
      const parsed = JSON.parse(env.PRIME_STUDIO_COMPONENT_LAUNCH);
      launchComponentEnv = {
        PRIME_AGENT_CLI: emptyToUndef(parsed.PRIME_AGENT_CLI),
      };
      return launchComponentEnv;
    } catch {
      /* fall through */
    }
  }
  if (!env.PRIME_STUDIO_DESKTOP_DATA_ROOT) return null;
  launchComponentEnv = {
    PRIME_AGENT_CLI: emptyToUndef(env.PRIME_AGENT_CLI),
  };
  return launchComponentEnv;
}

/** Test helper: drop the launch snapshot between cases. */
export function resetComponentLaunchEnv() {
  launchComponentEnv = undefined;
}

function clearLegacyPythonEnv(env) {
  delete env.PRIME_GUI_UV;
  delete process.env.PRIME_GUI_UV;
  // Clear Studio-sticky kernel python only when migrating old selection.python.
  delete env.PRIME_AGENT_KERNEL_PYTHON;
  delete process.env.PRIME_AGENT_KERNEL_PYTHON;
}

function clearComponentEnv(env, name) {
  if (name === 'uv' || name === 'python') {
    clearLegacyPythonEnv(env);
    return;
  }
  const key = COMPONENT_ENV_KEYS[name];
  if (!key) return;
  delete env[key];
  if (env !== process.env) delete process.env[key];
}
export function probeEnvironment(env = process.env) {
  const clean = {};
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR'])
    if (typeof env[key] === 'string' && env[key]) clean[key] = env[key];
  if (typeof env.PRIME_AGENT_CODING_AGENT_DIR === 'string' && env.PRIME_AGENT_CODING_AGENT_DIR)
    clean.PRIME_AGENT_CODING_AGENT_DIR = env.PRIME_AGENT_CODING_AGENT_DIR;
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
  if (!((major === 22 && minor >= 16) || major === 24)) throw new Error('node_incompatible');
}

/**
 * Shared root for engine/selection.json and installation.json.
 * Desktop: Tauri data root. Browser / make dev: KERNEL_ROOT or DATA_DIR.
 */
export function componentsDataRoot(env = process.env) {
  if (typeof env.PRIME_STUDIO_DESKTOP_DATA_ROOT === 'string' && env.PRIME_STUDIO_DESKTOP_DATA_ROOT)
    return resolve(env.PRIME_STUDIO_DESKTOP_DATA_ROOT);
  if (typeof env.PRIME_AGENT_GUI_KERNEL_ROOT === 'string' && env.PRIME_AGENT_GUI_KERNEL_ROOT)
    return resolve(env.PRIME_AGENT_GUI_KERNEL_ROOT);
  const dataDir = resolve(
    env.PRIME_AGENT_GUI_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '.local'),
  );
  if (dirname(dataDir) !== dataDir && /(?:^|[/\\])data$/i.test(dataDir)) return dirname(dataDir);
  return dataDir;
}

export function isComponentsActivated(manifest, resolved) {
  return Boolean(
    manifest?.validatedAt &&
      manifest.shellValidated === true &&
      resolved?.path &&
      resolved.path === manifest.components?.engine?.path,
  );
}

/**
 * Resolve Studio component env. Only Prime Agent is managed; Prime Agent bootstraps its own
 * Python kernel. Legacy uv/python selection keys are ignored and cleared on diagnose.
 */
export async function selectedEnvironment(dataRoot, env = process.env) {
  const root = resolve(dataRoot);
  const manifest = await json(join(root, 'engine/installation.json'));
  const selection = await json(join(root, 'engine/selection.json'));
  const result = { ...env };
  const launch = captureComponentLaunchEnv(env);
  const saved = emptyToUndef(selection.engine);
  const managed = emptyToUndef(manifest.components?.engine?.path);
  if (launch) {
    if (launch.PRIME_AGENT_CLI) result.PRIME_AGENT_CLI = launch.PRIME_AGENT_CLI;
    else if (saved) result.PRIME_AGENT_CLI = saved;
    else if (managed) result.PRIME_AGENT_CLI = managed;
    else delete result.PRIME_AGENT_CLI;
  } else if (!result.PRIME_AGENT_CLI && (saved || managed)) {
    result.PRIME_AGENT_CLI = saved || managed;
  }
  // Studio no longer manages uv or a private kernel; drop Studio-injected keys only.
  delete result.PRIME_GUI_UV;
  delete result.UV_PYTHON_INSTALL_DIR;
  delete result.UV_CACHE_DIR;
  delete result.UV_PYTHON_DOWNLOADS;
  delete result.UV_PYTHON_PREFERENCE;
  // Do not delete PRIME_AGENT_KERNEL_PYTHON — Prime Agent may use a user-supplied override.

  result.PRIME_AGENT_GUI_KERNEL_ROOT = root;
  if (env.PRIME_STUDIO_DESKTOP_DATA_ROOT || env.PRIME_STUDIO_COMPONENTS_REQUIRED === '1')
    result.PRIME_STUDIO_DESKTOP_DATA_ROOT = root;
  const resolved = discoverCli(result.PRIME_AGENT_CLI || null, result);
  const activated = isComponentsActivated(manifest, resolved);
  result.PRIME_STUDIO_COMPONENTS_REQUIRED = activated
    ? '0'
    : env.PRIME_STUDIO_DESKTOP_DATA_ROOT || env.PRIME_STUDIO_COMPONENTS_REQUIRED === '1'
      ? '1'
      : '0';
  return result;
}

export async function inspectEngineStatic(path, env = process.env) {
  const cli = discoverCli(path, env);
  if (!cli?.packageDir || !cli.node || cli.path !== join(cli.packageDir, 'dist/bundle/cli.js'))
    throw new Error('engine_incompatible');
  const pkg = await json(join(cli.packageDir, 'package.json'));
  if (pkg.name !== 'prime-agent') throw new Error('engine_incompatible');
  return { cli, pkg };
}

export async function validateEngine(path, env, signal) {
  const { cli } = await inspectEngineStatic(path, env);
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
  };
}

/** Parse structured probe stderr (`{ error, check, detail }`) out of execute() wrappers. */
export function parseProbeFailure(message = '') {
  const text = String(message);
  const start = text.lastIndexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (parsed && typeof parsed.error === 'string' && /^[a-z_]+$/.test(parsed.error)) {
        return {
          error: parsed.error,
          check: typeof parsed.check === 'string' ? parsed.check : undefined,
          detail: typeof parsed.detail === 'string' ? parsed.detail.slice(0, 2000) : undefined,
        };
      }
    } catch {
      /* fall through to legacy plain-token detection */
    }
  }
  if (/\bengine_incompatible\b/.test(text)) return { error: 'engine_incompatible' };
  return null;
}

/**
 * Classify a component validation failure into a stable UI code plus optional detail.
 * Preserves probe codes (e.g. engine_incompatible) even when execute() wraps stderr.
 */
export function classifyComponentError(error) {
  const detail = `${error?.code || ''} ${error?.message || ''}`;
  if (/ENOSPC|not enough space/i.test(detail)) return { code: 'disk_full' };
  if (/EACCES|EPERM|permission denied/i.test(detail)) return { code: 'write_denied' };
  if (error?.name === 'AbortError') return { code: 'cancelled' };
  if (error?.name === 'TimeoutError') return { code: 'validation_failed' };
  const probe = parseProbeFailure(error?.message || '');
  if (probe) {
    const parts = [probe.check, probe.detail].filter(Boolean);
    return { code: probe.error, detail: parts.length ? parts.join(': ').slice(0, 2000) : undefined };
  }
  if (/^[a-z_]+$/.test(error?.message || '')) return { code: error.message };
  return { code: 'validation_failed', detail: String(error?.message || '').slice(0, 2000) || undefined };
}

/** @deprecated Prefer classifyComponentError; kept for call sites that only need the code. */
export const componentError = (error) => classifyComponentError(error).code;

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

async function nvmPrimeAgentDirs() {
  const root = join(homedir(), '.nvm/versions/node');
  if (!existsSync(root)) return [];
  try {
    const names = await readdir(root);
    return names.flatMap((entry) => [
      join(root, entry, 'lib/node_modules/prime-agent'),
      join(root, entry, 'bin/prime-agent'),
    ]);
  } catch {
    return [];
  }
}

export async function listEngineCandidates(dataRoot, env = process.env, cached = {}) {
  const nvm = await nvmPrimeAgentDirs();
  return uniquePaths([
    env.PRIME_AGENT_CLI,
    ...discoverCli(null, env, { all: true }).map((cli) => cli.packageDir || cli.path),
    ...nvm,
    cached.engine?.path,
  ]).filter(Boolean);
}

export async function listCandidates({ dataRoot, env = process.env } = {}) {
  const root = resolve(dataRoot || componentsDataRoot(env));
  const cached = await json(join(root, 'engine/prepared.json'));
  const selected = await selectedEnvironment(root, env);
  return {
    engine: await listEngineCandidates(root, selected, cached),
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
      current.components?.engine?.path !== result.components.engine.path
    )
      await atomicJson(join(base, 'installation.json'), {
        schema: 1,
        validatedAt: new Date().toISOString(),
        shellValidated: true,
        components: {
          node: result.components.node,
          engine: result.components.engine,
          bash: result.components.bash,
        },
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
    // Drop legacy Studio-managed slots.
    delete next.uv;
    delete next.python;
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'uv' || key === 'python') {
        delete next[key];
        continue;
      }
      if (value === null || value === '') delete next[key];
      else if (typeof value === 'string' && key === 'engine') {
        const resolved = discoverCli(value);
        next[key] = resolved?.packageDir || value;
      }
    }
    await atomicJson(join(base, 'selection.json'), next);
    return next;
  } finally {
    await release();
  }
}

async function softDiscoverPatch({ root, env, selection, only, deps, signal }) {
  const cached = await json(join(root, 'engine/prepared.json'));
  const patch = {};
  if (only && only !== 'engine') return patch;
  if (env.PRIME_AGENT_CLI || (selection.engine && !only)) return patch;
  for (const candidate of await listEngineCandidates(root, env, cached)) {
    try {
      await (deps.validateEngine || validateEngine)(candidate, agentEnvironment({ env }), signal);
      patch.engine = candidate;
      break;
    } catch {
      /* try next */
    }
  }
  return patch;
}

/** Clear the engine path, rediscover it, diagnose, and activate when ready. */
export async function resetComponent(
  { dataRoot, component, env = process.env, signal },
  deps = {},
) {
  if (component !== 'engine') throw new Error('selection_invalid');
  const root = resolve(dataRoot);
  clearComponentEnv(env, component);
  await persistSelection(root, { engine: null, uv: null, python: null });
  const selection = await json(join(root, 'engine/selection.json'));
  const patch = await softDiscoverPatch({
    root,
    env,
    selection,
    only: 'engine',
    deps,
    signal,
  });
  if (patch.engine) await persistSelection(root, patch);
  return applySelection({ dataRoot: root, env, signal }, deps);
}

/** Apply path selection, diagnose, and activate when ready. */
export async function applySelection(
  { dataRoot, env = process.env, signal, paths = {}, discover = false },
  deps = {},
) {
  const root = resolve(dataRoot);
  if (discover) {
    const selection = await json(join(root, 'engine/selection.json'));
    const patch = await softDiscoverPatch({ root, env, selection, deps, signal });
    if (Object.keys(patch).length) await persistSelection(root, patch);
  }
  const hasPaths = 'engine' in paths || 'uv' in paths || 'python' in paths;
  if (hasPaths) {
    const patch = { uv: null, python: null };
    if ('engine' in paths) {
      const value = paths.engine;
      if (value !== null && value !== undefined && typeof value !== 'string')
        throw new Error('selection_invalid');
      patch.engine = value;
      if (value === null || value === '') clearComponentEnv(env, 'engine');
    }
    clearComponentEnv(env, 'uv');
    await persistSelection(root, patch);
  }
  let result = await diagnoseComponents(
    { dataRoot: root, env, signal, autoDiscover: !hasPaths && !discover },
    deps,
  );
  if (result.ready) result = (await activateComponents({ dataRoot: root, result, env })) || result;
  result.selection = await json(join(root, 'engine/selection.json'));
  result.candidates = await listCandidates({
    dataRoot: root,
    env: await selectedEnvironment(root, env),
  });
  return result;
}

export async function diagnoseComponents(
  { dataRoot, env = process.env, signal, autoDiscover = false },
  deps = {},
) {
  const root = resolve(dataRoot);
  let selection = await json(join(root, 'engine/selection.json'));
  // Migrate away from Studio-managed uv/python selections.
  // Migrate away from Studio-managed uv/python selections (Prime Agent owns its kernel).
  if (selection.uv || selection.python) {
    delete env.PRIME_GUI_UV;
    delete process.env.PRIME_GUI_UV;
    if (selection.python) {
      delete env.PRIME_AGENT_KERNEL_PYTHON;
      delete process.env.PRIME_AGENT_KERNEL_PYTHON;
    }
    selection = await persistSelection(root, { uv: null, python: null });
  }
  if (autoDiscover) {
    const patch = await softDiscoverPatch({ root, env, selection, deps, signal });
    if (Object.keys(patch).length) selection = await persistSelection(root, patch);
  }
  const selected = await selectedEnvironment(root, env);
  const runtimeEnv = agentEnvironment({ env: selected });
  const result = { components: {}, ready: false, dataRoot: root };
  try {
    (deps.checkNode || checkNode)();
    result.components.node = { status: 'ready', version: process.versions.node };
  } catch (e) {
    const classified = classifyComponentError(e);
    result.components.node = { status: 'error', error: classified.code, detail: classified.detail };
    return result;
  }

  const explicit = env.PRIME_AGENT_CLI || selection.engine;
  result.components.engine = { status: 'error', error: 'missing', explicit: Boolean(explicit) };
  if (selected.PRIME_AGENT_CLI) {
    try {
      const validated = await (deps.validateEngine || validateEngine)(
        selected.PRIME_AGENT_CLI,
        runtimeEnv,
        signal,
      );
      result.components.engine = {
        ...validated,
        status: 'ready',
        source: explicit ? 'explicit' : 'external',
      };
    } catch (e) {
      const classified = classifyComponentError(e);
      if (classified.detail) {
        console.error(`[components] engine ${classified.code}: ${classified.detail}`);
      } else {
        console.error(`[components] engine ${classified.code}`);
      }
      result.components.engine = {
        status: 'error',
        error: classified.code,
        detail: classified.detail,
        explicit: Boolean(explicit),
      };
    }
  }

  const engine = result.components.engine;
  if (engine.status === 'ready') {
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
  }

  result.ready =
    ['engine', 'bash'].every((key) => result.components[key]?.status === 'ready') &&
    !Object.values(result.components).some((c) => c.explicit && c.status === 'error');
  result.selection = selection;
  return result;
}

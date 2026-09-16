import { readFile, mkdir, rename, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverCli, agentEnvironment } from './agent.mjs';
import { ensureLocalKernel, execute } from './kernel.mjs';
import { acquireLock } from '../scripts/launcher-common.mjs';

const PROBE = fileURLToPath(new URL('../scripts/component-probe.mjs', import.meta.url));

const COMPONENT_ENV_KEYS = {
  engine: 'PRIME_AGENT_CLI',
  uv: 'PRIME_GUI_UV',
  python: 'PRIME_AGENT_KERNEL_PYTHON',
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
        PRIME_GUI_UV: emptyToUndef(parsed.PRIME_GUI_UV),
        PRIME_AGENT_KERNEL_PYTHON: emptyToUndef(parsed.PRIME_AGENT_KERNEL_PYTHON),
      };
      return launchComponentEnv;
    } catch {
      /* fall through */
    }
  }
  if (!env.PRIME_STUDIO_DESKTOP_DATA_ROOT) return null;
  launchComponentEnv = {
    PRIME_AGENT_CLI: emptyToUndef(env.PRIME_AGENT_CLI),
    PRIME_GUI_UV: emptyToUndef(env.PRIME_GUI_UV),
    PRIME_AGENT_KERNEL_PYTHON: emptyToUndef(env.PRIME_AGENT_KERNEL_PYTHON),
  };
  return launchComponentEnv;
}

/** Test helper: drop the launch snapshot between cases. */
export function resetComponentLaunchEnv() {
  launchComponentEnv = undefined;
}

function clearComponentEnv(env, name) {
  const key = COMPONENT_ENV_KEYS[name];
  if (!key) return;
  delete env[key];
  if (env !== process.env) delete process.env[key];
}

/** Minimal non-secret env for capability probes. */
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
  const launch = captureComponentLaunchEnv(env);
  for (const [key, name] of [
    ['PRIME_AGENT_CLI', 'engine'],
    ['PRIME_GUI_UV', 'uv'],
    ['PRIME_AGENT_KERNEL_PYTHON', 'python'],
  ]) {
    const saved = emptyToUndef(selection[name]);
    const managed = name === 'python' ? undefined : emptyToUndef(manifest.components?.[name]?.path);
    if (launch) {
      // Desktop: launch shell overrides win, then selection, then managed; otherwise clear
      // sticky values left in process.env from an earlier selection sync.
      if (launch[key]) result[key] = launch[key];
      else if (saved) result[key] = saved;
      else if (managed) result[key] = managed;
      else delete result[key];
    } else if (!result[key] && (saved || managed)) {
      result[key] = saved || managed;
    }
  }
  result.PRIME_AGENT_GUI_KERNEL_ROOT = root;
  if (env.PRIME_STUDIO_DESKTOP_DATA_ROOT || env.PRIME_STUDIO_COMPONENTS_REQUIRED === '1')
    result.PRIME_STUDIO_DESKTOP_DATA_ROOT = root;
  const resolved = discoverCli(result.PRIME_AGENT_CLI || null, result);
  const externalPython = expandUserPath(result.PRIME_AGENT_KERNEL_PYTHON);
  const activated = isComponentsActivated(manifest, resolved, externalPython);
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

/** Capability-only: accept ELF or pyenv/shell shims when `uv --version` works. */
export async function validateUv(path, env, signal) {
  const output = await execute(path, ['--version'], probeEnvironment(env), 10000, signal);
  const version = output.match(/^uv (\d+\.\d+\.\d+)/)?.[1];
  if (!version) throw new Error('uv_incompatible');
  return { path, version };
}

const componentError = (error) => {
  const detail = `${error.code || ''} ${error.message || ''}`;
  if (/ENOSPC|not enough space/i.test(detail)) return 'disk_full';
  if (/EACCES|EPERM|permission denied/i.test(detail)) return 'write_denied';
  if (error.name === 'AbortError') return 'cancelled';
  if (error.name === 'TimeoutError') return 'validation_failed';
  // External PRIME_AGENT_KERNEL_PYTHON must already include the Studio runtime.
  if (
    /python_unprepared|agent_message|ModuleNotFoundError|verification_du_python|fonction essentielle|Python verification|essential function/i.test(
      detail,
    )
  )
    return 'python_unprepared';
  if (/^[a-z_]+$/.test(error.message || '')) return error.message;
  return 'validation_failed';
};
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

async function pyenvVersionBins(name) {
  const versions = join(homedir(), '.pyenv/versions');
  if (!existsSync(versions)) return [];
  try {
    const names = await readdir(versions);
    return names.map((entry) => join(versions, entry, 'bin', name));
  } catch {
    return [];
  }
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

export async function listUvCandidates(dataRoot, env = process.env, cached = {}) {
  const pyenvBins = await pyenvVersionBins('uv');
  return uniquePaths([
    env.PRIME_GUI_UV,
    join(homedir(), '.local/bin/uv'),
    join(homedir(), '.cargo/bin/uv'),
    join(homedir(), '.pyenv/shims/uv'),
    ...pyenvBins,
    ...(env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .map((p) => join(p, 'uv')),
    cached.uv?.path,
  ]).filter((path) => path && existsSync(path));
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

export async function listPythonCandidates(env = process.env) {
  const pyenvBins = [
    ...(await pyenvVersionBins('python')),
    ...(await pyenvVersionBins('python3')),
    ...(await pyenvVersionBins('python3.11')),
  ];
  return uniquePaths([
    env.PRIME_AGENT_KERNEL_PYTHON,
    join(homedir(), '.local/bin/python3.11'),
    join(homedir(), '.local/bin/python3'),
    join(homedir(), '.local/bin/python'),
    join(homedir(), '.pyenv/shims/python'),
    join(homedir(), '.pyenv/shims/python3'),
    join(homedir(), '.pyenv/shims/python3.11'),
    '/usr/bin/python3.11',
    '/usr/bin/python3',
    '/usr/bin/python',
    ...pyenvBins,
    ...(env.PATH || '')
      .split(delimiter)
      .filter(Boolean)
      .flatMap((p) => [join(p, 'python3.11'), join(p, 'python3'), join(p, 'python')]),
  ]).filter((path) => path && existsSync(path));
}

export async function listCandidates({ dataRoot, env = process.env } = {}) {
  const root = resolve(dataRoot || componentsDataRoot(env));
  const cached = await json(join(root, 'engine/prepared.json'));
  const selected = await selectedEnvironment(root, env);
  return {
    engine: await listEngineCandidates(root, selected, cached),
    uv: await listUvCandidates(root, selected, cached),
    python: await listPythonCandidates(selected),
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
        } else next[key] = value;
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
  const tools = only ? [only] : ['engine', 'uv', 'python'];
  for (const tool of tools) {
    if (tool === 'engine') {
      if (env.PRIME_AGENT_CLI || (selection.engine && !only)) continue;
      for (const candidate of await listEngineCandidates(root, env, cached)) {
        try {
          await (deps.validateEngine || validateEngine)(candidate, agentEnvironment({ env }), signal);
          patch.engine = candidate;
          break;
        } catch {
          /* try next */
        }
      }
    } else if (tool === 'uv') {
      if (env.PRIME_GUI_UV || (selection.uv && !only)) continue;
      for (const candidate of await listUvCandidates(root, env, cached)) {
        try {
          await (deps.validateUv || validateUv)(candidate, agentEnvironment({ env }), signal);
          patch.uv = candidate;
          break;
        } catch {
          /* try next */
        }
      }
    } else if (tool === 'python') {
      if (env.PRIME_AGENT_KERNEL_PYTHON || (selection.python && !only)) continue;
      // Never soft-fill: a PATH/pyenv shim is not a prepared Studio kernel.
      // Leave empty so diagnose/applySelection can build a managed venv via uv.
      continue;
    }
  }
  return patch;
}

/** Clear one tool, rediscover it, diagnose, and activate when ready. */
export async function resetComponent(
  { dataRoot, component, env = process.env, signal },
  deps = {},
) {
  if (!['engine', 'uv', 'python'].includes(component)) throw new Error('selection_invalid');
  const root = resolve(dataRoot);
  clearComponentEnv(env, component);
  await persistSelection(root, { [component]: null });
  const selection = await json(join(root, 'engine/selection.json'));
  const patch = await softDiscoverPatch({
    root,
    env,
    selection,
    only: component,
    deps,
    signal,
  });
  if (patch[component]) await persistSelection(root, patch);
  else if (component === 'python') await persistSelection(root, { python: null });
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
  const hasPaths = ['engine', 'uv', 'python'].some((key) => key in paths);
  if (hasPaths) {
    const patch = {};
    for (const key of ['engine', 'uv', 'python']) {
      if (!(key in paths)) continue;
      const value = paths[key];
      if (value !== null && value !== undefined && typeof value !== 'string')
        throw new Error('selection_invalid');
      patch[key] = value;
      // Clearing a UI path must drop sticky process.env values from earlier syncs.
      if (value === null || value === '') clearComponentEnv(env, key);
    }
    await persistSelection(root, patch);
  }
  let result = await diagnoseComponents(
    { dataRoot: root, env, signal, autoDiscover: !hasPaths && !discover },
    deps,
  );
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
  const launch = captureComponentLaunchEnv(env);
  // Python comes from uv (or a launch-time PRIME_AGENT_KERNEL_PYTHON override) — never from UI selection.
  if (selection.python || (!launch?.PRIME_AGENT_KERNEL_PYTHON && env.PRIME_AGENT_KERNEL_PYTHON)) {
    clearComponentEnv(env, 'python');
    if (selection.python) selection = await persistSelection(root, { python: null });
  }
  if (autoDiscover) {
    const patch = await softDiscoverPatch({ root, env, selection, deps, signal });
    if (Object.keys(patch).length) selection = await persistSelection(root, patch);
  }
  const selected = await selectedEnvironment(root, env);
  const home = selected.PRIME_AGENT_CODING_AGENT_DIR || join(homedir(), '.prime/agent');
  const runtimeEnv = agentEnvironment({ env: selected });
  const result = { components: {}, ready: false, dataRoot: root };
  try {
    (deps.checkNode || checkNode)();
    result.components.node = { status: 'ready', version: process.versions.node };
  } catch (e) {
    result.components.node = { status: 'error', error: componentError(e) };
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
      result.components.engine = {
        status: 'error',
        error: componentError(e),
        explicit: Boolean(explicit),
      };
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
  result.components.uv = { status: uvRequired || uvExplicit ? 'missing' : 'not_required' };
  if ((uvRequired || uvExplicit) && selected.PRIME_GUI_UV) {
    try {
      const validated = await (deps.validateUv || validateUv)(
        selected.PRIME_GUI_UV,
        runtimeEnv,
        signal,
      );
      result.components.uv = {
        ...validated,
        status: 'ready',
        source: uvExplicit ? 'explicit' : 'external',
      };
    } catch (e) {
      if (uvExplicit)
        result.components.uv = { status: 'error', explicit: true, error: componentError(e) };
    }
  }

  result.ready =
    ['engine', 'python', 'bash'].every((key) => result.components[key]?.status === 'ready') &&
    !Object.values(result.components).some((c) => c.explicit && c.status === 'error');
  result.selection = selection;
  return result;
}

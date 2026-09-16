import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  selectedEnvironment,
  diagnoseComponents,
  applySelection,
  resetComponent,
  listUvCandidates,
  listPythonCandidates,
  componentsDataRoot,
  atomicJson,
  checkNode,
  inspectEngineStatic,
  resetComponentLaunchEnv,
  captureComponentLaunchEnv,
} from '../lib/desktop-components.mjs';

async function fixture(t) {
  resetComponentLaunchEnv();
  const root = await mkdtemp(join(tmpdir(), 'studio-components-'));
  t.after(async () => {
    resetComponentLaunchEnv();
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 4 });
  });
  return root;
}

test('unsupported architectures and Node lines fail closed', () => {
  checkNode('24.19.0', 'linux', 'x64');
  checkNode('22.16.0', 'linux', 'x64');
  for (const args of [
    ['24.19.0', 'win32', 'x64'],
    ['24.19.0', 'linux', 'arm64'],
    ['24.19.0', 'darwin', 'x64'],
    ['20.6.0', 'linux', 'x64'],
    ['26.0.0', 'linux', 'x64'],
  ])
    assert.throws(() => checkNode(...args));
});

test('explicit environment beats saved selection, which beats the managed manifest; no PATH mutation', async (t) => {
  const root = await fixture(t);
  await atomicJson(join(root, 'engine/installation.json'), {
    components: { engine: { path: 'managed' }, uv: { path: 'managed-uv' } },
  });
  await atomicJson(join(root, 'engine/selection.json'), { engine: 'saved', python: 'external-python' });
  const env = await selectedEnvironment(root, { PRIME_AGENT_CLI: 'explicit', PATH: 'unchanged' });
  assert.equal(env.PRIME_AGENT_CLI, 'explicit');
  assert.equal(env.PRIME_GUI_UV, 'managed-uv');
  assert.equal(env.PRIME_AGENT_KERNEL_PYTHON, 'external-python');
  assert.equal(env.PATH, 'unchanged');
  assert.equal((await selectedEnvironment(root, {})).PRIME_AGENT_CLI, 'saved');
});

test('desktop clears sticky python env when selection no longer sets it', async (t) => {
  const root = await fixture(t);
  await atomicJson(join(root, 'engine/selection.json'), {
    engine: '/engine',
    uv: '/uv',
  });
  // Capture launch before the sticky value exists (shell had no override).
  captureComponentLaunchEnv({ PRIME_STUDIO_DESKTOP_DATA_ROOT: root });
  const selected = await selectedEnvironment(root, {
    PRIME_STUDIO_DESKTOP_DATA_ROOT: root,
    PRIME_AGENT_KERNEL_PYTHON: '/home/user/.pyenv/shims/python',
  });
  assert.equal(selected.PRIME_AGENT_KERNEL_PYTHON, undefined);
});

test('invalid explicit CLI is reported and never replaced', async (t) => {
  const dataRoot = await fixture(t);
  const deps = {
    validateEngine: async () => {
      throw new Error('engine_incompatible');
    },
    validateUv: async () => ({ path: '/uv', version: '0.11.0' }),
    ensureKernel: async () => '/python',
    execute: async () => 'studio-shell-ok',
    checkNode: () => {},
  };
  await atomicJson(join(dataRoot, 'engine/selection.json'), { engine: '/bad-engine' });
  const result = await diagnoseComponents({ dataRoot, env: {} }, deps);
  assert.equal(result.components.engine.status, 'error');
  assert.equal(result.components.engine.explicit, true);
  assert.equal(result.ready, false);
});

test('componentsDataRoot prefers desktop data root then kernel root', () => {
  assert.equal(
    componentsDataRoot({ PRIME_STUDIO_DESKTOP_DATA_ROOT: '/desktop/root' }),
    resolve('/desktop/root'),
  );
  assert.equal(
    componentsDataRoot({ PRIME_AGENT_GUI_KERNEL_ROOT: '/kernel/root' }),
    resolve('/kernel/root'),
  );
});

test('external engine validation does not require a policy version string', async (t) => {
  const root = await fixture(t);
  const packageDir = join(root, 'prime-agent');
  await mkdir(join(packageDir, 'dist/bundle'), { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: 'prime-agent', version: '9.9.9', bin: { 'prime-agent': 'dist/bundle/cli.js' } }),
  );
  await writeFile(join(packageDir, 'dist/bundle/cli.js'), 'export {};\n');
  const inspected = await inspectEngineStatic(packageDir, {});
  assert.equal(inspected.pkg.version, '9.9.9');
});

test('applySelection soft-discovers empty slots and activates when ready', async (t) => {
  const dataRoot = await fixture(t);
  const deps = {
    validateEngine: async (path) => ({
      path: join(path, 'dist/bundle/cli.js'),
      packageDir: path,
      version: '0.9.4',
      bash: '/bin/bash',
    }),
    validateUv: async (path) => ({ path, version: '0.11.0' }),
    ensureKernel: async () => '/managed/python',
    execute: async () => 'studio-shell-ok',
    checkNode: () => {},
  };
  const result = await applySelection(
    { dataRoot, paths: { engine: '/found-engine', uv: '/found-uv' } },
    deps,
  );
  assert.equal(result.ready, true);
  assert.equal(result.components.engine.status, 'ready');
  assert.equal(result.selection.engine, '/found-engine');
  assert.equal(result.selection.uv, '/found-uv');
  assert.equal(result.components.engine.warning, undefined);
  assert.equal(result.components.uv.warning, undefined);
});

test('list candidates include bare python and pyenv-style paths when present', async (t) => {
  const root = await fixture(t);
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  const python = join(bin, 'python');
  await writeFile(python, '#!/bin/sh\necho ok\n');
  await chmod(python, 0o755);
  const listed = await listPythonCandidates({ PATH: bin });
  assert.ok(listed.includes(python));
});

test('uv shim that reports a version is accepted without ELF magic', async (t) => {
  const dataRoot = await fixture(t);
  const shim = join(dataRoot, 'uv-shim');
  await writeFile(shim, '#!/bin/sh\necho uv 0.11.6\n');
  await chmod(shim, 0o755);
  const deps = {
    validateEngine: async () => ({
      path: '/e/cli.js',
      packageDir: '/e',
      version: '0.9.4',
      bash: '/bin/bash',
    }),
    validateUv: async (path) => {
      if (path !== shim) throw new Error('uv_incompatible');
      return { path, version: '0.11.6' };
    },
    ensureKernel: async () => '/py',
    execute: async () => 'studio-shell-ok',
    checkNode: () => {},
  };
  const result = await applySelection({ dataRoot, paths: { engine: '/e', uv: shim } }, deps);
  assert.equal(result.components.uv.status, 'ready');
  assert.equal(result.components.uv.path, shim);
});

test('resetComponent clears one tool and rediscovers it', async (t) => {
  const dataRoot = await fixture(t);
  const uvBin = join(dataRoot, 'uv');
  await writeFile(uvBin, '#!/bin/sh\necho uv 0.11.6\n');
  await chmod(uvBin, 0o755);
  await atomicJson(join(dataRoot, 'engine/selection.json'), {
    engine: '/old-engine',
    uv: '/stale-uv',
  });
  const deps = {
    validateEngine: async (path) => ({
      path: join(path, 'cli.js'),
      packageDir: path,
      version: '1.0.0',
      bash: '/bin/bash',
    }),
    validateUv: async (path) => {
      if (path === uvBin) return { path, version: '0.11.6' };
      throw new Error('uv_incompatible');
    },
    ensureKernel: async () => '/py',
    execute: async () => 'studio-shell-ok',
    checkNode: () => {},
  };
  const env = { PATH: dataRoot };
  const result = await resetComponent({ dataRoot, component: 'uv', env }, deps);
  assert.equal(result.selection.uv, uvBin);
  assert.equal(result.selection.engine, '/old-engine');
});

test('resetting python clears the field and does not soft-fill a bare interpreter', async (t) => {
  const dataRoot = await fixture(t);
  const bin = join(dataRoot, 'bin');
  await mkdir(bin, { recursive: true });
  const python = join(bin, 'python');
  await writeFile(python, '#!/bin/sh\necho bare\n');
  await chmod(python, 0o755);
  await atomicJson(join(dataRoot, 'engine/selection.json'), {
    engine: '/engine',
    uv: '/uv',
    python,
  });
  const deps = {
    validateEngine: async (path) => ({
      path: join(path, 'cli.js'),
      packageDir: path,
      version: '1.0.0',
      bash: '/bin/bash',
    }),
    validateUv: async (path) => ({ path, version: '0.11.6' }),
    ensureKernel: async ({ env }) => {
      if (env.PRIME_AGENT_KERNEL_PYTHON) throw new Error('ModuleNotFoundError: No module named agent_message');
      return '/managed/python';
    },
    execute: async () => 'studio-shell-ok',
    checkNode: () => {},
  };
  const result = await resetComponent(
    { dataRoot, component: 'python', env: { PATH: bin, HOME: dataRoot } },
    deps,
  );
  assert.equal(result.selection.python, undefined);
  assert.notEqual(result.components.python?.error, 'python_unprepared');
});

test('bare external python is reported as python_unprepared', async (t) => {
  const dataRoot = await fixture(t);
  await atomicJson(join(dataRoot, 'engine/selection.json'), {
    engine: '/engine',
    uv: '/uv',
    python: '/bare/python',
  });
  const deps = {
    validateEngine: async (path) => ({
      path: join(path, 'cli.js'),
      packageDir: path,
      version: '1.0.0',
      bash: '/bin/bash',
    }),
    validateUv: async (path) => ({ path, version: '0.11.6' }),
    ensureKernel: async () => {
      throw new Error('ModuleNotFoundError: No module named agent_message');
    },
    execute: async () => 'studio-shell-ok',
    checkNode: () => {},
  };
  const result = await applySelection({ dataRoot, paths: {} }, deps);
  assert.equal(result.components.python.status, 'error');
  assert.equal(result.components.python.error, 'python_unprepared');
});

test('listUvCandidates returns PATH hits that exist', async (t) => {
  const root = await fixture(t);
  const uv = join(root, 'uv');
  await writeFile(uv, 'x');
  const listed = await listUvCandidates(root, { PATH: root });
  assert.ok(listed.includes(uv));
});

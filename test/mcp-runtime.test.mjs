import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createMcpService } from '../lib/mcp-service.mjs';
import { mcpRevision } from '../lib/mcp-config.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'prime-mcp-runtime é espaces-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const kernelRoot = join(root, 'persistent-app-data'),
    agentHome = join(root, 'agent-home'),
    packageDir = join(root, 'packaged-prime-agent'),
    calls = [];
  let config = { type: 'stdio', command: 'fixture-mcp', enabled: true };
  const store = {
    async get(name) {
      assert.equal(name, 'Unity_MCP_Vtrott');
      return { config: structuredClone(config) };
    },
  };
  async function pythonFile(path) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'fixture executable, never launched');
    return path;
  }
  async function ready(generation = 'generation-1', selectedRoot = kernelRoot) {
    const python = await pythonFile(
      join(
        selectedRoot,
        '.local/kernel-venv',
        generation,
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    );
    await writeFile(join(selectedRoot, '.local/kernel-ready.json'), JSON.stringify({ schema: 2, python }));
    return python;
  }
  const options = {
    agentHome,
    environment: { PRIME_AGENT_GUI_KERNEL_ROOT: kernelRoot },
    store,
    spawnProcess(command, args, spawnOptions) {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = (source) => {
        calls.push({ command, args, options: spawnOptions, payload: JSON.parse(source) });
        queueMicrotask(() => {
          child.stdout.emit('data', JSON.stringify({ tools: [{ name: 'get_scene' }], total: 1 }));
          child.exitCode = 0;
          child.emit('close', 0);
        });
      };
      return child;
    },
  };
  const service = (overrides = {}) => {
    const result = createMcpService({ ...options, ...overrides });
    t.after(() => result.close());
    return result;
  };
  return {
    root,
    kernelRoot,
    agentHome,
    packageDir,
    calls,
    options,
    service,
    ready,
    pythonFile,
    request: () => ({ name: 'Unity_MCP_Vtrott', revision: mcpRevision(config) }),
    change: (values) => {
      config = { ...config, ...values };
    },
  };
}

test('MCP probes use the packaged application persistent runtime instead of the source directory', async (t) => {
  const f = await fixture(t),
    python = await f.ready(),
    service = f.service();
  const result = await service.probe(f.request());
  assert.equal(result.total, 1);
  assert.deepEqual(result.tools, [{ name: 'get_scene' }]);
  assert.equal(f.calls[0].payload.python, python);
  assert.equal(f.calls[0].payload.agentHome, f.agentHome);
  assert.equal(f.calls[0].options.env.PRIME_AGENT_CODING_AGENT_DIR, f.agentHome);
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.calls[0].options.detached, true);
});

test('MCP resolves the validated runtime when probing, including after a later generation is prepared', async (t) => {
  const f = await fixture(t),
    service = f.service();
  const first = await f.ready('first-generation');
  await service.probe(f.request());
  const second = await f.ready('second-generation');
  await service.probe(f.request());
  assert.deepEqual(
    f.calls.map((call) => call.payload.python),
    [first, second],
  );
});

test('an explicit kernel root wins over the environment root', async (t) => {
  const f = await fixture(t),
    root = join(f.root, 'selected-runtime'),
    python = await f.ready('selected-generation', root);
  const service = f.service({ kernelRoot: root });
  await service.probe(f.request());
  assert.equal(f.calls[0].payload.python, python);
});

test('MCP reuses a kernel marker when present without Studio uv prep', async (t) => {
  const f = await fixture(t);
  const python = await f.ready();
  const service = f.service();
  await service.probe(f.request());
  await service.probe(f.request());
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].payload.python, python);
});

test('without a kernel marker or PATH python, MCP probe fails closed', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f
      .service({
        environment: { ...f.options.environment, PATH: join(f.root, 'empty-bin') },
      })
      .probe(f.request()),
    { status: 503 },
  );
  assert.equal(f.calls.length, 0);
});

test('explicit Python selection remains authoritative over environment and marker', async (t) => {
  const f = await fixture(t),
    automatic = await f.ready(),
    explicit = await f.pythonFile(join(f.root, 'manual-python')),
    fromEnvironment = await f.pythonFile(join(f.root, 'environment-python'));
  const environment = { ...f.options.environment, PRIME_AGENT_KERNEL_PYTHON: fromEnvironment };
  await f.service({ environment }).probe(f.request());
  await f.service({ environment, python: explicit }).probe(f.request());
  assert.deepEqual(
    f.calls.map((call) => call.payload.python),
    [fromEnvironment, explicit],
  );
  assert.notEqual(automatic, explicit);
});

test('a missing explicit Python is reported without silently replacing the configured interpreter', async (t) => {
  const f = await fixture(t);
  await f.ready();
  await assert.rejects(f.service({ python: join(f.root, 'missing-python') }).probe(f.request()), {
    status: 503,
  });
  assert.equal(f.calls.length, 0);
});

test('a disabled MCP server does not launch a probe', async (t) => {
  const f = await fixture(t);
  f.change({ enabled: false });
  await assert.rejects(f.service().probe(f.request()), { status: 400 });
  assert.equal(f.calls.length, 0);
});

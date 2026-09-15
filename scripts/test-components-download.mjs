// Opt-in integration test. No production accounts, settings, tools or server are modified.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const resources = fileURLToPath(new URL('../.desktop-build/', import.meta.url));
if (process.argv[2] !== '--worker') {
  assert.equal(
    process.argv[2],
    '--download',
    'Explicit opt-in: node scripts/test-components-download.mjs --download',
  );
  const root = await mkdtemp(join(tmpdir(), 'studio installation réelle é '));
  const home = join(root, 'home');
  await mkdir(home);
  const env = {
    SystemRoot: process.env.SystemRoot,
    TEMP: join(root, 'tmp'),
    TMP: join(root, 'tmp'),
    USERPROFILE: home,
    HOME: home,
    APPDATA: join(home, 'Roaming'),
    LOCALAPPDATA: join(home, 'Local'),
    PATH: join(process.env.SystemRoot, 'System32'),
    PRIME_STUDIO_DESKTOP_DATA_ROOT: root,
    PRIME_AGENT_CODING_AGENT_DIR: join(home, '.prime/agent'),
    PRIME_AGENT_SESSION_DIR: join(home, 'sessions'),
  };
  await mkdir(env.TEMP);
  console.log(`Isolated test data retained at ${root}`);
  const child = spawn(join(resources, 'node'), [fileURLToPath(import.meta.url), '--worker', root], {
    // The native launcher runs from backend/, which has no package.json.
    // Running this test from the repository used to hide npm's implicit cwd input.
    cwd: resources,
    env,
    windowsHide: true,
    shell: false,
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  const root = process.argv[3];
  const { prepareComponents, diagnoseComponents, selectedEnvironment } = await import(
    pathToFileURL(join(resources, 'studio/lib/desktop-components.mjs'))
  );
  let last;
  const prepared = await prepareComponents({
    dataRoot: root,
    onProgress: (event) => {
      const stage = `${event.component}: ${event.stage}`;
      if (last !== stage) {
        console.log(stage);
        last = stage;
      }
    },
  });
  assert.equal(prepared.components.engine.status, 'ready');
  assert.equal(prepared.components.python.status, 'ready');
  assert.equal(prepared.components.engine.source, 'managed');
  assert.equal(prepared.components.uv.source, 'managed');
  const first = JSON.parse(await readFile(join(root, 'engine/installation.json')));
  const enginePackage = JSON.parse(await readFile(join(first.components.engine.packageDir, 'package.json')));
  assert.equal(enginePackage.dependencies?.['prime-agent-studio-nix'], undefined);
  const again = await prepareComponents(
    { dataRoot: root },
    {
      download() {
        throw new Error('A healthy installation must not download again');
      },
    },
  );
  assert.equal(again.components.python.path, first.components.python.path);
  assert.equal(again.components.engine.path, first.components.engine.path);
  const diagnosis = await diagnoseComponents({ dataRoot: root });
  assert.equal(diagnosis.ready, prepared.ready);
  const env = await selectedEnvironment(root);
  const { createApp } = await import(pathToFileURL(join(resources, 'studio/server.mjs')));
  const { createAgentRuntime } = await import(pathToFileURL(join(resources, 'studio/lib/agent.mjs')));
  const runtime = createAgentRuntime({
    cliPath: env.PRIME_AGENT_CLI,
    env,
    kernelRoot: root,
    agentHome: env.PRIME_AGENT_CODING_AGENT_DIR,
    sessionDir: env.PRIME_AGENT_SESSION_DIR,
  });
  const app = createApp({
    runtime,
    dataDir: join(root, 'data'),
    agentHome: env.PRIME_AGENT_CODING_AGENT_DIR,
  });
  await new Promise((done) => app.server.listen(0, '127.0.0.1', done));
  try {
    const version = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/version`)).json();
    assert.equal(version.available, true);
    assert.equal(version.version, first.components.engine.version);
    console.log(
      'PASS: verified downloads, bundled Node, private npm, Python imports, immutable reuse and /api/version.',
    );
    if (!diagnosis.ready)
      console.log('Git Bash is absent: setup correctly remains incomplete for shell commands.');
  } finally {
    await app.close();
  }
}

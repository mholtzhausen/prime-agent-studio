import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNativeInteractions } from '../lib/native-interactions.mjs';
import { transformStudioRpc } from '../runtime/studio-rpc-hook.mjs';
import { isPrimeAgentNpmBridge } from '../runtime/npm-bridge.mjs';
import { discoverCli } from '../lib/agent.mjs';
import { createProjectFiles } from '../lib/project-files.mjs';

const exec = promisify(execFile);

test('native answers are correlated, validated and only accepted once after acknowledgement', async () => {
  const events = [],
    commands = [];
  const bridge = createNativeInteractions({
    emit: (event) => events.push(event),
    send: (command) => commands.push(command),
  });
  bridge.consume({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'question' });
  bridge.consume({
    type: 'extension_ui_request',
    id: 'q1',
    method: 'select',
    title: 'Pick',
    options: ['A', 'B'],
  });
  const pending = bridge.respond('q1', { value: 'Custom answer' });
  assert.equal(events.at(-1).request.status, 'pending');
  await assert.rejects(bridge.respond('q1', { value: 'B' }));
  assert.deepEqual(commands, [{ type: 'extension_ui_response', id: 'q1', value: 'Custom answer' }]);
  bridge.consume({ type: 'tool_execution_end', toolCallId: 't1' });
  bridge.consume({ type: 'response', id: 'q1', command: 'extension_ui_response', success: true });
  assert.equal((await pending).status, 'answered');
  assert.equal(events.at(-1).request.answer, 'Custom answer');
  await assert.rejects(bridge.respond('q1', { value: 'B' }));
  bridge.close();
});

test('generic engine selects reject arbitrary answers; expired and cancelled tools cannot remain pending', async () => {
  const events = [];
  const bridge = createNativeInteractions({ emit: (event) => events.push(event), send() {} });
  bridge.consume({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'ipython' });
  bridge.consume({
    type: 'extension_ui_request',
    id: 'q1',
    method: 'select',
    title: 'Kernel busy',
    options: ['Wait', 'Kill'],
  });
  await assert.rejects(bridge.respond('q1', { value: 'Arbitrary' }), /invalide/);
  bridge.consume({ type: 'tool_execution_end', toolCallId: 't1' });
  assert.equal(events.at(-1).request.status, 'cancelled');
  await assert.rejects(bridge.respond('q1', { value: 'Wait' }));
  bridge.consume({ type: 'extension_ui_request', id: 'q2', method: 'input', title: 'Input' });
  const pending = bridge.respond('q2', { value: 'Text' });
  bridge.consume({ type: 'response', id: 'q2', command: 'extension_ui_response', success: false });
  await assert.rejects(pending);
  assert.equal(events.at(-1).request.status, 'interrupted');
  bridge.close();
});

test('RPC adapter matches actual packaged and source modules and fails on incompatible layouts', async () => {
  const cli = discoverCli();
  if (!cli?.packageDir) return;
  const root = cli.packageDir;
  let checked = 0;
  for (const path of [
    join(root, 'dist/modes/rpc/rpc-mode.js'),
    ...(await readdir(join(root, 'dist/bundle')))
      .filter((name) => name.endsWith('.js'))
      .map((name) => join(root, 'dist/bundle', name)),
  ]) {
    const source = await readFile(path, 'utf8');
    if (!source.includes('function runRpcModeWithConnectionInternal(')) continue;
    const adapted = transformStudioRpc(source);
    assert.equal(adapted.changed, true);
    assert.ok(adapted.source.includes('waitForRlmQuiescence: true'));
    assert.throws(() => transformStudioRpc(source.replaceAll('case "get_state": {', 'case "new_state": {')));
    checked++;
  }
  assert.ok(checked >= 2);
});

test('npm bridge detection only matches dist/bundle/cli.js', () => {
  assert.equal(isPrimeAgentNpmBridge('/opt/prime-agent/dist/bundle/cli.js'), true);
  assert.equal(isPrimeAgentNpmBridge('/opt/prime-agent/dist/bundle/cli-node.js'), false);
  assert.equal(isPrimeAgentNpmBridge('/opt/prime-agent/dist/modes/rpc/rpc-mode.js'), false);
});

test('studio-rpc loader keeps the role marker across cli.js → cli-node.js re-exec', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-studio-rpc-bridge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bridgeDir = join(root, 'dist/bundle');
  await mkdir(bridgeDir, { recursive: true });
  const bridge = join(bridgeDir, 'cli.js');
  const realEntry = join(bridgeDir, 'cli-node.js');
  await writeFile(
    bridge,
    `import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL('./cli-node.js', import.meta.url))], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
`,
  );
  await writeFile(
    realEntry,
    `console.log(JSON.stringify({
  marker: process.env.PRIME_GUI_CLI_ROOT ?? null,
  entry: process.argv[1],
}));
`,
  );
  const loader = new URL('../runtime/studio-rpc-loader.mjs', import.meta.url).href;
  const { stdout, stderr } = await exec(process.execPath, ['--import', loader, bridge], {
    env: { ...process.env, PRIME_GUI_CLI_ROOT: root },
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(stderr, '');
  const payload = JSON.parse(stdout);
  assert.equal(payload.marker, null, 'cli-node must consume and clear the marker');
  assert.match(payload.entry, /cli-node\.js$/);
});

test(
  'installed CLI accepts studio_wait_for_completion after the rpc loader',
  { skip: !discoverCli()?.node || !discoverCli()?.packageDir, timeout: 45000 },
  async (t) => {
    const { spawn } = await import('node:child_process');
    const { stat } = await import('node:fs/promises');
    const cli = discoverCli();
    const root = await mkdtemp(join(tmpdir(), 'prime-studio-wait-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });
    const socket = join(root, 'daemon.sock');
    const sessionDir = join(root, 'sessions');
    const project = join(root, 'project');
    await mkdir(sessionDir);
    await mkdir(project);
    await writeFile(join(project, 'README.md'), 'wait probe\n');
    const daemon = spawn(process.execPath, [cli.path, '--mode', 'daemon', '--daemon-socket', socket], {
      stdio: 'ignore',
      windowsHide: true,
    });
    t.after(() => {
      try {
        daemon.kill('SIGTERM');
      } catch {
        /* already exited */
      }
    });
    for (let i = 0; i < 50; i++) {
      try {
        await stat(socket);
        break;
      } catch {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
    }
    await stat(socket);
    const loader = new URL('../runtime/studio-rpc-loader.mjs', import.meta.url).href;
    const child = spawn(
      process.execPath,
      [
        '--import',
        loader,
        cli.path,
        '-p',
        '--mode',
        'rpc',
        '--cwd',
        project,
        '--session-dir',
        sessionDir,
        '--daemon-socket',
        socket,
        '--no-session',
      ],
      {
        env: { ...process.env, PRIME_GUI_CLI_ROOT: cli.packageDir, PRIME_GUI_SILENT: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.stdin.write(JSON.stringify({ type: 'get_state', id: 'studio-state' }) + '\n');
    child.stdin.write(JSON.stringify({ type: 'studio_wait_for_completion', id: 'studio-complete' }) + '\n');
    child.stdin.end();
    const code = await new Promise((resolvePromise, reject) => {
      child.on('error', reject);
      child.on('close', resolvePromise);
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('studio_wait probe timed out'));
      }, 30000).unref();
    });
    const out = Buffer.concat(stdout).toString('utf8');
    const err = Buffer.concat(stderr).toString('utf8');
    assert.equal(code, 0, err || out);
    assert.equal(err.includes('Unknown command: studio_wait_for_completion'), false, err);
    const lines = out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const complete = lines.find((line) => line.id === 'studio-complete');
    assert.equal(complete?.success, true, JSON.stringify(complete || lines));
    assert.equal(complete?.command, 'studio_wait_for_completion');
  },
);

test('referenced images read current project files, detect deletion and reject private/outside paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-images-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const cwd = join(root, 'project'),
    outside = join(root, 'private');
  await mkdir(cwd);
  await mkdir(outside);
  await mkdir(join(cwd, '.local'));
  const images = createProjectFiles({
    store: {
      findProject: async (value) => {
        assert.equal(value, cwd);
        return { cwd };
      },
    },
  });
  const file = join(cwd, 'résultat.png');
  await writeFile(file, 'first');
  assert.equal((await images.image(cwd, 'r%C3%A9sultat.png')).data.toString(), 'first');
  await writeFile(file, 'updated');
  assert.equal((await images.image(cwd, file)).data.toString(), 'updated');
  await rm(file);
  await assert.rejects(images.image(cwd, 'résultat.png'), (error) => error.status === 404);
  await writeFile(join(outside, 'secret.png'), 'private');
  await writeFile(join(cwd, '.local', 'secret.png'), 'private');
  await symlink(outside, join(cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const path of ['../private/secret.png', 'escape/secret.png', '.local/secret.png'])
    await assert.rejects(images.image(cwd, path), (error) => error.status === 403);
  await writeFile(join(cwd, 'unsafe.svg'), '<svg/>');
  await assert.rejects(images.image(cwd, 'unsafe.svg'), (error) => error.status === 415);
});

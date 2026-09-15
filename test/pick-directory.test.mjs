import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createDirectoryPicker } from '../lib/pick-directory.mjs';

function linuxPicker({ backend = 'zenity', run, resolveCommand } = {}) {
  const binaries = {
    zenity: '/usr/bin/zenity',
    kdialog: '/usr/bin/kdialog',
  };
  return createDirectoryPicker({
    platform: 'linux',
    detect: () => backend,
    resolve: resolveCommand || ((name) => binaries[name] || null),
    run,
  });
}

test('zenity passes title and initial directory as argv, not env, and validates the selected path', async () => {
  let launch;
  const picker = linuxPicker({
    run: async (...args) => {
      launch = args;
      return { stdout: `${tmpdir()}\n` };
    },
  });
  assert.deepEqual(await picker.pick({ cwd: tmpdir(), title: 'Choisir é & $dossier' }), {
    cwd: resolve(tmpdir()),
  });
  assert.equal(launch[0], '/usr/bin/zenity');
  assert.deepEqual(launch[1], [
    '--file-selection',
    '--directory',
    '--title=Choisir é & $dossier',
    `--filename=${resolve(tmpdir())}/`,
  ]);
  assert.equal(launch[2].shell, false);
  assert.equal(launch[2].env?.PRIME_STUDIO_PICK_DIRECTORY, undefined);
});

test('kdialog uses getexistingdirectory and treats exit code 1 as cancellation', async () => {
  let launches = 0;
  const picker = linuxPicker({
    backend: 'kdialog',
    run: async (command, args) => {
      launches++;
      assert.equal(command, '/usr/bin/kdialog');
      assert.equal(args[0], '--getexistingdirectory');
      assert.equal(args[2], 'Choisir');
      if (launches === 1) {
        const error = new Error('cancelled');
        error.code = 1;
        throw error;
      }
      return { stdout: tmpdir() };
    },
  });
  assert.deepEqual(await picker.pick({ title: 'Choisir' }), { cwd: null });
  assert.deepEqual(await picker.pick({ title: 'Choisir' }), { cwd: resolve(tmpdir()) });
});

test('missing picker backend and non-linux platforms fail closed with 501', async () => {
  await assert.rejects(
    createDirectoryPicker({ platform: 'linux', detect: () => null }).pick(),
    { status: 501 },
  );
  await assert.rejects(createDirectoryPicker({ platform: 'win32', detect: () => 'zenity' }).pick(), {
    status: 501,
  });
  assert.equal(createDirectoryPicker({ platform: 'linux', detect: () => 'zenity' }).available(), true);
  assert.equal(createDirectoryPicker({ platform: 'linux', detect: () => null }).available(), false);
  assert.equal(createDirectoryPicker({ platform: 'darwin', detect: () => 'zenity' }).available(), false);
});

test('helper failures become 502 while empty stdout is treated as no selection', async () => {
  let outcome = new Error('spawn failed');
  const picker = linuxPicker({
    run: async () => {
      if (outcome instanceof Error) throw outcome;
      return { stdout: outcome };
    },
  });
  await assert.rejects(picker.pick(), { status: 502 });
  outcome = '   \n';
  assert.deepEqual(await picker.pick(), { cwd: null });
  outcome = 'relative/path';
  await assert.rejects(picker.pick(), { status: 400 });
});

test('only one native picker opens at a time and shutdown aborts its helper', async () => {
  let started;
  const ready = new Promise((done) => {
    started = done;
  });
  const picker = linuxPicker({
    run: async (_cmd, _args, { signal }) => {
      started();
      return new Promise((_done, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    },
  });
  const result = picker.pick();
  const failed = assert.rejects(result, { status: 502 });
  await ready;
  await assert.rejects(picker.pick(), { status: 409 });
  picker.close();
  await failed;
});

test('an already cancelled request never starts a helper or prevents a later selection', async () => {
  let launches = 0;
  const picker = linuxPicker({
    run: async () => {
      launches++;
      return { stdout: tmpdir() };
    },
  });
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await picker.pick({ signal: controller.signal }), { cwd: null });
  assert.equal(launches, 0);
  assert.deepEqual(await picker.pick(), { cwd: resolve(tmpdir()) });
  assert.equal(launches, 1);
});

test('client cancellation aborts the active helper and releases the guard for an immediate retry', async () => {
  let helperSignal;
  let started;
  const ready = new Promise((done) => {
    started = done;
  });
  let launches = 0;
  const picker = linuxPicker({
    run: async (_cmd, _args, { signal }) => {
      launches++;
      if (launches > 1) return { stdout: tmpdir() };
      helperSignal = signal;
      started();
      return new Promise((_done, reject) =>
        signal.addEventListener('abort', () => reject(new Error('helper aborted')), { once: true }),
      );
    },
  });
  const client = new AbortController();
  const first = picker.pick({ signal: client.signal });
  await ready;
  assert.equal(helperSignal.aborted, false);
  await assert.rejects(picker.pick(), { status: 409 });
  client.abort();
  assert.deepEqual(await first, { cwd: null });
  assert.equal(helperSignal.aborted, true);
  assert.deepEqual(await picker.pick(), { cwd: resolve(tmpdir()) });
  assert.equal(launches, 2);
});

test('cancelling an earlier completed request does not abort a later helper', async () => {
  const calls = [];
  const picker = linuxPicker({
    run: async (_cmd, _args, { signal }) => {
      let complete;
      const result = new Promise((done, reject) => {
        complete = done;
        signal.addEventListener('abort', () => reject(new Error('helper aborted')), { once: true });
      });
      calls.push({ signal, complete });
      return result;
    },
  });
  const client = new AbortController();
  const first = picker.pick({ signal: client.signal });
  assert.equal(calls.length, 1);
  calls[0].complete({ stdout: '' });
  assert.deepEqual(await first, { cwd: null });
  const next = picker.pick();
  assert.equal(calls.length, 2);
  client.abort();
  assert.equal(calls[0].signal.aborted, false, 'Completed requests must detach the client abort listener');
  assert.equal(calls[1].signal.aborted, false);
  calls[1].complete({ stdout: tmpdir() });
  assert.deepEqual(await next, { cwd: resolve(tmpdir()) });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createDirectoryOpener } from '../lib/open-directory.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'prime-studio-folder-unit-'));
  const folder = join(root, "dossier é & [notes], l'atelier (1)");
  await mkdir(folder);
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  return { root, folder };
}

test('Linux opens through xdg-open with a literal Unicode path and no shell', async (t) => {
  const { folder } = await fixture(t);
  let launch;
  const open = createDirectoryOpener({
    platform: 'linux',
    run: async (...args) => {
      launch = args;
      return { stdout: '' };
    },
  });
  assert.deepEqual(await open(folder), { opened: true });
  const [command, args, options] = launch;
  assert.equal(command, 'xdg-open');
  assert.deepEqual(args, [folder]);
  assert.equal(options.shell, false);
  assert.ok(options.timeout > 0 && options.timeout <= 15000);
});

test('failed xdg-open launches never report success and non-linux platforms fail closed', async (t) => {
  const { folder } = await fixture(t);
  let fail = true;
  const open = createDirectoryOpener({
    platform: 'linux',
    run: async () => {
      if (fail) throw new Error('exit 1');
      return { stdout: '' };
    },
  });
  await assert.rejects(open(folder), { status: 502 });
  fail = false;
  assert.deepEqual(await open(folder), { opened: true });
  await assert.rejects(
    createDirectoryOpener({
      platform: 'win32',
      run: async () => ({ stdout: '' }),
    })(folder),
    { status: 502 },
  );
  await assert.rejects(
    createDirectoryOpener({
      platform: 'darwin',
      run: async () => ({ stdout: '' }),
    })(folder),
    { status: 502 },
  );
});

test('rapid requests for one folder share a launch and invalid folders never start a helper', async (t) => {
  const { root, folder } = await fixture(t);
  let complete,
    launches = 0;
  const open = createDirectoryOpener({
    platform: 'linux',
    run: () => {
      launches++;
      return new Promise((done) => {
        complete = done;
      });
    },
  });
  const jobs = [open(folder), open(folder), open(folder)];
  while (!complete) await new Promise((done) => setTimeout(done, 5));
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(launches, 1);
  complete({ stdout: '' });
  assert.deepEqual(await Promise.all(jobs), [{ opened: true }, { opened: true }, { opened: true }]);
  const file = join(root, 'not-a-folder.txt');
  await writeFile(file, 'fixture');
  for (const path of [file, join(root, 'missing'), 'relative-path', null])
    await assert.rejects(open(path), { status: 400 });
  assert.equal(launches, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createFileOpener, fileLaunchMode } from '../lib/open-file.mjs';

test('native open passes a literal filename to xdg-open without a shell', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-native-file-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const path = join(root, 'rapport é & [1]; $test.md');
  await writeFile(path, '# Fixture');
  let call;
  let fail = false;
  const opener = createFileOpener({
    platform: 'linux',
    run: async (...args) => {
      call = args;
      if (fail) throw new Error('xdg-open failed');
      return { stdout: '' };
    },
  });
  assert.deepEqual(await opener(path), { opened: true });
  assert.equal(call[0], 'xdg-open');
  assert.deepEqual(call[1], [path]);
  assert.equal(call[2].shell, false);
  assert.ok(call[2].timeout > 0 && call[2].timeout <= 15000);
  fail = true;
  await assert.rejects(opener(path), { status: 502 });
  await assert.rejects(opener(join(root, 'missing.md')), { status: 404 });
  await assert.rejects(
    createFileOpener({ platform: 'win32', run: async () => ({ stdout: '' }) })(path),
    { status: 502 },
  );
});

test('source scripts go to an editor and executables or shortcuts cannot be launched as documents', () => {
  for (const path of ['notes.md', 'report.pdf', 'table.xlsx'])
    assert.equal(fileLaunchMode(path), 'associated');
  for (const path of ['script.ps1', 'script.js', 'script.bat', 'script.py', 'script.sh', 'README'])
    assert.equal(fileLaunchMode(path), 'editor');
  for (const path of ['app.exe', 'shortcut.lnk', 'page.url', 'installer.msi', 'run.hta'])
    assert.throws(() => fileLaunchMode(path), { status: 400 });
});

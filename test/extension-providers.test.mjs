import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgentExtensions } from '../lib/extension-providers.mjs';
import { createStore } from '../lib/store.mjs';

test('listAgentExtensions returns only loadable extension files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-studio-ext-list-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'extensions');
  await mkdir(dir);
  await writeFile(join(dir, '9router.ts'), 'export default () => {}');
  await writeFile(join(dir, 'helper.js'), 'export default () => {}');
  await writeFile(join(dir, 'lm-studio.ts.disabled'), 'export default () => {}');
  await writeFile(join(dir, 'notes.md'), '# no');
  await writeFile(join(dir, 'types.d.ts'), 'export {};');
  await mkdir(join(dir, 'nested'));
  assert.deepEqual(await listAgentExtensions(root), [
    { id: '9router', file: '9router.ts' },
    { id: 'helper', file: 'helper.js' },
  ]);
  assert.deepEqual(await listAgentExtensions(join(root, 'missing')), []);
});

test('studio preferences persist includeExtensionProviders independently', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'prime-studio-ext-pref-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStore({
    dataDir: join(root, 'data'),
    sessionDir: join(root, 'sessions'),
    initialCwd: root,
  });
  await store.init();
  assert.equal((await store.getStudioPreferences()).includeExtensionProviders, false);
  const saved = await store.setStudioPreferences({ includeExtensionProviders: true });
  assert.equal(saved.includeExtensionProviders, true);
  assert.equal(saved.allowQuestionsByDefault, true);
  assert.equal((await store.getStudioPreferences()).includeExtensionProviders, true);
  await assert.rejects(store.setStudioPreferences({ includeExtensionProviders: 'yes' }), (error) => {
    assert.equal(error.status, 400);
    return true;
  });
  await assert.rejects(
    store.setStudioPreferences({ allowQuestionsByDefault: true, includeExtensionProviders: true }),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    },
  );
});

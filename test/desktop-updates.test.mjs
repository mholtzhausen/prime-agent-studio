import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateManifest } from '../scripts/desktop-update-manifest.mjs';
test('release catalog uses the real signature and a stable GitHub AppImage name', async () => {
  const signature = await readFile(new URL('./fixtures/updater/payload.txt.sig', import.meta.url), 'utf8');
  const manifest = updateManifest({ version: '2.8.0', signature, notes: 'Release notes' });
  assert.equal(manifest.platforms['linux-x86_64'].signature, signature.trim());
  assert.equal(
    manifest.platforms['linux-x86_64'].url,
    'https://github.com/mholtzhausen/prime-agent-studio/releases/download/v2.8.0/Prime-Agent-Studio-Nix_2.8.0_amd64.AppImage',
  );
  assert.equal(manifest.notes, 'Release notes');
  assert.equal(manifest.platforms['windows-x86_64'], undefined);
  for (const version of ['../x', '2.8.0-beta.1', 'latest'])
    assert.throws(() => updateManifest({ version, signature }));
  for (const badSignature of ['', 'not-a-signature'])
    assert.throws(() => updateManifest({ version: '2.8.0', signature: badSignature }));
});

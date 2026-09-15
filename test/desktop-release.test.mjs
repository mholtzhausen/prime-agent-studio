import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_RELEASE_REPO,
  UPDATER_LATEST_JSON_URL,
  appImageArtifactName,
  appImageDownloadUrl,
  appImageDownloadUrlPattern,
  debArtifactName,
} from '../lib/desktop-release.mjs';

test('desktop release coordinates stay on the nix fork catalog', () => {
  assert.equal(GITHUB_RELEASE_REPO, 'mholtzhausen/prime-agent-studio');
  assert.equal(
    UPDATER_LATEST_JSON_URL,
    'https://github.com/mholtzhausen/prime-agent-studio/releases/latest/download/latest.json',
  );
  assert.equal(appImageArtifactName('3.4.1'), 'Prime-Agent-Studio-Nix_3.4.1_amd64.AppImage');
  assert.equal(debArtifactName('3.4.1'), 'Prime-Agent-Studio-Nix_3.4.1_amd64.deb');
  assert.equal(
    appImageDownloadUrl('3.4.1'),
    'https://github.com/mholtzhausen/prime-agent-studio/releases/download/v3.4.1/Prime-Agent-Studio-Nix_3.4.1_amd64.AppImage',
  );
  assert.match(appImageDownloadUrl('2.8.0'), appImageDownloadUrlPattern());
  assert.throws(() => appImageArtifactName('3.4.1-beta'));
});

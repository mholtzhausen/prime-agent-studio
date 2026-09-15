/** Fixed release coordinates for signed Linux desktop updates. */
export const GITHUB_RELEASE_REPO = 'mholtzhausen/prime-agent-studio';
export const GITHUB_RELEASE_ORIGIN = `https://github.com/${GITHUB_RELEASE_REPO}`;
export const UPDATER_LATEST_JSON_URL = `${GITHUB_RELEASE_ORIGIN}/releases/latest/download/latest.json`;
export const SIGNING_KEY_BASENAME = 'prime-agent-studio-nix.key';

export function appImageArtifactName(version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) throw new Error('A stable version is required');
  return `Prime-Agent-Studio-Nix_${version}_amd64.AppImage`;
}

export function debArtifactName(version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) throw new Error('A stable version is required');
  return `Prime-Agent-Studio-Nix_${version}_amd64.deb`;
}

export function appImageDownloadUrl(version) {
  return `${GITHUB_RELEASE_ORIGIN}/releases/download/v${version}/${appImageArtifactName(version)}`;
}

export function appImageDownloadUrlPattern() {
  return new RegExp(
    `^https://github\\.com/${GITHUB_RELEASE_REPO.replaceAll('/', '\\/')}/releases/download/v\\d+\\.\\d+\\.\\d+/Prime-Agent-Studio-Nix_\\d+\\.\\d+\\.\\d+_amd64\\.AppImage$`,
  );
}

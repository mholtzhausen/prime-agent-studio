import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectInvocation } from './launcher-common.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function updateManifest({ version, signature, notes = '', date = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable version is required');
  if (
    !signature?.trim() ||
    !Buffer.from(signature.trim(), 'base64').toString().startsWith('untrusted comment:')
  )
    throw new Error('Missing updater signature');
  const artifact = `Prime-Agent-Studio_${version}_amd64.AppImage`;
  return {
    version,
    notes,
    pub_date: date,
    platforms: {
      'linux-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/zerr0o/prime-agent-studio/releases/download/v${version}/${artifact}`,
      },
    },
  };
}
if (isDirectInvocation(import.meta.url)) {
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const { readdir } = await import('node:fs/promises');
  const appimageDir = join(root, 'src-tauri/target/release/bundle/appimage');
  const names = await readdir(appimageDir).catch(() => []);
  const appimageName =
    names.find((n) => n.endsWith('.AppImage') && !n.endsWith('.sig')) ||
    `Prime-Agent-Studio_${version}_amd64.AppImage`;
  const source = join(appimageDir, appimageName);
  const signature = await readFile(source + '.sig', 'utf8');
  const notes = process.argv[2] ? await readFile(resolve(process.argv[2]), 'utf8') : '';
  const manifest = updateManifest({ version, signature, notes });
  const output = join(root, '.local', 'desktop-release', `v${version}`);
  await mkdir(output, { recursive: true });
  const destination = join(output, `Prime-Agent-Studio_${version}_amd64.AppImage`);
  await copyFile(source, destination);
  await copyFile(source + '.sig', destination + '.sig');
  const debDir = join(root, 'src-tauri/target/release/bundle/deb');
  const debNames = await readdir(debDir).catch(() => []);
  const debName = debNames.find((n) => n.endsWith('.deb'));
  if (debName) {
    await copyFile(join(debDir, debName), join(output, `Prime-Agent-Studio_${version}_amd64.deb`));
  }
  await writeFile(join(output, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Signed AppImage, signature and latest.json prepared in ${output}`);
}

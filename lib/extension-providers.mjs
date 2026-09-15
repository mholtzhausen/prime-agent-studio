import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const EXTENSION_FILE = /^(?!.*\.d\.ts$)[^.].*\.(?:ts|js)$/i;

/** List installable Prime Agent extension files without executing them. */
export async function listAgentExtensions(agentHome) {
  if (typeof agentHome !== 'string' || !agentHome) return [];
  const dir = join(agentHome, 'extensions');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && EXTENSION_FILE.test(entry.name))
    .map((entry) => ({
      id: entry.name.replace(/\.(?:ts|js)$/i, ''),
      file: entry.name,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

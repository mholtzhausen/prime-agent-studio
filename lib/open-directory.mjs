import { formatMessage as tr } from '../public/i18n-core.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpError, validateDirectory } from './store.mjs';

export function createDirectoryOpener({
  platform = process.platform,
  run = promisify(execFile),
  env = process.env,
} = {}) {
  const pending = new Map();
  async function launch(path) {
    try {
      if (platform !== 'linux') throw new Error('unsupported platform');
      await run('xdg-open', [path], { shell: false, timeout: 15000, env });
      return { opened: true };
    } catch {
      throw new HttpError(502, tr('server.impossible_d_ouvrir_ce_dossier_sur_le_pc_reessayez'));
    }
  }
  return async (cwd) => {
    const path = await validateDirectory(cwd);
    const key = path;
    if (pending.has(key)) return pending.get(key);
    const job = launch(path);
    pending.set(key, job);
    try {
      return await job;
    } finally {
      if (pending.get(key) === job) pending.delete(key);
    }
  };
}

export const openDirectory = createDirectoryOpener();

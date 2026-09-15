import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { formatMessage as tr } from '../public/i18n-core.js';
import { HttpError, validateDirectory } from './store.mjs';

function resolveOnPath(name, env = process.env) {
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Detect zenity or kdialog for the local Linux folder picker. */
export function detectDirectoryPicker({ env = process.env, resolve = resolveOnPath } = {}) {
  if (resolve('zenity', env)) return 'zenity';
  if (resolve('kdialog', env)) return 'kdialog';
  return null;
}

export function createDirectoryPicker({
  platform = process.platform,
  env = process.env,
  run = promisify(execFile),
  resolve = resolveOnPath,
  detect = detectDirectoryPicker,
} = {}) {
  let controller;
  return {
    available() {
      return platform === 'linux' && !!detect({ env, resolve });
    },
    async pick({ cwd, title, signal } = {}) {
      if (platform !== 'linux') throw new HttpError(501, tr('folders.linux_only'));
      const backend = detect({ env, resolve });
      if (!backend) throw new HttpError(501, tr('folders.linux_picker_missing'));
      if (signal?.aborted) return { cwd: null };
      if (controller) throw new HttpError(409, tr('folders.already_open'));
      const current = new AbortController();
      controller = current;
      const abort = () => current.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const initial = cwd ? await validateDirectory(cwd).catch(() => '') : '';
        current.signal.throwIfAborted();
        const label = title || tr('folders.choose');
        let command;
        let args;
        if (backend === 'zenity') {
          command = resolve('zenity', env);
          args = ['--file-selection', '--directory', `--title=${label}`];
          if (initial) args.push(`--filename=${initial}/`);
        } else {
          command = resolve('kdialog', env);
          args = ['--getexistingdirectory', initial || homedirFallback(env), label];
        }
        let stdout = '';
        try {
          ({ stdout } = await run(command, args, {
            shell: false,
            signal: current.signal,
            timeout: 300000,
            maxBuffer: 16384,
            encoding: 'utf8',
            env,
          }));
        } catch (error) {
          // zenity/kdialog exit 1 on cancel; treat as no selection.
          if (error?.code === 1 || error?.status === 1) return { cwd: null };
          throw error;
        }
        if (signal?.aborted) return { cwd: null };
        const selected = stdout.trim();
        if (!selected) return { cwd: null };
        return { cwd: await validateDirectory(selected) };
      } catch (error) {
        if (signal?.aborted) return { cwd: null };
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, tr('folders.picker_failed'));
      } finally {
        signal?.removeEventListener('abort', abort);
        if (controller === current) controller = undefined;
      }
    },
    close() {
      controller?.abort();
    },
  };
}

function homedirFallback(env) {
  return env.HOME || '/';
}

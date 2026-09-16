import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
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

/** Detect zenity or kdialog for the local Linux folder/file picker. */
export function detectDirectoryPicker({ env = process.env, resolve: resolveBin = resolveOnPath } = {}) {
  if (resolveBin('zenity', env)) return 'zenity';
  if (resolveBin('kdialog', env)) return 'kdialog';
  return null;
}

function validateExecutable(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved) || !statSync(resolved).isFile())
    throw new HttpError(400, tr('folders.invalid_resource'));
  try {
    accessSync(resolved, constants.X_OK);
  } catch {
    throw new HttpError(400, tr('folders.invalid_resource'));
  }
  return resolved;
}

export function createDirectoryPicker({
  platform = process.platform,
  env = process.env,
  run = promisify(execFile),
  resolve: resolveBin = resolveOnPath,
  detect = detectDirectoryPicker,
} = {}) {
  let controller;
  return {
    available() {
      return platform === 'linux' && !!detect({ env, resolve: resolveBin });
    },
    async pick({ cwd, title, signal, mode = 'directory' } = {}) {
      if (platform !== 'linux') throw new HttpError(501, tr('folders.linux_only'));
      const backend = detect({ env, resolve: resolveBin });
      if (!backend) throw new HttpError(501, tr('folders.linux_picker_missing'));
      if (signal?.aborted) return { cwd: null, path: null };
      if (controller) throw new HttpError(409, tr('folders.already_open'));
      const current = new AbortController();
      controller = current;
      const abort = () => current.abort();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const fileMode = mode === 'file';
        const initial = cwd
          ? fileMode
            ? resolve(cwd)
            : await validateDirectory(cwd).catch(() => '')
          : '';
        current.signal.throwIfAborted();
        const label = title || tr(fileMode ? 'folders.choose_file' : 'folders.choose');
        let command;
        let args;
        if (backend === 'zenity') {
          command = resolveBin('zenity', env);
          args = ['--file-selection', `--title=${label}`];
          if (!fileMode) args.push('--directory');
          if (initial) args.push(`--filename=${fileMode ? initial : initial + '/'}`);
        } else {
          command = resolveBin('kdialog', env);
          args = fileMode
            ? ['--getopenfilename', initial || homedirFallback(env), label]
            : ['--getexistingdirectory', initial || homedirFallback(env), label];
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
          if (error?.code === 1 || error?.status === 1) return { cwd: null, path: null };
          throw error;
        }
        if (signal?.aborted) return { cwd: null, path: null };
        const selected = stdout.trim();
        if (!selected) return { cwd: null, path: null };
        if (fileMode) {
          const path = validateExecutable(selected);
          return { cwd: null, path };
        }
        const directory = await validateDirectory(selected);
        return { cwd: directory, path: directory };
      } catch (error) {
        if (signal?.aborted) return { cwd: null, path: null };
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

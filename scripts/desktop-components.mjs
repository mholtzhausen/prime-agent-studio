import {
  applySelection,
  activateComponents,
  diagnoseComponents,
  classifyComponentError,
} from '../lib/desktop-components.mjs';
import { isDirectInvocation } from './launcher-common.mjs';

export async function runComponents(options, { signal } = {}) {
  if (!['diagnose', 'select', 'activate', 'discover'].includes(options.action))
    throw new Error('action_invalid');
  if (options.action === 'select') {
    if (!['engine', 'uv', 'python'].includes(options.component) || typeof options.path !== 'string')
      throw new Error('selection_invalid');
    return applySelection({
      dataRoot: options.dataRoot,
      env: options.env,
      signal,
      paths: { [options.component]: options.path },
    });
  }
  if (options.action === 'discover') {
    return applySelection({
      dataRoot: options.dataRoot,
      env: options.env,
      signal,
      discover: true,
    });
  }
  const result = await diagnoseComponents({
    ...options,
    signal,
    autoDiscover: options.action === 'diagnose',
  });
  if ((options.action === 'activate' || options.action === 'diagnose') && result.ready)
    await activateComponents({ dataRoot: options.dataRoot, result, env: options.env });
  return result;
}

if (isDirectInvocation(import.meta.url)) {
  const abort = new AbortController();
  process.stdin.resume();
  process.stdin.on('data', () => abort.abort());
  process.stdin.on('end', () => abort.abort());
  const options = JSON.parse(process.argv[2] || '{}');
  const output = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  try {
    output({
      type: 'result',
      result: await runComponents(options, { signal: abort.signal }),
    });
  } catch (error) {
    const classified = classifyComponentError(error);
    output({
      type: 'failure',
      component: error.component,
      error: classified.code,
      detail: classified.detail,
    });
  } finally {
    process.stdin.destroy();
  }
}

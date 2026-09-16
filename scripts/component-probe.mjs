// Isolated import checks: never construct a provider, authenticate, or send a prompt.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = process.argv[2];
const native = (name) => import(pathToFileURL(join(root, 'dist', name + '.js')).href);

function fail(check, error) {
  const detail = String(error && (error.stack || error.message || error)).slice(0, 2000);
  process.stderr.write(JSON.stringify({ error: 'engine_incompatible', check, detail }));
  process.exitCode = 1;
}

function requireExport(check, value, label = 'missing') {
  if (!value) {
    const error = new Error(label);
    error.check = check;
    throw error;
  }
}

try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  requireExport('package.json#name', pkg.name === 'prime-agent', `expected prime-agent, got ${pkg.name}`);

  const api = await native('index');
  requireExport('index#AuthStorage.create', typeof api.AuthStorage?.create === 'function');
  requireExport('index#ModelRegistry.create', typeof api.ModelRegistry?.create === 'function');
  requireExport(
    'index#ModelRegistry.refreshAvailableModels',
    typeof api.ModelRegistry?.prototype?.refreshAvailableModels === 'function',
  );

  const ai = await import(
    pathToFileURL(join(root, 'node_modules/@earendil-works/pi-ai/dist/models.js')).href
  );
  requireExport(
    'pi-ai#getSupportedThinkingLevels',
    typeof ai.getSupportedThinkingLevels === 'function',
  );

  const modules = await Promise.all(
    [
      'core/skills',
      'core/slash-commands',
      'core/mcp/mcp-manager',
      'core/package-manager',
      'core/prompt-templates',
    ].map(native),
  );
  requireExport(
    'core/skills#getPythonSkillRuntimeInfo',
    typeof modules[0].getPythonSkillRuntimeInfo === 'function',
  );
  requireExport(
    'core/slash-commands#BUILTIN_SLASH_COMMANDS',
    Array.isArray(modules[1].BUILTIN_SLASH_COMMANDS),
  );
  requireExport('core/mcp/mcp-manager#McpManager', typeof modules[2].McpManager === 'function');

  const require = createRequire(join(root, 'package.json'));
  const photon = require('@silvia-odwyer/photon-node');
  requireExport('photon-node#PhotonImage', typeof photon.PhotonImage === 'function');

  for (const path of [
    'dist/prime-agent-runtime/pyproject.toml',
    'dist/skills/agent-message/pyproject.toml',
  ]) {
    try {
      await readFile(join(root, path));
    } catch (error) {
      error.check = path;
      throw error;
    }
  }

  const shell = await native('utils/shell');
  requireExport(
    'utils/shell#resolveKernelBashShell',
    typeof shell.resolveKernelBashShell === 'function',
    'resolveKernelBashShell is not a function',
  );
  const settingsPath = process.argv[3];
  const settings = settingsPath
    ? JSON.parse(await readFile(settingsPath, 'utf8').catch(() => '{}'))
    : {};
  const bash = shell.resolveKernelBashShell(settings.shellPath);
  process.stdout.write(JSON.stringify({ version: pkg.version, bash: bash || null }));
} catch (error) {
  let check = typeof error?.check === 'string' ? error.check : 'probe';
  // Native import failures: name the module from the message when possible.
  if (check === 'probe' && typeof error?.message === 'string') {
    const match = /Cannot find module ['"]([^'"]+)['"]/.exec(error.message);
    if (match) check = match[1];
  }
  fail(check, error);
}

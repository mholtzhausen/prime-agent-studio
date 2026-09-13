// Isolated import checks: never construct a provider, authenticate, or send a prompt.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = process.argv[2];
const native = (name) => import(pathToFileURL(join(root, 'dist', name + '.js')).href);
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const api = await native('index');
  if (
    typeof api.AuthStorage?.create !== 'function' ||
    typeof api.ModelRegistry?.create !== 'function' ||
    typeof api.ModelRegistry?.prototype?.refreshAvailableModels !== 'function'
  )
    throw new Error();
  const ai = await import(
    pathToFileURL(join(root, 'node_modules/@earendil-works/pi-ai/dist/models.js')).href
  );
  if (typeof ai.getSupportedThinkingLevels !== 'function') throw new Error();
  const modules = await Promise.all(
    [
      'core/skills',
      'core/slash-commands',
      'core/mcp/mcp-manager',
      'core/package-manager',
      'core/prompt-templates',
    ].map(native),
  );
  if (
    typeof modules[0].getPythonSkillRuntimeInfo !== 'function' ||
    !Array.isArray(modules[1].BUILTIN_SLASH_COMMANDS) ||
    typeof modules[2].McpManager !== 'function'
  )
    throw new Error();
  const require = createRequire(join(root, 'package.json'));
  const photon = require('@silvia-odwyer/photon-node');
  if (typeof photon.PhotonImage !== 'function') throw new Error();
  for (const path of ['dist/prime-agent-runtime/pyproject.toml', 'dist/skills/agent-message/pyproject.toml'])
    await readFile(join(root, path));
  const shell = await native('utils/shell');
  const settingsPath = process.argv[3];
  const settings = settingsPath ? JSON.parse(await readFile(settingsPath, 'utf8').catch(() => '{}')) : {};
  const bash = shell.resolveKernelBashShell(settings.shellPath);
  process.stdout.write(JSON.stringify({ version: pkg.version, bash: bash || null }));
} catch {
  process.stderr.write('engine_incompatible');
  process.exitCode = 1;
}

// Explicit release-CI setup in RUNNER_TEMP, separate from packaged application resources.
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareComponents } from '../lib/desktop-components.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !process.env.GITHUB_ENV)
  throw new Error('This setup is only for the isolated release CI runner.');
const dataRoot = join(process.env.RUNNER_TEMP, 'studio-release-components');
const result = await prepareComponents({
  dataRoot,
  onProgress: (event) => {
    if (event.stage !== 'downloading') console.log(event.component, event.stage);
  },
});
if (!result.ready) throw new Error('Release engine validation failed.');
const manifest = JSON.parse(await readFile(join(dataRoot, 'engine/installation.json'), 'utf8'));
await appendFile(
  process.env.GITHUB_ENV,
  `PRIME_AGENT_CLI=${manifest.components.engine.path}\nPRIME_AGENT_PYTHON=${manifest.components.python.path}\n`,
);

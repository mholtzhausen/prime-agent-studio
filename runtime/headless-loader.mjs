import { register } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPrimeAgentNpmBridge } from './npm-bridge.mjs';

// Only the GUI's print client receives this marker. Its workers inherit neither
// this registration nor the marker, even when Node forwards --import arguments.
// Prime Agent 0.9.5+ first loads dist/bundle/cli.js, which re-execs cli-node.js
// with the same --import list — keep the marker until that real entry runs.
const packageRoot = process.env.PRIME_GUI_CLI_ROOT;
if (packageRoot && !isPrimeAgentNpmBridge()) delete process.env.PRIME_GUI_CLI_ROOT;
if (packageRoot) {
  register('./headless-hook.mjs', import.meta.url, {
    data: { packageRoot: realpathSync(resolve(packageRoot)) },
  });
}

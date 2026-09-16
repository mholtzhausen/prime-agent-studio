import { register } from 'node:module';
import { realpathSync } from 'node:fs';
import { isPrimeAgentNpmBridge } from './npm-bridge.mjs';

const packageRoot = process.env.PRIME_GUI_CLI_ROOT;
// Keep the marker across cli.js → cli-node.js so the real entry can register.
if (packageRoot && !isPrimeAgentNpmBridge()) delete process.env.PRIME_GUI_CLI_ROOT;
if (packageRoot)
  register('./studio-rpc-hook.mjs', import.meta.url, { data: { packageRoot: realpathSync(packageRoot) } });

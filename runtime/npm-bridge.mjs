import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Prime Agent 0.9.5+ ships `dist/bundle/cli.js` as an npm→native bridge that
 * prefers the compiled `~/.local/share/prime-agent` binary when present.
 * That handoff drops Node `process.execArgv`, so Studio `--import` / `--require`
 * loaders never reach the real process and RPC patches (e.g.
 * `studio_wait_for_completion`) are missing.
 *
 * When Studio needs those loaders, spawn `cli-node.js` directly. If the bridge
 * still re-execs Node→Node (no native install), loaders must keep role markers
 * until that real entry runs.
 */
export function isPrimeAgentNpmBridge(entry = process.argv[1] || '') {
  return /[/\\]dist[/\\]bundle[/\\]cli\.js$/i.test(entry);
}

/** Prefer the Node entry that keeps Studio loaders when `cli.js` would migrate. */
export function resolvePrimeAgentNodeEntry(cliPath) {
  if (!cliPath || !isPrimeAgentNpmBridge(cliPath)) return cliPath;
  const nodeEntry = join(dirname(cliPath), 'cli-node.js');
  return existsSync(nodeEntry) ? nodeEntry : cliPath;
}

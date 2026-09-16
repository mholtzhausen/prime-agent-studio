/**
 * Prime Agent 0.9.5+ ships `dist/bundle/cli.js` as an npm→native bridge that
 * re-execs into `cli-node.js` with the same `process.execArgv` (including
 * Studio `--import` / `--require` loaders). Loaders must keep role markers
 * until that real entry runs; clearing them on the bridge leaves the child
 * unpatched.
 */
export function isPrimeAgentNpmBridge(entry = process.argv[1] || '') {
  return /[/\\]dist[/\\]bundle[/\\]cli\.js$/i.test(entry);
}

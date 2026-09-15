#!/usr/bin/env bash
# Start Prime Agent Studio Nix in the background and open the browser.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
NODE="${PRIME_AGENT_GUI_NODE:-node}"
PORT="${PORT:-3088}"
NO_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    --no-browser) NO_BROWSER=1 ;;
  esac
done
"$NODE" "$ROOT/scripts/start-server.mjs"
if [[ "$NO_BROWSER" -eq 0 ]]; then
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:${PORT}/" >/dev/null 2>&1 || true
  fi
fi

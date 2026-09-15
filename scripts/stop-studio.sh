#!/usr/bin/env bash
# Stop the Studio server and its managed runs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
NODE="${PRIME_AGENT_GUI_NODE:-node}"
exec "$NODE" "$ROOT/scripts/stop-server.mjs"

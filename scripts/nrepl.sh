#!/usr/bin/env bash
# (Re)start the Basilisp nREPL server on port 37888 with all workspace src
# dirs on PYTHONPATH. Regenerates .nrepl-pythonpath so restarts pick up any
# newly created component/base src dirs.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=37888

# Kill any existing nrepl-server (any port — one nREPL per repo).
pkill -f "basilisp nrepl-server" 2>/dev/null || true
sleep 1

# Regenerate the PYTHONPATH manifest from the actual workspace layout.
# (|| true: bases/ may not exist yet in early phases.)
{ ls -d components/*/src 2>/dev/null || true; ls -d bases/*/src 2>/dev/null || true; } \
  | paste -sd: - > .nrepl-pythonpath

PYTHONPATH=$(cat .nrepl-pythonpath) nohup .venv/bin/basilisp nrepl-server --port "${PORT}" \
  > /tmp/agentworld-nrepl.log 2>&1 &

echo "nREPL starting on port ${PORT} (log: /tmp/agentworld-nrepl.log)"

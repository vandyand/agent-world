#!/usr/bin/env bash
# Run the Basilisp test suite (pytest wrapper) from the repo root.
# Never invoke raw pytest — it uses the wrong importer cache/env.
# Usage: scripts/test.sh [pytest-args...]   e.g. scripts/test.sh tests/inference
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/basilisp test "$@"

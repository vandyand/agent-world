#!/usr/bin/env bash
# Build the static viewer bundle into dist/ for zero-backend hosting
# (Vercel). The viewer detects static mode at runtime (WS connect fails →
# auto-loads /replays/demo.jsonl), so no rewriting is needed — this is a
# straight copy of the public viewer plus ONLY the canonical demo replay
# (smoke/malicious test fixtures stay out of the deploy).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$ROOT/bases/server/resources/public"
DIST="$ROOT/dist"

test -s "$PUB/replays/demo.jsonl" || {
  echo "ERROR: $PUB/replays/demo.jsonl missing — produce it first:" >&2
  echo "  .venv/bin/basilisp run -n agentworld.base.headless -- --minutes 10 --out $PUB/replays/demo.jsonl --seed 42" >&2
  exit 1
}

rm -rf "$DIST"
mkdir -p "$DIST/replays"

cp "$PUB/index.html" "$PUB/viewer.js" "$PUB/style.css" "$DIST/"
cp -r "$PUB/assets" "$DIST/assets"
cp "$PUB/replays/demo.jsonl" "$DIST/replays/demo.jsonl"

# Minimal Vercel config: pure static, no framework, no build step.
cat > "$DIST/vercel.json" <<'EOF'
{
  "version": 2,
  "framework": null,
  "buildCommand": null,
  "outputDirectory": "."
}
EOF

# Hygiene gate on the exact bytes being shipped.
python3 "$ROOT/scripts/check_public_hygiene.py" "$DIST"

echo "dist/ built:"
(cd "$DIST" && find . -type f | sort | sed 's/^/  /')
du -sh "$DIST"

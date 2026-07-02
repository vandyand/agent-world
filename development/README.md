# Development — REPL workflow

Basilisp polylith. All commands run from the repo root
(`/home/kingjames/vandykeportfolio/agent-world`).

## Start the nREPL

```bash
scripts/nrepl.sh
```

- Regenerates `.nrepl-pythonpath` from the live workspace layout
  (`components/*/src` + `bases/*/src`) — **rerun after creating a new
  brick** so its src dir lands on the server's PYTHONPATH.
- Kills any stale `basilisp nrepl-server`, then starts a fresh one on
  port **37888** (log: `/tmp/agentworld-nrepl.log`).
- The server writes `.nrepl-port` on startup.

## Evaluate forms

Use `clj-nrepl-eval` (on PATH) against the port:

```bash
clj-nrepl-eval -p 37888 "(+ 1 2)"
clj-nrepl-eval -p 37888 "(require '[agentworld.inference.cost :as cost]) (cost/spend-snapshot)"
```

## Reload pattern

After editing a `.lpy` file, reload its namespace in the running REPL:

```bash
clj-nrepl-eval -p 37888 "(require '[agentworld.inference.cost :as cost] :reload)"
```

`:reload` recompiles just that namespace; use `:reload-all` when a
dependency below it changed too. If things get weird (stale defs, deleted
vars lingering), restart with `scripts/nrepl.sh`.

## Running bases (`basilisp run -n`)

`basilisp run` resolves namespaces via `sys.path`, which does not know the
polylith brick layout. A `.pth` file in the venv's site-packages adds every
brick src dir; regenerate it after creating a new brick:

```bash
SITE=$(.venv/bin/python -c "import site; print(site.getsitepackages()[0])")
{ for d in components/*/src bases/*/src; do echo "$PWD/$d"; done; } > "$SITE/agentworld-bricks.pth"
```

Then e.g.:

```bash
.venv/bin/basilisp run -n agentworld.base.headless -- --minutes 2 --out /tmp/spike.jsonl --seed 42 [--stub]
```

## Tests and gates

```bash
scripts/test.sh                     # full suite (basilisp test — never raw pytest)
scripts/test.sh tests/inference     # one area
.venv/bin/python scripts/compile_check.py   # every namespace compiles
.venv/bin/python scripts/check_deps.py      # polylith dependency direction
```

`tests/` has **no `__init__.py`** (it breaks the basilisp test runner).
Test namespaces mirror their path minus the `tests/` prefix:
`tests/inference/test_cost.lpy` → `(ns inference.test-cost)`.

## Conventions & gotchas

- Bricks: `components/<brick>/src/agentworld/<brick>/*.lpy`,
  bases: `bases/<base>/src/agentworld/base/<base>.lpy`.
- Pass explicit opts maps, not kwargs-style trailing key/vals (basilisp
  kwargs-destructuring bug with trailing map values).
- Use `#py {}` / `python/list` at Python library boundaries — basilisp
  persistent maps are not dicts.
- `basilisp.test/is` may double-evaluate forms — bind side-effecting calls
  in a `let` before asserting.
- LLM spend: every call path goes through `agentworld.inference.cost`
  (`reserve!` → dispatch → `settle!`). Cap via `AGENT_WORLD_MAX_SPEND_USD`
  (default $1.00). `OPENROUTER_API_KEY` must be exported in the shell that
  starts the nREPL/server.

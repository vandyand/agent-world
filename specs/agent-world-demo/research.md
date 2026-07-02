# Agent World Demo - Research

## Problem Statement

Andrew keeps applying to Upwork jobs that name-drop **LangGraph, AutoGen, CrewAI** and has no portfolio artifact that demonstrably uses them. Build a bespoke flagship demo: a simulated 2D pixel world where LLM-powered agents walk around and, when within a proximity radius of one another, hold conversations. The repo itself is a differentiator: **Basilisp (Clojure-on-Python) organized as a Polylith monorepo**, driving the Python agent-orchestration ecosystem through interop. Powered by a very cheap/fast OpenRouter model so the demo can run for real without meaningful cost.

Deliverable joins the sibling demos in `/home/kingjames/vandykeportfolio/` and gets featured on the rewritten portfolio site.

## Codebase Context

Greenfield repo at `/home/kingjames/vandykeportfolio/agent-world` (git initialized, branch `feature/agent-world-demo`). No existing code. Two reference codebases inform conventions:

### Reference 1: `~/contracting/upwork/steven-tran/stevetrading-basilisp` (production Basilisp polylith, live-traded)
Conventions to copy verbatim:
- `basilisp.edn` (empty `{}`) at root marks the project for the Basilisp CLI.
- Bricks: `components/<brick>/src/<top-ns>/<brick>/*.lpy`, `bases/<base>/src/<top-ns>/base/<base>.lpy`.
- `scripts/nrepl.sh` — regenerates `.nrepl-pythonpath` from `ls -d components/*/src bases/*/src | paste -sd:`, kills stale server, nohups `basilisp nrepl-server`.
- `scripts/test.sh` — wraps `basilisp test` (never raw pytest; wrong-env importer-cache failures).
- `scripts/compile_check.py` — imports every `.lpy` namespace via `basilisp.main.init()` (compile gate).
- `scripts/check_deps.py` — regex-parses `(:require ...)`, enforces dependency direction.
- `tests/` has **no `__init__.py`** (breaks the basilisp test runner); `tests/world/test_grid.lpy` declares `(ns world.test-grid)`.
- pytest `pythonpath` in `pyproject.toml` lists every brick src dir.
- REPL eval via `clj-nrepl-eval -p <port> "..."` works against basilisp's nREPL.

### Reference 2: `~/ascolais` (Clojure monorepo; patterns, not code)
- **Inference/OpenRouter**: env var `OPENROUTER_API_KEY`; OpenRouter = OpenAI wire protocol at `https://openrouter.ai/api/v1`. Cost-guard pattern worth porting: per-process spend atom + per-model price table + env-var cap with fail-before-spend (`bases/storybook/src/ascolais/storybook/cost_guard.clj`, `STORYBOOK_MAX_SPEND_USD` default $5).
- **Browser capability** (`components/browser`): Playwright screenshots for the visual dev-verification loop. Used from the dev harness here via the `mcp__playwright__*` tools or ascolais REPL — dev-time only, not a runtime dependency of this repo.
- Key hygiene: API keys never enter LLM transcripts.

## Framework Research Findings (web, 2026-07)

### Pixel/sim framework — verdict: **pygame-ce, headless, state-streaming architecture**
- **pygame-ce 2.5.7** is the actively maintained pygame lineage (community fork by former core devs; upstream pygame stalled). `pip install pygame-ce`.
- Headless is trivial: `os.environ["SDL_VIDEODRIVER"] = "dummy"` before `pygame.init()`. Battle-tested, no X server. (Skip `Surface.convert()` under dummy driver.)
- **pygbag/WASM is NOT viable** for this demo: no client sockets in pygbag, LLM calls from the browser hit CORS + would ship the API key to visitors. Ruled out.
- **Canonical architecture precedent: Stanford Generative Agents ("Smallville") and a16z AI Town** — Python backend owns the sim state as JSON; JS canvas frontend renders. We follow this: headless sim server-side, browser canvas viewer consumes `{agent_id, x, y, facing, dialogue}` state.
- Consequence: pygame-ce's runtime role is small (Rect/collision/optional local window); the sim core is plain logic in Basilisp. pygame-ce stays as a dev-time local visualizer and Rect utility, keeping the dependency honest without being load-bearing.
- Runner-up considered: arcade 3.x (first-class EGL headless, Tiled maps) — heavier server deps (GL), no web path. Mesa considered for ABM — fights real-time movement. tcod's pathfinding noted as a possible steal.

### Basilisp — verdict: **viable, no hard blockers** (verified by local execution)
- basilisp 0.5.1 (PyPI, 2026-04), Python 3.10–3.14. Locally: 0.5.0 user-level; pin 0.5.1 in venv.
- Interop verified locally: `(:import ...)` of pip packages, kwargs via `**` separator, `:decorators` meta, `defasync`/`await` + `asyncio/run`.
- **langgraph 1.1.4 driven from Basilisp was verified by live execution locally** (StateGraph built with basilisp fns as nodes, `.invoke` returned correct state). Basilisp fns are plain Python callables.
- nREPL ships in core: `basilisp nrepl-server --port <p>`; `clj-nrepl-eval` works against it.
- Gotchas recorded: ~4s cold start (fine, we run daemons); `.lpyc` cache out of git; kwargs-destructuring bug with trailing map values (use explicit opts maps); python dicts (`#py {}`) not persistent maps at library boundaries; `basilisp.test/is` may double-evaluate forms.
- **python-polylith CLI rejected**: parses `.py` imports only, blind to `.lpy`. Enforce polylith manually with the two scripts (compile_check, check_deps).

### Orchestrators — verdict: **all three in ONE venv** (resolver-verified from PyPI metadata)
| Package | Version | Pin intersection |
|---|---|---|
| langgraph | 1.2.7 (+langchain-openai 1.3.3) | openai >=2.26,<3 · pydantic >=2.7.4 |
| autogen-agentchat + autogen-ext[openai] | 0.7.5 (maintenance mode) | openai >=1.93 · pydantic >=2.10,<3 |
| crewai | 1.15.1 | openai >=2.30,<3 · pydantic >=2.11.9,<2.13 |

Solution exists: `openai ~2.30`, `pydantic >=2.11.9,<2.13`. **Risk**: autogen-ext 0.7.5 predates openai 2.x ("OpenAI-compatible endpoints not tested"; history of breaking on openai point releases) → Phase 0 must smoke-test autogen against OpenRouter before anything is built on it. Fallback if broken: pin `openai` lower in an isolated `venv-autogen` worker subprocess speaking JSON over stdio (also acceptable; do NOT bridge ad-hoc otherwise).

Division of labor (genuine, not gimmicky):
- **LangGraph** = per-agent cognition loop: `StateGraph` with perceive → decide (LLM) → route (`add_conditional_edges`) → move/idle/seek nodes.
- **AutoGen** (`autogen-agentchat` 0.7.x — still what recruiters mean by "AutoGen"; README notes Microsoft Agent Framework 1.0 convergence awareness) = proximity conversations: two `AssistantAgent`s in a `RoundRobinGroupChat`, `MaxMessageTermination(6)`. Requires explicit `model_info=ModelInfo(...)` for non-OpenAI model IDs (issue #6502).
- **CrewAI** = the periodic "Town Chronicle": a small Crew (chronicler agent + editor agent, 2 Tasks) that summarizes the day's events into a running narrative shown in the viewer.

### OpenRouter models (verified prices, 2026-07, $/Mtok in/out)
- Default: `google/gemini-2.5-flash-lite` — $0.10/$0.40, fast, 1M ctx.
- Alt cheap: `mistralai/mistral-small-3.2-24b-instruct` — $0.075/$0.20.
- Free-tier fallback toggle: `:free` variants, 20 req/min and 50–1000 req/day depending on credit history — too throttled for a busy world, fine for a short demo run.
- Wiring: langchain-openai `ChatOpenAI(base_url="https://openrouter.ai/api/v1", api_key=OPENROUTER_API_KEY)`; autogen `OpenAIChatCompletionClient(base_url=..., model_info=...)`; crewai `LLM(model="openrouter/<id>", base_url=...)` (also env `OPENAI_API_BASE` workaround for crewai #5139).

## REPL Findings

No project REPL yet (greenfield). Pre-project verification was done by executing throwaway scripts locally: basilisp interop smoke (imports, kwargs, decorators, async) and a **live langgraph-from-basilisp StateGraph run** — both passed. Phase 0 of the implementation plan establishes the project nREPL and re-proves the critical seams inside the project venv (langgraph node callables, autogen+OpenRouter compatibility, crewai LLM routing, pygame-ce dummy-driver init).

## Requirements

### Functional
1. 2D tile world (fixed map, ~48×32 tiles, a few named places: square, tavern, market, dock…) with 4–8 agents, each with a persona (name, occupation, personality, goal).
2. Agents move around the world; movement is smooth per-tick; LLM decides *intent* (destination/behavior) at a decision cadence, not every tick — locomotion (pathing toward intent target) is deterministic local logic.
3. When two agents come within proximity radius R and neither is on conversation cooldown, an AutoGen two-agent conversation fires (≤6 messages); the transcript renders as speech bubbles / a dialogue log; a cooldown prevents immediate re-triggering.
4. LangGraph cognition graph per agent produces decisions from perception (nearby agents/places, recent memories, last conversation summary).
5. CrewAI chronicle crew runs every N sim-minutes, producing a running "Town Chronicle" narrative displayed in the viewer.
6. Browser viewer: canvas rendering of tiles + agents (pixel-art style), speech bubbles, agent inspector (click an agent → persona, current intent, memory), chronicle panel, event feed. Served by the sim server; consumes live state over WebSocket (or SSE).
7. **Replay mode**: sim can run headless and record every event/state-diff to JSONL; the same viewer can play a bundled replay file with zero backend — this is what deploys publicly.
8. Cost guard: per-run spend cap (env `AGENT_WORLD_MAX_SPEND_USD`, default $1.00), token usage tracked per call, fail-before-spend; spend shown in the viewer HUD.

### Non-Functional
- Repo is a Basilisp Polylith: `components/`, `bases/`, `projects/`, `development/`, enforced by compile_check + check_deps gates.
- All LLM calls server-side; `OPENROUTER_API_KEY` from env, never in transcripts, client bundle, or replay files.
- A full demo run (10 sim-minutes, 6 agents) costs < $0.25 at default model prices.
- Runs on WSL2/Linux, Python 3.12, single venv (subject to Phase 0 autogen verdict).
- Portfolio-deployable: replay build is static (Vercel-hostable alongside sibling demos); live mode documented for local run.

## Options Considered

1. **All-in-browser via pygbag/WASM** — rejected: no sockets in pygbag, CORS + API-key exposure for LLM calls.
2. **Server-rendered frames streamed as video/JPEG** — rejected: heavy, ugly, kills the crisp pixel look; state-streaming is lighter and lets the viewer be pretty.
3. **Headless Python sim + JSON state over WebSocket + JS canvas viewer** — **chosen** (Smallville/AI-Town precedent). Sim logic in Basilisp; pygame-ce for Rect/collision utilities + optional local window.
4. **Live public deployment of the python server** (Fly/Render) vs **static replay on Vercel** — chosen: replay-on-Vercel as the always-works public artifact (recruiters never hit a cold/dead server), live mode as the local/interview story. Live hosting can be added later without rearchitecting (the viewer already speaks both WebSocket and replay-file).
5. **python-polylith CLI** vs **manual polylith conventions + 2 gate scripts** — chosen: manual (CLI can't parse `.lpy`).
6. **One venv for all three orchestrators** vs **per-orchestrator venv workers** — chosen: one venv (resolver says compatible), with the isolated-worker fallback pre-designed if Phase 0 autogen smoke fails.

## Recommendation

Build the headless Basilisp sim (option 3) with the one-venv orchestrator stack, replay-first deployment (option 4), manual polylith gates (option 5). Bricks:

- `components/world` — grid, places, entities, movement, collision, proximity queries (pure).
- `components/persona` — agent persona defs + prompt builders (pure data).
- `components/memory` — per-agent bounded memory log + summarization hooks (pure).
- `components/inference` — OpenRouter client factory (openai SDK), usage extraction, **cost guard** (spend atom, cap, price table).
- `components/cognition` — LangGraph decision graph (perceive→decide→route→intent).
- `components/conversation` — AutoGen proximity dialogues.
- `components/chronicle` — CrewAI town-chronicle crew.
- `components/recorder` — event log, JSONL replay writer/reader.
- `components/engine` — the tick loop: advances world, triggers cognition/conversation/chronicle at cadences, emits events (depends on all above).
- `bases/server` — FastAPI app: WebSocket state stream, static viewer assets, control endpoints (start/pause/speed).
- `bases/headless` — CLI: run N sim-minutes, write replay JSONL + final chronicle; used to produce the deployable replay.
- `projects/demo` — deployment artifact docs/scripts (replay build → Vercel static dir).
- Viewer: plain HTML/canvas/JS (no build step) in `bases/server/resources/public/` — simplest thing that looks great; pixel font + tile sprites.

## Open Questions

1. **Does autogen-agentchat 0.7.5 actually work against OpenRouter with openai 2.x installed?** → Phase 0 smoke test. Fallback pre-designed (isolated worker venv).
2. **Sprite/tile art source** — draw a tiny original tileset (16×16, few tiles + 1 agent sprite recolored per agent) vs. use a CC0 pack (e.g., Kenney). Default: Kenney CC0 pack fetched into `bases/server/resources/public/assets/` with attribution in README; fallback: generated colored-rect "pixel" style that still looks intentional.
3. **Chronicle cadence and conversation concurrency** — start with: decisions every 8 ticks/agent (staggered), one conversation at a time world-wide (queue others), chronicle every 120 ticks. Tune in Phase 6 polish.
4. **Replay file size budget** for Vercel static hosting — target < 5 MB for a 10-minute run; if exceeded, record state keyframes + events instead of full diffs.

## References

- `~/contracting/upwork/steven-tran/stevetrading-basilisp` — layout, scripts/nrepl.sh, scripts/test.sh, compile_check.py, check_deps.py conventions.
- `~/ascolais/components/inference/src/ascolais/inference/{interface,openai,core}.clj` — OpenRouter client shape; `~/ascolais/bases/storybook/src/ascolais/storybook/cost_guard.clj` — spend-cap pattern.
- Stanford Generative Agents repo (github.com/joonspk-research/generative_agents) — backend-JSON + JS-frontend architecture precedent.
- LangGraph graph API: docs.langchain.com/oss/python/langgraph/graph-api (StateGraph, add_conditional_edges).
- AutoGen models tutorial + issue #6502 (model_info requirement): microsoft.github.io/autogen.
- CrewAI LLM connections: docs.crewai.com/en/learn/llm-connections (+ issue #5139 base_url workaround).
- OpenRouter pricing: openrouter.ai/pricing; limits: openrouter.ai/docs/api/reference/limits.
- pygame-ce: pypi.org/project/pygame-ce; headless: pygame.org/wiki/DummyVideoDriver; pygbag limitation: pygame-web.github.io/wiki/pygbag-code.

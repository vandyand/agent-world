# Agent World Demo - Implementation Plan

## Overview

Phased build of the Basilisp Polylith agent-world. Every phase ends with live verification checkpoints (nREPL forms via `clj-nrepl-eval` against the project's basilisp nREPL, or shell probes) — these are the primary evidence, run by the orchestrator. Narrow `basilisp test` invocations are secondary. Update checkboxes with commit SHAs as phases land.

Top-level namespace: `agentworld`. Python: 3.12 venv at `.venv`. All work in `/home/kingjames/vandykeportfolio/agent-world`.

## Prerequisites

- [ ] `OPENROUTER_API_KEY` present in environment (check `~/ascolais/.env` if not in shell env; export for the nREPL/server processes)
- [ ] Python 3.12 with venv module available

## Phase 0: REPL Spike — prove the risky seams

Create `.venv`, install the full dependency stack, and empirically verify every integration the plan depends on. **No production code.** Findings recorded back into this file under "Phase 0 Findings".

- [ ] `python3 -m venv .venv && .venv/bin/pip install basilisp==0.5.1 pygame-ce langgraph langchain-openai autogen-agentchat "autogen-ext[openai]" crewai fastapi "uvicorn[standard]" websockets pytest` — record the resolver's chosen versions of `openai` and `pydantic`; confirm no conflict errors
- [ ] Smoke 1 (basilisp↔langgraph): from a throwaway `.lpy` run via `.venv/bin/basilisp run`, build a 3-node StateGraph with a conditional edge using basilisp fns as nodes; `.invoke` returns routed state
- [ ] Smoke 2 (langgraph↔OpenRouter): ChatOpenAI(base_url=openrouter, model=`google/gemini-2.5-flash-lite`) one-shot completion from inside the graph; record actual usage/token fields available on the response
- [ ] Smoke 3 (autogen↔OpenRouter, **the risk gate**): two AssistantAgents + RoundRobinGroupChat + MaxMessageTermination(6) via OpenAIChatCompletionClient(base_url=openrouter, model_info=ModelInfo(...)); run from basilisp via `asyncio/run`. PASS → one-venv plan stands. FAIL → record exact error; pivot conversation component to the pre-designed isolated-worker fallback (separate venv, stdio JSON) and update Phase 3 tasks before proceeding
- [ ] Smoke 4 (crewai↔OpenRouter): 1-agent 1-task Crew via `LLM(model="openrouter/google/gemini-2.5-flash-lite", base_url=..., api_key=...)`; kickoff returns text; record how usage/cost metadata is exposed (crewai hides raw usage — if unavailable, note that chronicle cost tracking must estimate from character counts or litellm callbacks)
- [ ] Smoke 5 (pygame-ce headless): `SDL_VIDEODRIVER=dummy` + `pygame.init()` + Rect collision + `pygame.sprite` import — no display errors
- [ ] Smoke 6 (nREPL): copy/adapt `scripts/nrepl.sh` from stevetrading-basilisp; start `basilisp nrepl-server`; verify `clj-nrepl-eval -p <port> "(+ 1 2)"` → 3
- [ ] Record Phase 0 Findings section in this file: versions, autogen verdict, usage-metadata shapes per framework, any plan edits required

### Verification (Phase 0)
- Shell: each smoke script exits 0 with expected printed output (captured in findings)
- nREPL: `clj-nrepl-eval -p <port> "(+ 1 2)"` returns `3`

## Phase 1: Repo skeleton, polylith gates, inference + cost guard

- [ ] Write `pyproject.toml` (project metadata; deps pinned from Phase 0 resolver output; `[tool.pytest.ini_options] pythonpath` listing `tests`, `.`, every brick src dir), empty `basilisp.edn` (`{}`), `.gitignore` (`.venv/`, `__pycache__/`, `*.lpyc`, `.nrepl-port`, `.nrepl-pythonpath`, `replays/*.jsonl` except bundled demo replay)
- [ ] `scripts/nrepl.sh`, `scripts/test.sh`, `scripts/compile_check.py`, `scripts/check_deps.py` — adapted from stevetrading-basilisp (check_deps rule: `components/*` may not require `bases/*`; `engine` may require all components; pure components (`world`, `persona`, `memory`, `recorder`) may not require LLM components (`inference`, `cognition`, `conversation`, `chronicle`))
- [ ] `components/inference/src/agentworld/inference/core.lpy`: `(make-client opts)` → openai-SDK client bound to OpenRouter base-url + key from env; `(complete! client {:model :system :messages})` → `{:content :usage {:input-tokens :output-tokens}}`; model registry map `{:default "google/gemini-2.5-flash-lite" :prices {...}}`
- [ ] `components/inference/src/agentworld/inference/cost.lpy`: spend atom, `(record-usage! model usage)` → running USD total, `(check-budget!)` throws `ex-info :budget-exceeded` when total ≥ cap (env `AGENT_WORLD_MAX_SPEND_USD` default 1.00), `(spend-snapshot)` → `{:total-usd :calls :by-model}`
- [ ] `tests/inference/test_cost.lpy`: unit tests for cost math + cap trip (no network)
- [ ] `development/README.md`: REPL workflow (start nrepl.sh, clj-nrepl-eval usage, reload pattern)

### Verification (Phase 1)
- nREPL: `(require '[agentworld.inference.cost :as cost]) (cost/record-usage! "google/gemini-2.5-flash-lite" {:input-tokens 1000000 :output-tokens 1000000})` → `0.5` (=$0.10+$0.40); `(cost/spend-snapshot)` shape matches
- nREPL: budget cap: with cap env stubbed to 0.1, `(cost/check-budget!)` throws ex-info with `:budget-exceeded`
- Shell: `.venv/bin/python scripts/compile_check.py` exits 0; `.venv/bin/python scripts/check_deps.py` exits 0; `scripts/test.sh tests/inference` passes

## Phase 2: World, persona, memory (pure sim — no LLM)

- [ ] `components/world/src/agentworld/world/grid.lpy`: tile map (48×32) defined as data — walkable/blocked tiles, named places with rects (square, tavern, market, dock, garden, smithy); loaded from `components/world/resources/map.edn`
- [ ] `components/world/src/agentworld/world/entity.lpy`: agent entity records `{:id :name :pos [x y] :facing :target :path :state}`; spawn at places
- [ ] `components/world/src/agentworld/world/move.lpy`: BFS/A* pathfinding on the grid; `(step-entity world ent)` advances one tile along path toward `:target`, recomputes on blockage; idle wander behavior
- [ ] `components/world/src/agentworld/world/proximity.lpy`: `(pairs-within world r)` → seq of agent pairs within Chebyshev distance r, excluding pairs on cooldown (cooldown map passed in — proximity stays pure)
- [ ] `components/persona/src/agentworld/persona/core.lpy`: 6 personas as data (name, occupation, personality, speech style, goal, home place) — e.g., Mara the baker, Theo the blacksmith, Isolde the fisherwoman, Bram the innkeeper, Cass the herbalist, Otto the dockmaster; `(system-prompt persona)` and `(decision-prompt persona perception)` builders
- [ ] `components/memory/src/agentworld/memory/core.lpy`: per-agent ring buffer (last K=20 events as strings), `(remember! store agent-id event)`, `(recent store agent-id n)`, `(conversation-summary! store agent-id text)`
- [ ] `tests/world/test_move.lpy`, `tests/world/test_proximity.lpy`, `tests/memory/test_core.lpy`

### Verification (Phase 2)
- nREPL: build world, spawn 6 agents, `(dotimes [_ 50] (tick-move!))`-style loop at the REPL → all agents have valid walkable positions; an agent given `:target` at the tavern arrives within path-length ticks
- nREPL: two agents placed 2 tiles apart, r=3 → `(pairs-within world 3)` returns exactly that pair; same pair on cooldown → `()`
- Shell: `scripts/test.sh tests/world tests/memory` passes; both gate scripts exit 0

## Phase 3: Cognition (LangGraph), conversation (AutoGen), chronicle (CrewAI)

- [ ] `components/cognition/src/agentworld/cognition/graph.lpy`: LangGraph StateGraph per decision: nodes `perceive` (pure: nearby agents/places/memories → prompt context), `decide` (LLM: returns intent JSON `{:action "goto"|"wander"|"stay"|"seek" :place? :reason}` — parse defensively, fallback `wander`), conditional edge routing to `set-target`/`idle`; compiled once, invoked per agent decision with `#py {}` state dicts at the boundary
- [ ] `components/conversation/src/agentworld/conversation/core.lpy`: `(converse! persona-a persona-b context)` → AutoGen RoundRobinGroupChat (≤6 messages), returns `{:transcript [{:speaker :text}] :summary}` (summary = last message or cheap one-shot); wraps every call in cost-guard usage recording (Phase 0 findings determine usage extraction; estimate if SDK hides it)
- [ ] `components/chronicle/src/agentworld/chronicle/core.lpy`: CrewAI crew — `chronicler` agent (Task: turn event log excerpt into 2-3 sentence vivid chronicle entry) + `editor` agent (Task: keep running chronicle coherent, ≤150 words); `(chronicle! events prior)` → updated chronicle text
- [ ] All three components take the inference component's model registry / cost guard — check_deps allows `cognition/conversation/chronicle → inference, persona, memory`
- [ ] `tests/cognition/test_graph.lpy`: graph topology + defensive intent parsing with a stubbed LLM callable (no network)

### Verification (Phase 3)
- nREPL (live, cheap, ~$0.01): `(cognition/decide! test-persona test-perception)` → valid intent map with `:action` in the allowed set
- nREPL (live): `(conversation/converse! mara theo {:place "square"})` → transcript with ≥2 turns, both speakers present, spend recorded in `(cost/spend-snapshot)`
- nREPL (live): `(chronicle/chronicle! sample-events nil)` → non-empty string ≤ ~1200 chars
- Shell: `scripts/test.sh tests/cognition` passes (stubbed, no network); gates exit 0

## Phase 4: Engine tick loop, recorder, headless base

- [ ] `components/recorder/src/agentworld/recorder/core.lpy`: event types (`:tick-state` keyframes every N ticks, `:move`, `:intent`, `:conversation`, `:chronicle`, `:spend`); JSONL writer `(open-recorder path)` / `(emit! rec event)`; reader `(read-replay path)` → lazy events; replay files carry NO api keys/prompts — transcripts and positions only
- [ ] `components/engine/src/agentworld/engine/core.lpy`: `(make-sim {:personas :map :seed :decision-cadence 8 :chronicle-cadence 120 :proximity-r 3 :conversation-cooldown 90})`; `(tick! sim)` — advance movement every tick; stagger agent decisions round-robin at cadence (LLM calls on a worker thread pool so ticks don't block; intents applied when ready); proximity check → at most one active conversation world-wide (queue/cooldown others); chronicle at cadence; every state change emits recorder events + updates a `state-atom` snapshot `{:tick :agents :active-conversation :chronicle :spend}`
- [ ] `bases/headless/src/agentworld/base/headless.lpy`: CLI (`basilisp run -n agentworld.base.headless -- --minutes 10 --out replays/demo.jsonl --seed 42`); runs sim at max speed (no wall-clock sleep), prints progress + final spend; graceful stop on budget cap
- [ ] `tests/engine/test_tick.lpy`: engine with ALL LLM components stubbed (deterministic intents/dialogue) — N ticks produce valid state, conversations trigger on proximity, cooldowns respected, recorder file well-formed JSONL

### Verification (Phase 4)
- nREPL: stubbed sim, `(dotimes [_ 300] (engine/tick! sim))` → state snapshot valid; ≥1 stub conversation occurred; JSONL lines parse; keyframe cadence correct
- Shell (live, capped ~$0.10): `.venv/bin/basilisp run -n agentworld.base.headless -- --minutes 2 --out /tmp/spike.jsonl --seed 42` exits 0; `/tmp/spike.jsonl` contains ≥1 real conversation event + ≥1 chronicle event; reported spend < $0.10
- Shell: `scripts/test.sh tests/engine` passes; gates exit 0

## Phase 5: Server base + browser viewer (live + replay)

- [ ] `bases/server/src/agentworld/base/server.lpy`: FastAPI app via interop — `GET /` serves viewer; `/assets/*` static; `WS /ws/state` pushes state-atom snapshots (~10 Hz diff or full small snapshot) + event feed; `POST /api/control` `{action: start|pause|speed}`; runs uvicorn programmatically; sim runs in background thread at wall-clock pace (tick ~150ms)
- [ ] Viewer `bases/server/resources/public/`: `index.html`, `viewer.js`, `style.css` — canvas tile rendering (Kenney CC0 tiles fetched to `assets/`, fallback colored-rect), agent sprites w/ name labels, speech bubbles during active conversation, right panel: agent inspector (click → persona/intent/memories), Town Chronicle panel, event feed, spend HUD; **mode switch**: `?replay=<url>` param loads JSONL replay and plays it with the same renderer + timeline scrubber/speed control; no build step, ES modules ok
- [ ] Playwright visual verification during dev (`mcp__playwright__*` or ascolais browser): screenshot loop against `http://localhost:8700` until the world renders correctly (tiles visible, 6 agents moving, bubble appears during conversation)
- [ ] `projects/demo/README.md`: how to run live mode; how replay build works

### Verification (Phase 5)
- Shell: server starts; `curl -s localhost:8700/` returns viewer HTML; `curl -s localhost:8700/api/health` → `{"ok":true,"tick":N}` with N increasing between two calls
- Playwright: screenshot shows rendered tile map with 6 labeled agents; a second screenshot ≥30s later shows agents at different positions; during a conversation a speech bubble is visible; replay mode (`?replay=/replays/demo.jsonl`) renders and scrubs
- nREPL: `(server/state-snapshot)` shape `{:tick :agents :chronicle :spend}` correct

## Phase 6: Full run, replay artifact, deployment, docs

- [ ] Produce the canonical demo replay: 10-sim-minute headless run, seed chosen for lively output (≥3 conversations, ≥2 chronicle entries), spend < $0.25; bundle as `bases/server/resources/public/replays/demo.jsonl` (< 5 MB; if larger, switch recorder to keyframes+events and regenerate)
- [ ] Static export: `scripts/build_static.sh` → `dist/` containing viewer + demo replay wired as default (`index.html` auto-loads replay when no WS available); deploy `dist/` to Vercel as project `agent-world` (match sibling-demo Vercel setup: `vercel --prod` from dist or vercel.json static config); verify live URL
- [ ] Root `README.md`: hero screenshot/GIF, architecture diagram (ASCII ok), the LangGraph/AutoGen/CrewAI division-of-labor story, basilisp polylith explanation, quick start (live + replay), cost model, Kenney attribution if used, note on Microsoft Agent Framework convergence awareness
- [ ] Screenshot(s) for the portfolio site captured via Playwright and saved to `docs/screenshots/`
- [ ] Final gates: `scripts/test.sh` (full), compile_check, check_deps all green

### Verification (Phase 6)
- Shell: `test -s dist/replays/demo.jsonl && du -h dist/replays/demo.jsonl` under budget; full test suite green
- Playwright: Vercel production URL renders the replay: tiles + agents animate, chronicle panel non-empty, conversation bubble appears at recorded timestamp
- Spend report from the canonical run < $0.25 (printed by headless CLI, quoted in README)

## Rollout Plan

1. Replay artifact on Vercel (public, static, zero cost) — the portfolio link target.
2. Live mode documented for local runs/interviews.
3. Portfolio-rewrite feature (separate spec) adds this as flagship project.

## Rollback Plan

Static Vercel deploy — rollback = `vercel rollback` or redeploy previous dist. Repo is additive; no shared infra touched.

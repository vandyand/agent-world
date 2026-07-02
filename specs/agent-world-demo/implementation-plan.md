# Agent World Demo - Implementation Plan

## Overview

Phased build of the Basilisp Polylith agent-world. Every phase ends with live verification checkpoints (nREPL forms via `clj-nrepl-eval` against the project's basilisp nREPL, or shell probes) — these are the primary evidence, run by the orchestrator. Narrow `basilisp test` invocations are secondary. Update checkboxes with commit SHAs as phases land.

Top-level namespace: `agentworld`. Python: 3.12 venv at `.venv`. All work in `/home/kingjames/vandykeportfolio/agent-world`.

## Prerequisites

- [ ] `OPENROUTER_API_KEY` present in environment (check `~/ascolais/.env` if not in shell env; export for the nREPL/server processes)
- [ ] Python 3.12 with venv module available

## Phase 0: REPL Spike — prove the risky seams

Create `.venv`, install the full dependency stack, and empirically verify every integration the plan depends on. **No production code** — all spike scripts live in `/tmp/`, never in the repo. Findings recorded back into this file under "Phase 0 Findings".

- [x] `python3 -m venv .venv && .venv/bin/pip install ...` — clean resolve, no conflicts
- [x] Smoke 1 (basilisp↔langgraph): conditional routing via basilisp node fns — PASS
- [x] Smoke 2 (langgraph↔OpenRouter): one-shot completion inside graph node — PASS
- [x] Smoke 3 (autogen↔OpenRouter, **the risk gate**): 6-message RoundRobinGroupChat from basilisp — **PASS, one-venv plan stands**
- [x] Smoke 4 (crewai↔OpenRouter): kickoff — PASS, usage exposed on `result.token_usage`
- [x] Smoke 5 (pygame-ce headless): dummy driver + Rect + sprite Group — PASS
- [x] Smoke 6 (nREPL): `clj-nrepl-eval -p 37888 "(+ 1 2)"` → `3` — PASS
- [x] Phase 0 Findings recorded below

### Phase 0 Findings (2026-07-02)

**Resolver-chosen versions** (no conflicts): basilisp 0.5.1, pygame-ce 2.5.7, langgraph 1.2.7, langchain-openai 1.3.3, autogen-agentchat/-ext 0.7.5, crewai 1.15.1, **openai 2.44.0**, **pydantic 2.12.5**, fastapi 0.139.0. Pin these in `pyproject.toml` (Phase 1).

**AUTOGEN VERDICT: PASS.** RoundRobinGroupChat + OpenAIChatCompletionClient against OpenRouter works with openai 2.44.0, driven from basilisp via `asyncio/run`. Working `model_info` dict: `{vision false, function_calling false, json_output false, family "unknown", structured_output false, multiple_system_messages true}`. Isolated-worker fallback NOT needed.

**Usage/cost metadata shapes** (for `settle!`):
- langchain (cognition): `resp.usage_metadata` → `{input_tokens, output_tokens}`; **`resp.response_metadata["token_usage"]["cost"]` carries OpenRouter's authoritative USD cost** (e.g. `1.1e-06` for the smoke). → Plan refinement: `settle!` prefers actual OpenRouter cost when present, falls back to price-table estimate. For raw openai-SDK calls in the inference component, request `extra_body={"usage": {"include": true}}` to get the same cost field.
- autogen (conversation): per-message `msg.models_usage` → `RequestUsage(prompt_tokens, completion_tokens)`; sum over transcript, settle via price table.
- crewai (chronicle): `result.token_usage` → `{total_tokens, prompt_tokens, completion_tokens, successful_requests}`; settle via price table. Set `CREWAI_DISABLE_TELEMETRY=true` + `OTEL_SDK_DISABLED=true`.

**Assumptions confirmed**: all six seams work as planned; `#py {}` dicts at langgraph boundary; kwargs via `**` interop; basilisp fns as nodes/callables everywhere.
**Assumptions invalidated**: none.
**Plan edits required**: only the settle!-prefers-actual-cost refinement above (applied to Phase 1 task wording).

**Phase 0 spend**: < $0.001 total (smoke2 $0.0000011 actual + smoke3 ~250 tokens + smoke4 120 tokens).

### Verification (Phase 0)
- Shell: each smoke script exits 0 with expected printed output (captured in findings)
- nREPL: `clj-nrepl-eval -p <port> "(+ 1 2)"` returns `3`

## Phase 1: Repo skeleton, polylith gates, inference + cost guard (COMPLETE — f573873)

- [x] Write `pyproject.toml` (project metadata; deps pinned from Phase 0 resolver output; `[tool.pytest.ini_options] pythonpath` listing `tests`, `.`, every brick src dir), empty `basilisp.edn` (`{}`), `.gitignore` (`.venv/`, `__pycache__/`, `*.lpyc`, `.nrepl-port`, `.nrepl-pythonpath`, `replays/*.jsonl` except bundled demo replay)
- [x] `scripts/nrepl.sh`, `scripts/test.sh`, `scripts/compile_check.py`, `scripts/check_deps.py` — adapted from stevetrading-basilisp (check_deps rule: `components/*` may not require `bases/*`; `engine` may require all components; pure components (`world`, `persona`, `memory`, `recorder`) may not require LLM components (`inference`, `cognition`, `conversation`, `chronicle`))
- [x] `components/inference/src/agentworld/inference/core.lpy`: `(make-client opts)` → openai-SDK client bound to OpenRouter base-url + key from env; `(complete! client {:model :system :messages})` → `{:content :usage {:input-tokens :output-tokens}}`; model registry map `{:default "google/gemini-2.5-flash-lite" :prices {...}}`
- [x] `components/inference/src/agentworld/inference/cost.lpy`: single atom holding `{:spent-usd :reserved-usd :calls :by-model}`, **reservation-based fail-before-spend safe under concurrency**: `(reserve! model {:prompt-chars N :max-output-tokens M})` atomically (swap! with validation) adds the cost estimate (chars/4 input tokens + M output tokens at registry prices) to `:reserved-usd`, throwing `ex-info :budget-exceeded` if `spent + reserved + estimate > cap` — BEFORE dispatch; `(settle! reservation-id model usage)` reconciles actuals into `:spent-usd` and releases the reservation — prefers OpenRouter's authoritative `cost` field when present in usage (Phase 0 finding), else price-table estimate from tokens; raw openai-SDK calls request `extra_body={"usage": {"include": true}}`; cap from env `AGENT_WORLD_MAX_SPEND_USD` default 1.00; `(spend-snapshot)` → `{:total-usd :reserved-usd :calls :by-model}`. All `complete!` calls set an explicit `max_tokens` so estimates are bounded; retries disabled/limited (`max_retries` ≤ 1) on all clients
- [x] `tests/inference/test_cost.lpy`: unit tests for cost math + cap trip (no network), **including a concurrent test**: with cap set so only one reservation fits, two threads calling `reserve!` simultaneously → exactly one succeeds, one throws `:budget-exceeded`
- [x] `development/README.md`: REPL workflow (start nrepl.sh, clj-nrepl-eval usage, reload pattern)

### Verification (Phase 1)
- nREPL: `(require '[agentworld.inference.cost :as cost]) (cost/record-usage! "google/gemini-2.5-flash-lite" {:input-tokens 1000000 :output-tokens 1000000})` → `0.5` (=$0.10+$0.40); `(cost/spend-snapshot)` shape matches
- nREPL: budget cap: with cap stubbed to 0.1 and 0.09 already spent, `(cost/reserve! "google/gemini-2.5-flash-lite" {:prompt-chars 400000 :max-output-tokens 1000})` throws ex-info with `:budget-exceeded`; small reservation under remaining budget succeeds, and after `settle!` the reservation is released (`:reserved-usd` back to 0)
- Shell: `.venv/bin/python scripts/compile_check.py` exits 0; `.venv/bin/python scripts/check_deps.py` exits 0; `scripts/test.sh tests/inference` passes

## Phase 2: World, persona, memory (pure sim — no LLM) (COMPLETE — see git log)

- [x] `components/world/src/agentworld/world/grid.lpy`: tile map (48×32) defined as data — walkable/blocked tiles, named places with rects (square, tavern, market, dock, garden, smithy); loaded from `components/world/resources/map.edn`
- [x] `components/world/src/agentworld/world/entity.lpy`: agent entity records `{:id :name :pos [x y] :facing :target :path :state}`; spawn at places
- [x] `components/world/src/agentworld/world/move.lpy`: BFS/A* pathfinding on the grid; `(step-entity world ent)` advances one tile along path toward `:target`, recomputes on blockage; idle wander behavior
- [x] `components/world/src/agentworld/world/proximity.lpy`: `(pairs-within world r)` → seq of agent pairs within Chebyshev distance r, excluding pairs on cooldown (cooldown map passed in — proximity stays pure)
- [x] `components/persona/src/agentworld/persona/core.lpy`: 6 personas as data (name, occupation, personality, speech style, goal, home place) — e.g., Mara the baker, Theo the blacksmith, Isolde the fisherwoman, Bram the innkeeper, Cass the herbalist, Otto the dockmaster; `(system-prompt persona)` and `(decision-prompt persona perception)` builders
- [x] `components/memory/src/agentworld/memory/core.lpy`: per-agent ring buffer (last K=20 events as strings), `(remember! store agent-id event)`, `(recent store agent-id n)`, `(conversation-summary! store agent-id text)`
- [x] `tests/world/test_move.lpy`, `tests/world/test_proximity.lpy`, `tests/memory/test_core.lpy`

### Verification (Phase 2)
- nREPL: build world, spawn 6 agents, `(dotimes [_ 50] (tick-move!))`-style loop at the REPL → all agents have valid walkable positions; an agent given `:target` at the tavern arrives within path-length ticks
- nREPL: two agents placed 2 tiles apart, r=3 → `(pairs-within world 3)` returns exactly that pair; same pair on cooldown → `()`
- Shell: `scripts/test.sh tests/world tests/memory` passes; both gate scripts exit 0

## Phase 3: Cognition (LangGraph), conversation (AutoGen), chronicle (CrewAI) (COMPLETE)

- [x] `components/cognition/src/agentworld/cognition/graph.lpy`: LangGraph StateGraph per decision: nodes `perceive` (pure: nearby agents/places/memories → prompt context), `decide` (LLM: returns intent JSON `{:action "goto"|"wander"|"stay"|"seek" :place? :reason}` — parse defensively, fallback `wander`), conditional edge routing to `set-target`/`idle`; compiled once, invoked per agent decision with `#py {}` state dicts at the boundary
- [x] `components/conversation/src/agentworld/conversation/core.lpy`: `(converse! persona-a persona-b context)` → AutoGen RoundRobinGroupChat (≤6 messages), returns `{:transcript [{:speaker :text}] :summary}` (summary = last message or cheap one-shot); wraps every call in cost-guard usage recording (Phase 0 findings determine usage extraction; estimate if SDK hides it)
- [x] `components/chronicle/src/agentworld/chronicle/core.lpy`: CrewAI crew — `chronicler` agent (Task: turn event log excerpt into 2-3 sentence vivid chronicle entry) + `editor` agent (Task: keep running chronicle coherent, ≤150 words); `(chronicle! events prior)` → updated chronicle text
- [x] All three components take the inference component's model registry / cost guard — check_deps allows `cognition/conversation/chronicle → inference, persona, memory`. **Guarded-client rule**: AutoGen's `OpenAIChatCompletionClient` and CrewAI's `LLM` are constructed with explicit `max_tokens` and retries disabled/limited, and every `converse!`/`chronicle!` invocation `reserve!`s its worst-case cost (messages × max_tokens bound) before kicking off the framework and `settle!`s from returned/estimated usage after — fail-before-spend holds even though the frameworks make internal calls we don't intercept per-request
- [x] `tests/cognition/test_graph.lpy`: graph topology + defensive intent parsing with a stubbed LLM callable (no network)

### Verification (Phase 3)
- nREPL (live, cheap, ~$0.01): `(cognition/decide! test-persona test-perception)` → valid intent map with `:action` in the allowed set
- nREPL (live): `(conversation/converse! mara theo {:place "square"})` → transcript with ≥2 turns, both speakers present, spend recorded in `(cost/spend-snapshot)`
- nREPL (live): `(chronicle/chronicle! sample-events nil)` → non-empty string ≤ ~1200 chars
- Shell: `scripts/test.sh tests/cognition` passes (stubbed, no network); gates exit 0

## Phase 4: Engine tick loop, recorder, headless base (COMPLETE)

- [x] `components/recorder/src/agentworld/recorder/core.lpy`: event types (`:tick-state` keyframes every N ticks, `:move`, `:intent`, `:conversation`, `:chronicle`, `:spend`); JSONL writer `(open-recorder path)` / `(emit! rec event)`; reader `(read-replay path)` → lazy events; **sanitizer at the emit boundary**: events pass through `(sanitize event)` which whitelists fields (positions, names, transcripts, chronicle text, spend totals) — raw prompts, system messages, request payloads, and anything matching key-like patterns are structurally excluded
- [x] `scripts/check_public_hygiene.py`: scans any given files/dirs (replay JSONL, `bases/server/resources/public/`, `dist/`) for secret patterns (`sk-or-`, `OPENROUTER_API_KEY` values, `api_key`) and raw-prompt fields (`system_prompt`, `messages`); exits non-zero on hit; wired into Phase 6 gates
- [x] `components/engine/src/agentworld/engine/core.lpy`: `(make-sim {:personas :map :seed :decision-cadence 20 :chronicle-cadence 120 :proximity-r 3 :conversation-cooldown 90})`; **canonical time/call budget: 1 sim-minute = 60 ticks; live mode ticks at ~150ms wall-clock; each agent gets ONE decision LLM call every `decision-cadence` (20) ticks, staggered round-robin — for the canonical 10-sim-minute 6-agent run: 600 ticks → ≤180 decision calls + ≤10 conversations (≤6 msgs each ≈ ≤60 calls) + 5 chronicle runs × 2 task calls = 10 → ≤250 LLM calls, expected ≈ $0.05–0.10 at default prices (hence the <$0.25 claim)**; `(tick! sim)` — advance movement every tick; **concurrency discipline**: per-agent `:decision-in-flight?` flag (no re-enqueue while pending), at most one in-flight conversation world-wide and one in-flight chronicle, bounded global LLM work queue, worker results applied only on the tick thread via a synchronized result queue (workers never mutate world state directly); in max-speed headless mode ticks that would enqueue while in-flight simply skip; proximity check → at most one active conversation world-wide (queue/cooldown others); chronicle at cadence; every state change emits recorder events + updates a `state-atom` snapshot `{:tick :agents :active-conversation :chronicle :spend}`
- [x] `bases/headless/src/agentworld/base/headless.lpy`: CLI (`basilisp run -n agentworld.base.headless -- --minutes 10 --out replays/demo.jsonl --seed 42`); runs sim at max speed (no wall-clock sleep), prints progress + final spend; graceful stop on budget cap
- [x] `tests/engine/test_tick.lpy`: engine with ALL LLM components stubbed (deterministic intents/dialogue) — N ticks produce valid state, conversations trigger on proximity, cooldowns respected, recorder file well-formed JSONL

### Verification (Phase 4)
- nREPL: stubbed sim, `(dotimes [_ 300] (engine/tick! sim))` → state snapshot valid; ≥1 stub conversation occurred; JSONL lines parse; keyframe cadence correct
- Shell (live, capped ~$0.10): `.venv/bin/basilisp run -n agentworld.base.headless -- --minutes 2 --out /tmp/spike.jsonl --seed 42` exits 0; `/tmp/spike.jsonl` contains ≥1 real conversation event + ≥1 chronicle event; reported spend < $0.10
- Shell: `scripts/test.sh tests/engine` passes; gates exit 0

## Phase 5: Server base + browser viewer (live + replay)

- [ ] `bases/server/src/agentworld/base/server.lpy`: FastAPI app via interop — `GET /` serves viewer; `/assets/*` static; `GET /api/health` → `{"ok": true, "tick": N}`; `WS /ws/state` pushes state-atom snapshots (~10 Hz diff or full small snapshot) + event feed; `POST /api/control` `{action: start|pause|speed}`; **binds `127.0.0.1` by default (non-local bind requires explicit `--host` flag); `/api/control` requires `AGENT_WORLD_CONTROL_TOKEN` header when bound non-locally** (prevents LAN-triggered spend); runs uvicorn programmatically; sim runs in background thread at wall-clock pace (tick ~150ms)
- [ ] Phase 5 replay fixtures: generate `bases/server/resources/public/replays/smoke.jsonl` from a stubbed (no-LLM) 2-sim-minute headless run — replay-mode verification in this phase uses `?replay=/replays/smoke.jsonl`; the canonical live-LLM `demo.jsonl` is a Phase 6 artifact. Also a hand-written `replays/malicious.jsonl` fixture whose transcript/chronicle strings contain `<img src=x onerror=alert(1)>`-style HTML — verification asserts it renders as inert text (no dialog, no injected DOM)
- [ ] Viewer `bases/server/resources/public/`: `index.html`, `viewer.js`, `style.css` — canvas tile rendering (Kenney CC0 tiles fetched to `assets/`, fallback colored-rect), agent sprites w/ name labels, speech bubbles during active conversation, right panel: agent inspector (click → persona/intent/memories), Town Chronicle panel, event feed, spend HUD; **mode switch**: `?replay=<path>` param loads a JSONL replay and plays it with the same renderer + timeline scrubber/speed control — replay sources restricted to same-origin paths under `/replays/` (reject absolute/external URLs); **all LLM-derived text (transcripts, chronicle, event feed, agent names) rendered via `textContent` or canvas text APIs only, never `innerHTML`**; no build step, ES modules ok
- [ ] Playwright visual verification during dev (`mcp__playwright__*` or ascolais browser): screenshot loop against `http://localhost:8700` until the world renders correctly (tiles visible, 6 agents moving, bubble appears during conversation)
- [ ] `projects/demo/README.md`: how to run live mode; how replay build works

### Verification (Phase 5)
- Shell: server starts; `curl -s localhost:8700/` returns viewer HTML; `curl -s localhost:8700/api/health` → `{"ok":true,"tick":N}` with N increasing between two calls
- Playwright: screenshot shows rendered tile map with 6 labeled agents; a second screenshot ≥30s later shows agents at different positions; during a conversation a speech bubble is visible; replay mode (`?replay=/replays/smoke.jsonl`) renders and scrubs
- nREPL: `(server/state-snapshot)` shape `{:tick :agents :chronicle :spend}` correct

## Phase 6: Full run, replay artifact, deployment, docs

- [ ] Produce the canonical demo replay: 10-sim-minute headless run, seed chosen for lively output (≥3 conversations, ≥2 chronicle entries), spend < $0.25; bundle as `bases/server/resources/public/replays/demo.jsonl` (< 5 MB; if larger, switch recorder to keyframes+events and regenerate)
- [ ] Static export: `scripts/build_static.sh` → `dist/` containing viewer + demo replay wired as default (`index.html` auto-loads replay when no WS available); deploy `dist/` to Vercel as project `agent-world` (match sibling-demo Vercel setup: `vercel --prod` from dist or vercel.json static config); verify live URL
- [ ] Root `README.md`: hero screenshot/GIF, architecture diagram (ASCII ok), the LangGraph/AutoGen/CrewAI division-of-labor story, basilisp polylith explanation, quick start (live + replay), cost model, Kenney attribution if used, note on Microsoft Agent Framework convergence awareness
- [ ] Screenshot(s) for the portfolio site captured via Playwright and saved to `docs/screenshots/`
- [ ] Final gates: `scripts/test.sh` (full), compile_check, check_deps, and `scripts/check_public_hygiene.py dist/ bases/server/resources/public/` all green

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

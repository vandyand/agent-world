---
spec: agent-world-demo
shipped: 2026-07-02
pr: 1
tags: [basilisp, polylith, langgraph, autogen, crewai, openrouter, cost-guard, portfolio-demo, replay-first]
---

# Retro: agent-world-demo

> **Provenance.** Primary author: Claude (session memory + source material). Additive auditor: codex via `codex exec` (see `## Codex audit` section at the end). Claude-authored sections are left intact (warts and all) so the audit's value as a meta-record is preserved. No parent north star; observations input skipped.

## TL;DR — forward inference for future Claude

1. **Phase 0 REPL spikes on the riskiest seam pay for the whole plan.** The one flagged risk (autogen-ext 0.7.5 vs openai 2.x on OpenRouter) was resolved for < $0.001 in 5 minutes before any production code existed; the pre-designed fallback (isolated worker venv) was never built. Spike the single scariest integration first, with the fallback designed but unbuilt.
2. **Reservation-based cost guards must charge the reservation when a framework returns no usage metadata.** Settling $0 on missing usage silently converts fail-before-spend into fail-after-spend (codex adversary caught this, HIGH — commit 7ca3776). Rule: absent metadata → charge the worst-case reservation, never zero; an authoritative `:cost` of 0 (free models) is trusted.
3. **Verify library kwargs by executing, not by plausibility.** `num_retries` (litellm-style) passed code review but exploded at runtime because crewai 1.15's *native* OpenAI provider forwards unknown kwargs into `Completions.create()`; the correct knob was constructor `max_retries`. One tiny live call caught it instantly.
4. **Replay-first is the right public-deployment shape for LLM sims.** A 337 KB sanitized JSONL replay on static Vercel gives recruiters an always-working demo with zero hosting cost and zero key exposure; live WebSocket mode stays local. The viewer speaking both modes from day one made this free.
5. **OpenRouter returns authoritative USD `cost` in the usage block when `extra_body {"usage": {"include": true}}` is requested** — settle against that, not a price table, whenever available (Phase 0 finding, implementation-plan.md "Phase 0 Findings").

## What we built

Emberwick: a 48×32-tile simulated town where six persona-driven LLM agents walk, converse when within proximity, and get their story narrated — built as a Basilisp Polylith monorepo (9 components, 2 bases) driving LangGraph (per-agent cognition StateGraph), AutoGen (RoundRobinGroupChat proximity dialogues), and CrewAI (two-agent Town Chronicle crew) through direct Python interop, all on `google/gemini-2.5-flash-lite` behind a reservation-based cost cap. Ships as a live FastAPI+canvas viewer locally and a static replay on Vercel (https://agent-world-three.vercel.app). Key decision: headless sim → sanitized JSON state → browser canvas (Smallville pattern), with pygbag/WASM explicitly ruled out (research.md, Options 1–3).

## What worked

- **One venv for all three orchestrators** — resolver landed openai 2.44.0 / pydantic 2.12.5 exactly as the PyPI-metadata research predicted; zero conflicts all the way through (Phase 0 Findings).
- **Adversarial spec review before code** — 3 codex rounds moved concurrency discipline (in-flight flags, result queue), XSS hardening (textContent-only + malicious fixture), and bind/token security INTO the plan; implementation then hit them as ordinary tasks. The malicious.jsonl fixture passed first try in Phase 5.
- **Subagent-per-phase with orchestrator-owned verification** — every phase's report was re-verified live by the parent before commit; caught my own wrong `spawn-at` call shape (returns world, not entity) in Phase 2 rather than blaming the component.
- **Canonical call budget written into the plan** (600 ticks, cadence 20, ≤250 calls) — the real 10-minute run came in at 195 calls / $0.0113, inside the ≈$0.05–0.10 estimate (Phase 6 report).
- **stevetrading-basilisp conventions transplanted wholesale** (nrepl.sh, test.sh, compile/deps gates, no-`__init__.py` tests) — zero time lost to basilisp tooling mysteries that repo had already solved.

## What surprised

- **Codex adversary found 3 HIGH in code that had 36 green tests** (round 1, PR polish): the $0-settle cap bypass, the promised-but-missing `:free` toggle (spec Key Decisions table said ":free toggle", nobody implemented it), and quick-start commands that fail in a fresh clone (`.pth` step lived only in development/README.md). Green gates measure what you tested, not what you promised.
- **crewai's executor retries failed tasks internally** (`_handle_execution_error` re-invoked `execute_task` twice in the `num_retries` crash trace) — the adversary's "bound the retries" concern was empirically real, not theoretical.
- **Background-averse subagents**: two research/implement subagents backgrounded long pip installs and returned early, orphaning the install when they exited. Foreground-only instructions in every subsequent subagent prompt fixed it.
- **basilisp `with-redefs` needs `^:redef` metadata on the target var** (Phase 1 agent hit `Cannot redef selected Vars` live) — not in any of our reference notes; now it is.

## What we'd do differently

- Put the `:free` toggle (and every Key-Decisions-table promise) into the implementation plan as an explicit task at init time. The gap survived because the decision table and the task list were never diffed against each other.
- Give the polish adversary a scoped diff summary up front — round 1 timed out at 300s reading a whole-repo diff; the 580s/effort-high retry worked but a file-list hint would have been cheaper.
- Otherwise: exactly this again — Phase 0 spike, adversarial plan review, orchestrator-verified phases, replay-first deploy.

## Empirical metrics

| Metric | Value |
|---|---|
| Wall clock, full lifecycle (plan → polish) | ~4.5 h single session |
| Spec adversary rounds | 3 (R1: 6 findings applied; R2: 2 HIGH + 3 MED + 2 LOW applied; R3: SPEC SOUND) |
| Polish adversary rounds | 2 (R1: 3 HIGH + 1 MED + 1 LOW, 1 timeout retry; R2: CLEAN) |
| Tests at ship | 36 passed; compile/deps/hygiene gates green |
| Total LLM spend, all phases + canonical run | ≈ $0.016 (canonical 10-min run: $0.0113 / 195 calls) |
| Canonical replay artifact | 337 KB, 10 conversations, 5 chronicles, seed 42 first try |
| Reasoning errors caught externally | 4 (3 HIGH by codex polish, 1 kwarg crash by live verification) |

## Forward implications

- The **spec-promise vs task-list diff** is a repeatable audit: before baseline commit, walk the Key Decisions table and confirm each row has a task. Cheap, catches whole-feature omissions.
- **Live one-call verification after any LLM-framework constructor change** is non-negotiable — these libraries validate kwargs at call time, not construction time.
- The **basilisp polylith recipe** (basilisp.edn, brick pythonpath, .pth for `run -n`, compile/deps gate scripts, `^:redef` gotcha) is now proven in two repos; treat it as the default shape for any future basilisp project.
- **Sanitize-at-emit** (whitelist in the recorder, hygiene scanner over public artifacts) generalizes to any demo that records LLM traffic for public replay.

## References

- Spec: [README.md](README.md)
- PR: [#1](https://github.com/vandyand/agent-world/pull/1)
- Implementation commits in order: f573873, d182ffc, b8d3a76, 4c72b30, efcdc3a, baed1c9, 7ca3776
- Live demo: https://agent-world-three.vercel.app
- Related retros: none yet — first retro in this repo.

## Codex audit

### Empirical claims need correction

1. `specs/agent-world-demo/retro.md:34` says codex found 3 HIGH in code that had **36 green tests**, but the pre-polish parent of `7ca3776` (`9380f34`) has 34 `deftest` forms; `7ca3776` then adds `settle-missing-usage-charges-reservation` and `settle-free-model-zero-cost-trusted` in `tests/inference/test_cost.lpy:106` and `tests/inference/test_cost.lpy:120`, bringing ship to 36. Sharpen to: "codex found 3 HIGH in code with 34 green tests; the fix commit added 2 regression tests, so ship had 36."

2. `specs/agent-world-demo/retro.md:50` reports `Spec adversary rounds | 3 ... R3: SPEC SOUND`, but committed source material only shows two adversarial-review commits (`f40e3a1`, `8d4c0ba`) and no `SPEC SOUND` artifact. Either add the PR comment URL/session transcript for R3, or rewrite the metric as "2 committed spec-review rounds; third clean pass came from session memory."

### Misframed external catches

3. `specs/agent-world-demo/retro.md:55` labels all 4 reasoning errors as "caught externally" while one is explicitly "1 kwarg crash by live verification"; `specs/agent-world-demo/retro.md:16` also frames that as a live call, not an external reviewer catch. Split the metric into "3 externally caught by codex polish" and "1 empirically caught by live verification", and add a source for the `num_retries` crash if it should remain in the empirical table.

Codex audit verdict: 3 findings.

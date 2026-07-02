---
title: "Agent World Demo"
status: in-progress
date: 2026-07-02
priority: 10
---

# Agent World Demo

## Overview

A simulated 2D pixel town where LLM-powered agents walk around and converse when they come within proximity of each other — built as a **Basilisp (Clojure-on-Python) Polylith monorepo** that genuinely drives **LangGraph** (per-agent cognition), **AutoGen** (proximity conversations), and **CrewAI** (periodic "Town Chronicle" narration) through Python interop, with all LLM calls on a very cheap OpenRouter model behind a hard cost cap.

Purpose: a flagship portfolio demo targeting Upwork jobs that name LangGraph/AutoGen/CrewAI, showcased on the rewritten vandykeportfolio.com. Full background in [research.md](research.md).

## Goals

- Headless sim engine in Basilisp: tile world, personas, deterministic locomotion, LLM-decided intents, proximity-triggered dialogues, chronicle narration.
- Browser viewer (plain HTML/canvas/JS, no build step): pixel-art rendering, speech bubbles, agent inspector, chronicle panel, spend HUD.
- **Replay-first deployment**: headless run records JSONL; viewer plays the bundled replay statically on Vercel (always works publicly). Live WebSocket mode for local/interview runs.
- Cost guard: true fail-before-spend — preflight cost estimate (prompt size + bounded `max_tokens`) checked against the cap (`AGENT_WORLD_MAX_SPEND_USD`, default $1.00) BEFORE each call, actuals reconciled after; canonical 10-sim-minute run budgeted ≤ ~250 LLM calls ≈ $0.05–0.10, claimed < $0.25.
- Polylith discipline enforced by `scripts/compile_check.py` + `scripts/check_deps.py` (conventions from `stevetrading-basilisp`).

## Non-Goals

- No in-browser Python (pygbag/WASM ruled out — no sockets, CORS/API-key exposure).
- No public hosting of the live Python server in v1 (replay is the public artifact; live hosting addable later without rearchitecting).
- No pathfinding sophistication beyond greedy/A* on a small grid; no procedural map generation.
- No user-authored agents/UI editing in v1.

## Key Decisions

See [research.md](research.md) for full options analysis.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sim framework | pygame-ce (headless, `SDL_VIDEODRIVER=dummy`), logic-first | Maintained lineage; trivial headless; Smallville-style state-streaming beats frame rendering |
| Architecture | Headless sim → JSON state → browser canvas viewer | Stanford Generative Agents / AI Town precedent; keys stay server-side |
| Repo shape | Basilisp Polylith, manual conventions + 2 gate scripts | python-polylith CLI can't parse `.lpy`; proven locally in stevetrading-basilisp |
| Orchestrators | LangGraph=cognition, AutoGen=dialogues, CrewAI=chronicle, one venv | Genuine division of labor; PyPI resolver confirms coexistence (openai ~2.30, pydantic <2.13) |
| AutoGen risk | Phase 0 smoke vs OpenRouter; fallback = isolated worker venv over stdio JSON | autogen-ext 0.7.5 untested with openai 2.x per its own docs |
| Model | `google/gemini-2.5-flash-lite` ($0.10/$0.40 per Mtok) default; `:free` toggle | Cheapest solid roleplay quality; free tier too throttled for busy world but fine for short runs |
| Public deployment | Static replay on Vercel; live mode local-only | Recruiters never hit a dead server; zero hosting cost |
| Viewer | Plain HTML/canvas/JS, no build step | Simplest workable; matches "prefer simple" working style |
| Art | Kenney CC0 tileset (fallback: intentional colored-rect pixel style) | Zero licensing risk, fast |

## Implementation Status

See [implementation-plan.md](implementation-plan.md) for detailed task breakdown.

- [ ] Phase 0: REPL spike — prove the risky seams
- [ ] Phase 1: Repo skeleton + polylith gates + inference/cost-guard component
- [ ] Phase 2: World + persona + memory components (pure sim, no LLM)
- [ ] Phase 3: Cognition (LangGraph) + conversation (AutoGen) + chronicle (CrewAI)
- [ ] Phase 4: Engine tick loop + recorder + headless base
- [ ] Phase 5: Server base + browser viewer (live + replay modes)
- [ ] Phase 6: Full-run polish, replay artifact, deployment, README

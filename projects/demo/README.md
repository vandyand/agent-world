# Agent World — demo project

How to run the Emberwick demo: live mode (real sim + viewer) and replay
mode (zero-backend playback of a recorded run). All commands from the repo
root (`/home/kingjames/vandykeportfolio/agent-world`).

> **One-time setup for `basilisp run -n`:** generate the brick `.pth` file so
> the polylith src dirs are importable (see the root README quick start or
> `development/README.md`).

## Live mode

```bash
# real LLM decisions/conversations/chronicle (needs OPENROUTER_API_KEY):
.venv/bin/basilisp run -n agentworld.base.server -- --port 8700 --seed 42

# no-LLM smoke mode (deterministic stubs, zero spend):
.venv/bin/basilisp run -n agentworld.base.server -- --port 8700 --stub --seed 42
```

Open <http://127.0.0.1:8700/>. The sim ticks on a background thread at
wall-clock pace (~150 ms/tick; `--tick-ms` to change), and the viewer
consumes JSON snapshots over `WS /ws/state` at ~10 Hz. Top-bar controls
post to `/api/control` (`start` / `pause` / `speed`).

Spend is capped by the cost guard (`AGENT_WORLD_MAX_SPEND_USD`, default
$1.00) — when the cap trips, the sim stops enqueueing LLM work and the
viewer badge shows "budget cap hit".

### Security posture

- Binds `127.0.0.1` by default. A non-local `--host` REQUIRES the
  `AGENT_WORLD_CONTROL_TOKEN` env var (the server refuses to start
  without it), and `/api/control` then demands a matching
  `Agent-World-Control-Token` header — nobody on the LAN gets to trigger
  LLM spend.
- Every event the viewer sees passed through the recorder sanitizer
  (field whitelist; prompts/keys structurally excluded).
- The viewer renders all LLM-derived text via `textContent` / canvas
  `fillText` only — see `replays/malicious.jsonl` for the fixture that
  proves HTML payloads stay inert.

## Replay mode

Same viewer, no backend required:

```
http://127.0.0.1:8700/?replay=/replays/smoke.jsonl
```

On pure static hosting (e.g. the Vercel deploy at
<https://agent-world-three.vercel.app>, built by
`scripts/build_static.sh` → `dist/`), no `?replay=` param is needed: when
the first WebSocket attempt fails and `/replays/demo.jsonl` exists, the
viewer auto-falls-back to playing the bundled canonical replay.

- Replay sources are restricted to same-origin `/replays/<name>.jsonl`
  paths — absolute/external URLs are rejected client-side.
- Playback drives the exact same renderer, plus a timeline scrubber,
  play/pause, and speed control (0.5–4×). Scrubbing backward rebuilds
  state from tick 0 (events are cheap).

### Producing a replay

```bash
# stubbed (free) — this is how the bundled smoke.jsonl was made:
.venv/bin/basilisp run -n agentworld.base.headless -- \
    --minutes 2 --out bases/server/resources/public/replays/smoke.jsonl \
    --seed 42 --stub

# live-LLM canonical demo replay (Phase 6 artifact):
.venv/bin/basilisp run -n agentworld.base.headless -- \
    --minutes 10 --out bases/server/resources/public/replays/demo.jsonl --seed 42
```

Replay JSONL events are sanitized at the emit boundary (whitelisted
fields only) and gate-checked by `scripts/check_public_hygiene.py`.

### Bundled fixtures

| File | Purpose |
|---|---|
| `replays/smoke.jsonl` | 2 stub sim-minutes; replay-mode verification |
| `replays/malicious.jsonl` | hand-written XSS probes (`<script>`, `onerror=` payloads in names/transcripts/chronicle); must render as inert text |

## Map data

The viewer fetches world geometry from `GET /api/map`
(`{width, height, blocked, places}`). For static hosting (no API), it
falls back to `/assets/map.json` — a snapshot of the same endpoint,
regenerate with:

```bash
curl -s http://127.0.0.1:8700/api/map > bases/server/resources/public/assets/map.json
```

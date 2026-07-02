/* Agent World viewer — live (WebSocket) + replay (JSONL) modes, one renderer.
 *
 * SECURITY INVARIANTS:
 *  - ALL LLM-derived text (names, transcripts, chronicle, event feed,
 *    memories, intents) is rendered via textContent or canvas fillText.
 *    No innerHTML anywhere in this module.
 *  - Replay sources are restricted to same-origin paths that match
 *    /replays/<name>.jsonl — absolute/external URLs are rejected.
 *
 * MAP DATA: fetched from GET /api/map (live server). When the API is
 * absent (static replay hosting), it falls back to the bundled snapshot
 * at /assets/map.json (exported from the same endpoint).
 */

const TILE = 16;
const TICK_MS = 150;          // canonical live pace: 1 tick ≈ 150 ms
const BUBBLE_TICKS = 45;      // replay: show a conversation bubble this long
const BUBBLE_LIVE_MS = 12000; // live: max bubble lifetime
const LINE_CYCLE_MS = 1800;   // transcript line cycle cadence

const AGENT_COLORS = {
  mara: "#f2c14e", theo: "#c0504d", isolde: "#4aa6b9",
  bram: "#9b6bb3", cass: "#58b368", otto: "#e07b39",
};
const FALLBACK_COLORS = ["#f2c14e", "#c0504d", "#4aa6b9", "#9b6bb3", "#58b368", "#e07b39"];

// ---------------------------------------------------------------------------
// DOM handles + safe DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $("world");
const ctx = canvas.getContext("2d");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text); // textContent ONLY
  return e;
}

// ---------------------------------------------------------------------------
// Shared render state (fed by live WS or the replay player)
// ---------------------------------------------------------------------------

const state = {
  mode: "live",            // "live" | "replay"
  map: null,               // {width,height,blocked:[[x,y]..],places:{name:{rect}}}
  tileTypes: null,         // per-tile classification cache
  agents: new Map(),       // id -> {id,name,pos,facing,state,rx,ry,moving}
  activeConversation: null,
  chronicle: "",
  spend: { usd: 0, calls: 0 },
  feed: [],                // [{key,tick,type,text}]
  bubbles: [],             // [{names:[a,b],lines:[{speaker,text}],tick,bornMs}]
  tick: 0,
  selectedAgent: null,
  lastIntents: new Map(),  // id -> intent event (replay inspector)
  lastConvos: new Map(),   // name -> summary (replay inspector)
};

// read-only debug/verification hook (positions, tick, mode)
globalThis.__aw = state;

// ---------------------------------------------------------------------------
// Map loading + tile classification (colored-rect pixel style)
// ---------------------------------------------------------------------------

async function loadMap() {
  try {
    const r = await fetch("/api/map");
    if (r.ok) return await r.json();
  } catch (_e) { /* fall through to bundled snapshot */ }
  const r2 = await fetch("/assets/map.json");
  if (!r2.ok) throw new Error("no map data available");
  return await r2.json();
}

function rectContains(rect, x, y, grow = 0) {
  const [rx, ry, rw, rh] = rect;
  return x >= rx - grow && x < rx + rw + grow &&
         y >= ry - grow && y < ry + rh + grow;
}

function placeAt(map, x, y, grow = 0) {
  for (const [name, p] of Object.entries(map.places)) {
    if (rectContains(p.rect, x, y, grow)) return name;
  }
  return null;
}

function classifyTiles(map) {
  const blocked = new Set(map.blocked.map(([x, y]) => x + "," + y));
  const types = [];
  for (let y = 0; y < map.height; y++) {
    const row = [];
    for (let x = 0; x < map.width; x++) {
      row.push(classifyTile(map, blocked, x, y));
    }
    types.push(row);
  }
  return types;
}

function classifyTile(map, blocked, x, y) {
  const isBlocked = blocked.has(x + "," + y);
  const place = placeAt(map, x, y);
  const nearBuilding =
    (map.places.tavern && rectContains(map.places.tavern.rect, x, y, 1)) ||
    (map.places.smithy && rectContains(map.places.smithy.rect, x, y, 1));
  if (isBlocked) {
    if (x >= map.width - 5) return "water";
    if (x === 0 || y === 0 || y === map.height - 1) return "tree";
    if (place === "square") return "well";
    if (place === "market") return "stall";
    if (place === "garden") return "bush";
    if (nearBuilding) return "wall";
    return "tree";
  }
  if (place === "square") return "plaza";
  if (place === "market") return "dirt";
  if (place === "garden") return "garden";
  if (place === "dock" || x >= map.width - 5) return "pier";
  if (place === "tavern" || place === "smithy") return "floor";
  if (nearBuilding) return "door";
  return "grass";
}

// deterministic per-tile hash for subtle texture variation
const th = (x, y) => ((x * 73 + y * 151 + ((x * y) | 0) * 29) >>> 0) % 97;

const PALETTE = {
  grass: (h) => (h % 3 === 0 ? "#3a6636" : h % 3 === 1 ? "#3e6b3a" : "#446f3e"),
  plaza: (h) => (h % 2 === 0 ? "#8a8177" : "#948b80"),
  dirt:  (h) => (h % 2 === 0 ? "#7a6a4a" : "#827150"),
  garden:(h) => (h % 4 === 0 ? "#4a7a42" : "#446f3e"),
  pier:  (h) => (h % 2 === 0 ? "#8a6844" : "#82613f"),
  floor: (h) => (h % 2 === 0 ? "#9c7b4f" : "#a58455"),
  door:  ( ) => "#8f7448",
  water: (h) => (h % 5 === 0 ? "#35709f" : "#2b5d8a"),
  tree:  ( ) => "#1f4a26",
  bush:  ( ) => "#2d5a33",
  wall:  ( ) => "#6e5140",
  stall: (h) => (h % 2 === 0 ? "#b0413e" : "#b08a3e"),
  well:  ( ) => "#7d7f85",
};
const RAISED = new Set(["tree", "bush", "wall", "stall", "well"]);

function drawTile(g, x, y, type) {
  const h = th(x, y);
  const px = x * TILE, py = y * TILE;
  g.fillStyle = (PALETTE[type] || PALETTE.grass)(h);
  g.fillRect(px, py, TILE, TILE);

  // 1px inset shading — deliberate pixel-art read
  if (RAISED.has(type)) {
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(px, py, TILE, 1);
    g.fillRect(px, py, 1, TILE);
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.fillRect(px, py + TILE - 1, TILE, 1);
    g.fillRect(px + TILE - 1, py, 1, TILE);
  } else if (type !== "water") {
    g.fillStyle = "rgba(0,0,0,0.06)";
    g.fillRect(px, py + TILE - 1, TILE, 1);
  }

  // tile-type detailing (still plain rects — intentional pixel style)
  if (type === "tree") {
    g.fillStyle = "#2d6a35";
    g.fillRect(px + 3, py + 2, 10, 8);
    g.fillStyle = "#5a3d24";
    g.fillRect(px + 7, py + 10, 3, 5);
  } else if (type === "bush") {
    g.fillStyle = "#3f7a48";
    g.fillRect(px + 3, py + 4, 10, 9);
  } else if (type === "well") {
    g.fillStyle = "#5b5d63";
    g.fillRect(px + 2, py + 2, 12, 12);
    g.fillStyle = "#274a6b";
    g.fillRect(px + 5, py + 5, 6, 6);
  } else if (type === "stall") {
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(px + 2, py + 2, 12, 3);
  } else if (type === "water" && h % 7 === 0) {
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.fillRect(px + (h % 8), py + (h % 11), 4, 1);
  } else if (type === "garden" && h % 6 === 0) {
    g.fillStyle = h % 12 === 0 ? "#d967a8" : "#e0c953";
    g.fillRect(px + (h % 10) + 2, py + (h % 9) + 3, 2, 2);
  } else if (type === "pier") {
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(px, py + ((y % 2) ? 7 : 12), TILE, 1);
  } else if (type === "plaza") {
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fillRect(px + (h % 2 ? 0 : 8), py + 7, 7, 1);
  }
}

let mapLayer = null; // offscreen canvas with the static map pre-rendered

function renderMapLayer() {
  mapLayer = document.createElement("canvas");
  mapLayer.width = state.map.width * TILE;
  mapLayer.height = state.map.height * TILE;
  const off = mapLayer.getContext("2d");
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      drawTile(off, x, y, state.tileTypes[y][x]);
    }
  }
}

// ---------------------------------------------------------------------------
// Agents + sprites
// ---------------------------------------------------------------------------

function agentColor(id, idx) {
  return AGENT_COLORS[id] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function upsertAgent(a) {
  const id = String(a.id);
  let ag = state.agents.get(id);
  if (!ag) {
    ag = { id, rx: a.pos[0], ry: a.pos[1] };
    state.agents.set(id, ag);
  }
  ag.name = a.name != null ? String(a.name) : id;
  ag.pos = a.pos;
  ag.facing = a.facing || "south";
  ag.state = a.state || "idle";
  return ag;
}

function drawAgents(nowMs) {
  const list = [...state.agents.values()];
  list.forEach((a, idx) => {
    // ease render position toward the authoritative tile position
    a.rx += (a.pos[0] - a.rx) * 0.25;
    a.ry += (a.pos[1] - a.ry) * 0.25;
    a.moving = Math.abs(a.pos[0] - a.rx) + Math.abs(a.pos[1] - a.ry) > 0.05 ||
               a.state === "moving" || a.state === "wandering";
    drawAgentSprite(a, idx, nowMs);
  });
  // labels on top of all sprites
  list.forEach((a) => drawAgentLabel(a));
}

function drawAgentSprite(a, idx, nowMs) {
  const px = a.rx * TILE, py = a.ry * TILE;
  const color = agentColor(a.id, idx);
  const bob = a.moving ? Math.floor(nowMs / 250) % 2 : 0; // 2-frame walk bob
  const sel = state.selectedAgent === a.id;

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillRect(px + 3, py + 13, 10, 2);

  // legs (alternate with bob)
  ctx.fillStyle = "#2b2b33";
  if (a.moving && bob) {
    ctx.fillRect(px + 4, py + 10, 3, 4);
    ctx.fillRect(px + 9, py + 11, 3, 3);
  } else {
    ctx.fillRect(px + 4, py + 11, 3, 3);
    ctx.fillRect(px + 9, py + 10 + (a.moving ? 0 : 1), 3, 3);
  }

  // body
  ctx.fillStyle = color;
  ctx.fillRect(px + 3, py + 5 - bob, 10, 6);
  ctx.fillStyle = "rgba(0,0,0,0.22)"; // body shading
  ctx.fillRect(px + 3, py + 9 - bob, 10, 2);

  // head
  ctx.fillStyle = "#eab88f";
  ctx.fillRect(px + 4, py + 1 - bob, 8, 5);
  ctx.fillStyle = shade(color, -40); // hair
  ctx.fillRect(px + 4, py - bob, 8, 2);

  // facing: eye pixels
  ctx.fillStyle = "#22252a";
  const ey = py + 3 - bob;
  if (a.facing === "south") { ctx.fillRect(px + 6, ey, 1, 1); ctx.fillRect(px + 9, ey, 1, 1); }
  else if (a.facing === "east") { ctx.fillRect(px + 10, ey, 1, 1); }
  else if (a.facing === "west") { ctx.fillRect(px + 5, ey, 1, 1); }
  // north: back of head — no eyes

  if (sel) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1.5, py - 1.5 - bob, 13, 17);
  }
}

function drawAgentLabel(a) {
  const px = a.rx * TILE + TILE / 2;
  const py = a.ry * TILE - 4;
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  const w = ctx.measureText(a.name).width + 6;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(px - w / 2, py - 9, w, 11);
  ctx.fillStyle = "#f0f0e8";
  ctx.fillText(a.name, px, py); // canvas text — inert by construction
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  const r = c(n >> 16), g = c((n >> 8) & 0xff), b = c(n & 0xff);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Speech bubbles (canvas fillText only)
// ---------------------------------------------------------------------------

function bubbleAnchor(names) {
  const ags = [...state.agents.values()].filter((a) => names.includes(a.name));
  if (!ags.length) return null;
  const x = ags.reduce((s, a) => s + a.rx, 0) / ags.length;
  const y = Math.min(...ags.map((a) => a.ry));
  return [x * TILE + TILE / 2, y * TILE - 14];
}

function liveBubbleAlive(b, nowMs) {
  const span = Math.min(BUBBLE_LIVE_MS, b.lines.length * LINE_CYCLE_MS + 2500);
  return nowMs - b.bornMs < span;
}

function replayBubbleAlive(b) {
  return state.tick >= b.tick && state.tick - b.tick < BUBBLE_TICKS;
}

function drawBubbles(nowMs) {
  state.bubbles = state.bubbles.filter((b) =>
    state.mode === "live" ? liveBubbleAlive(b, nowMs) : replayBubbleAlive(b));
  for (const b of state.bubbles) {
    const anchor = bubbleAnchor(b.names);
    if (!anchor) continue;
    const elapsed = state.mode === "live"
      ? nowMs - b.bornMs
      : (state.tick - b.tick) * TICK_MS;
    const i = Math.max(0, Math.floor(elapsed / LINE_CYCLE_MS)) % b.lines.length;
    const line = b.lines[i];
    drawBubble(anchor, `${line.speaker}: ${line.text}`);
  }
  // live: "..." bubble while a conversation is still in flight
  if (state.mode === "live" && state.activeConversation) {
    const { a, b } = state.activeConversation;
    const anchor = bubbleAnchor([String(a), String(b)]);
    if (anchor) drawBubble(anchor, "…");
  }
}

function drawBubble([ax, ay], text) {
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  const maxW = 200;
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (ctx.measureText(trial).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = trial;
    if (lines.length >= 3) break;
  }
  if (cur && lines.length < 3) lines.push(cur);
  if (lines.length === 3 && words.join(" ").length > lines.join(" ").length) {
    lines[2] += "…";
  }
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 12;
  const h = lines.length * 12 + 8;
  let bx = ax - w / 2, by = ay - h;
  bx = Math.max(2, Math.min(canvas.width - w - 2, bx));
  by = Math.max(2, by);

  ctx.fillStyle = "rgba(250,250,240,0.95)";
  ctx.fillRect(bx, by, w, h);
  ctx.strokeStyle = "rgba(20,20,20,0.8)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
  // tail
  ctx.fillStyle = "rgba(250,250,240,0.95)";
  ctx.beginPath();
  ctx.moveTo(ax - 4, by + h);
  ctx.lineTo(ax + 4, by + h);
  ctx.lineTo(ax, by + h + 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1c1c22";
  lines.forEach((l, i) => ctx.fillText(l, bx + 6, by + 13 + i * 12));
}

// ---------------------------------------------------------------------------
// Event feed + panels (textContent-only DOM)
// ---------------------------------------------------------------------------

function eventText(ev) {
  switch (ev.type) {
    case "intent": {
      let s = `${ev.name} → ${ev.action}`;
      if (ev.place) s += ` ${ev.place}`;
      if (ev.target) s += ` ${ev.target}`;
      if (ev.reason) s += ` — ${ev.reason}`;
      return s;
    }
    case "conversation":
      return `${ev.a} & ${ev.b} talked at the ${ev.place}: ${ev.summary ?? ""}`;
    case "chronicle":
      return "Town Chronicle updated";
    case "spend":
      return `spend $${Number(ev["total-usd"] ?? 0).toFixed(4)} (${ev.calls} calls)`;
    default:
      return ev.type;
  }
}

function eventKey(ev) {
  return `${ev.type}:${ev.tick}:${ev.id ?? ""}:${ev.a ?? ""}:${ev.b ?? ""}`;
}

const seenEvents = new Set();

function pushFeed(ev) {
  const key = eventKey(ev);
  if (seenEvents.has(key)) return false;
  seenEvents.add(key);
  state.feed.push({ key, tick: ev.tick, type: ev.type, text: eventText(ev) });
  if (state.feed.length > 30) state.feed.splice(0, state.feed.length - 30);
  renderFeed();
  return true;
}

function renderFeed() {
  const ul = $("feed-list");
  ul.replaceChildren();
  for (let i = state.feed.length - 1; i >= 0; i--) {
    const f = state.feed[i];
    const li = el("li", "ev-" + f.type);
    li.appendChild(el("span", "ev-tick", "t" + f.tick));
    li.appendChild(document.createTextNode(f.text)); // inert text node
    ul.appendChild(li);
  }
}

function renderChronicle() {
  const p = $("chronicle-text");
  if (state.chronicle) {
    p.classList.remove("hint");
    p.textContent = state.chronicle;
  } else {
    p.classList.add("hint");
    p.textContent = "No chronicle yet.";
  }
}

function renderSpend() {
  $("spend-usd").textContent = "$" + Number(state.spend.usd || 0).toFixed(4);
  $("spend-calls").textContent = (state.spend.calls || 0) + " calls";
}

function inspectorRow(dl, label, value) {
  dl.appendChild(el("dt", null, label));
  dl.appendChild(el("dd", null, value));
}

async function showInspector(agentId) {
  state.selectedAgent = agentId;
  const body = $("inspector-body");
  body.replaceChildren();
  const ag = state.agents.get(agentId);
  if (!ag) { body.appendChild(el("p", "hint", "Agent not found.")); return; }

  body.appendChild(el("p", "agent-name", ag.name));
  const dl = el("dl");
  body.appendChild(dl);
  inspectorRow(dl, "position", `[${ag.pos[0]}, ${ag.pos[1]}] facing ${ag.facing}`);
  inspectorRow(dl, "state", ag.state);

  if (state.mode === "live") {
    try {
      const r = await fetch(`/api/agent/${encodeURIComponent(agentId)}`);
      if (r.ok) {
        const d = await r.json();
        if (state.selectedAgent !== agentId) return; // clicked elsewhere since
        const p = d.persona || {};
        inspectorRow(dl, "occupation", p.occupation ?? "?");
        inspectorRow(dl, "personality", p.personality ?? "?");
        inspectorRow(dl, "goal", p.goal ?? "?");
        const li = d["last-intent"];
        if (li) inspectorRow(dl, "current intent", eventText(li));
        const mems = d.memories || [];
        if (mems.length) {
          dl.appendChild(el("dt", null, "recent memories"));
          const dd = el("dd");
          const ul = el("ul");
          mems.forEach((m) => ul.appendChild(el("li", null, m)));
          dd.appendChild(ul);
          dl.appendChild(dd);
        }
      }
    } catch (_e) { /* panel stays with local info */ }
  } else {
    const li = state.lastIntents.get(agentId);
    if (li) inspectorRow(dl, "last intent", eventText(li));
    const convo = state.lastConvos.get(ag.name);
    if (convo) inspectorRow(dl, "last conversation", convo);
  }
}

canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width / r.width, scaleY = canvas.height / r.height;
  const tx = ((e.clientX - r.left) * scaleX) / TILE;
  const ty = ((e.clientY - r.top) * scaleY) / TILE;
  let best = null, bestD = 1.6;
  for (const a of state.agents.values()) {
    const d = Math.hypot(a.rx + 0.5 - tx, a.ry + 0.5 - ty);
    if (d < bestD) { best = a; bestD = d; }
  }
  if (best) showInspector(best.id);
});

// ---------------------------------------------------------------------------
// Live mode (WebSocket)
// ---------------------------------------------------------------------------

function applyStatePayload(s) {
  state.tick = s.tick || 0;
  (s.agents || []).forEach(upsertAgent);
  state.activeConversation = s["active-conversation"] || null;
  if (s.chronicle != null) state.chronicle = String(s.chronicle);
  const sp = s.spend || {};
  state.spend = { usd: sp["total-usd"] || 0, calls: sp.calls || 0 };
  for (const ev of s.events || []) {
    const isNew = pushFeed(ev);
    if (isNew && ev.type === "conversation" && Array.isArray(ev.transcript)) {
      state.bubbles.push({
        names: [String(ev.a), String(ev.b)],
        lines: ev.transcript.map((t) => ({
          speaker: String(t.speaker ?? "?"), text: String(t.text ?? ""),
        })),
        tick: ev.tick,
        bornMs: performance.now(),
      });
    }
    if (isNew && ev.type === "intent") state.lastIntents.set(String(ev.id), ev);
  }
  renderChronicle();
  renderSpend();
  if (s["budget-exceeded"]) setBadge("budget cap hit", "err");
}

function setBadge(text, cls) {
  const b = $("mode-badge");
  b.textContent = text;
  b.className = "badge" + (cls ? " " + cls : "");
}

function startLive() {
  state.mode = "live";
  $("live-controls").hidden = false;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  let ws;
  const connect = () => {
    ws = new WebSocket(`${proto}//${location.host}/ws/state`);
    ws.onopen = () => setBadge("live", "live");
    ws.onmessage = (m) => {
      try { applyStatePayload(JSON.parse(m.data)); }
      catch (e) { console.error("bad state payload", e); }
    };
    ws.onclose = () => { setBadge("disconnected — retrying", "err"); setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
  };
  connect();

  let paused = false;
  $("btn-pause").addEventListener("click", async () => {
    paused = !paused;
    $("btn-pause").textContent = paused ? "Resume" : "Pause";
    await postControl({ action: paused ? "pause" : "start" });
  });
  $("live-speed").addEventListener("change", async (e) => {
    await postControl({ action: "speed", value: Number(e.target.value) });
  });
}

async function postControl(body) {
  try {
    await fetch("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) { console.error("control failed", e); }
}

// ---------------------------------------------------------------------------
// Replay mode (same renderer, timeline scrubber + speed + play/pause)
// ---------------------------------------------------------------------------

function validReplayPath(p) {
  // same-origin, single path segment under /replays/, .jsonl only —
  // rejects absolute/external URLs, protocol-relative, and traversal.
  return typeof p === "string" && /^\/replays\/[A-Za-z0-9._-]+\.jsonl$/.test(p) &&
         !p.includes("..");
}

const player = {
  events: [],
  maxTick: 0,
  cursor: 0,       // next event index to apply
  current: 0,      // current playback tick (float)
  playing: true,
  speed: 1,
};

async function startReplay(path) {
  state.mode = "replay";
  $("replay-bar").hidden = false;
  setBadge("replay — " + path.split("/").pop(), "replay");

  const r = await fetch(path);
  if (!r.ok) { setBadge("replay not found", "err"); return; }
  const text = await r.text();
  player.events = text.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  player.maxTick = player.events.reduce((m, e) => Math.max(m, e.tick || 0), 0);
  $("scrubber").max = String(player.maxTick);
  resetReplayState();

  $("btn-play").addEventListener("click", () => {
    player.playing = !player.playing;
    $("btn-play").textContent = player.playing ? "Pause" : "Play";
  });
  $("replay-speed").addEventListener("change", (e) => {
    player.speed = Number(e.target.value) || 1;
  });
  $("scrubber").addEventListener("input", (e) => {
    seekReplay(Number(e.target.value));
  });
}

function resetReplayState() {
  player.cursor = 0;
  player.current = 0;
  state.agents.clear();
  state.bubbles = [];
  state.feed = [];
  seenEvents.clear();
  state.chronicle = "";
  state.spend = { usd: 0, calls: 0 };
  state.lastIntents.clear();
  state.lastConvos.clear();
  state.activeConversation = null;
  renderFeed(); renderChronicle(); renderSpend();
}

function applyReplayEvent(ev) {
  switch (ev.type) {
    case "tick-state":
      (ev.agents || []).forEach(upsertAgent);
      if (ev.chronicle != null) { state.chronicle = String(ev.chronicle); renderChronicle(); }
      if (ev.spend) { state.spend = { usd: ev.spend["total-usd"] || 0, calls: ev.spend.calls || 0 }; renderSpend(); }
      break;
    case "move":
      upsertAgent(ev);
      break;
    case "intent":
      pushFeed(ev);
      state.lastIntents.set(String(ev.id), ev);
      break;
    case "conversation":
      pushFeed(ev);
      if (Array.isArray(ev.transcript)) {
        state.bubbles.push({
          names: [String(ev.a), String(ev.b)],
          lines: ev.transcript.map((t) => ({
            speaker: String(t.speaker ?? "?"), text: String(t.text ?? ""),
          })),
          tick: ev.tick || 0,
          bornMs: performance.now(),
        });
      }
      if (ev.summary != null) {
        state.lastConvos.set(String(ev.a), String(ev.summary));
        state.lastConvos.set(String(ev.b), String(ev.summary));
      }
      break;
    case "chronicle":
      state.chronicle = String(ev.text ?? "");
      renderChronicle();
      pushFeed(ev);
      break;
    case "spend":
      state.spend = { usd: ev["total-usd"] || 0, calls: ev.calls || 0 };
      renderSpend();
      break;
  }
}

function advanceReplayTo(tick) {
  while (player.cursor < player.events.length &&
         (player.events[player.cursor].tick || 0) <= tick) {
    applyReplayEvent(player.events[player.cursor]);
    player.cursor++;
  }
  state.tick = Math.floor(tick);
  $("tick-label").textContent = `tick ${state.tick}/${player.maxTick}`;
  if (document.activeElement !== $("scrubber")) {
    $("scrubber").value = String(state.tick);
  }
}

function seekReplay(tick) {
  if (tick < player.current) {
    resetReplayState(); // rebuild from t=0 (cheap: a few thousand events)
  }
  player.current = tick;
  advanceReplayTo(tick);
  // snap agents to their authoritative positions after a seek
  for (const a of state.agents.values()) { a.rx = a.pos[0]; a.ry = a.pos[1]; }
}

function tickReplay(dtMs) {
  if (!player.playing || player.current >= player.maxTick) return;
  player.current = Math.min(player.maxTick,
    player.current + (dtMs / TICK_MS) * player.speed);
  advanceReplayTo(player.current);
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastFrame = performance.now();

function frame(nowMs) {
  const dt = Math.min(100, nowMs - lastFrame);
  lastFrame = nowMs;
  if (state.mode === "replay") tickReplay(dt);

  if (state.map) {
    if (mapLayer) ctx.drawImage(mapLayer, 0, 0);
    drawAgents(nowMs);
    drawBubbles(nowMs);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  state.map = await loadMap();
  canvas.width = state.map.width * TILE;
  canvas.height = state.map.height * TILE;
  state.tileTypes = classifyTiles(state.map);
  renderMapLayer();

  const replayParam = new URLSearchParams(location.search).get("replay");
  if (replayParam != null) {
    if (!validReplayPath(replayParam)) {
      setBadge("invalid replay path rejected", "err");
      console.error("rejected replay source (must be /replays/<name>.jsonl):", replayParam);
    } else {
      await startReplay(replayParam);
    }
  } else {
    startLive();
  }
  requestAnimationFrame(frame);
}

main().catch((e) => {
  setBadge("failed to start", "err");
  console.error(e);
});

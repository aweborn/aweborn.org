/**
 * World Planner (Phase 07): a chat that shapes a blueprint before anything
 * is made.
 *
 *   POST /api/player/plan  { sessionId?, worldId, message, model? }
 *     → { sessionId, version, reply, chips, blueprint, model, mana } | 402 | 502
 *
 * Every turn is a paid request: reserve PLAN_ESTIMATE_MANA at admission,
 * settle the billed OpenRouter cost (× K = 100), release on failure. The
 * conversation history is held here (the client can't write assistant
 * turns) and every turn, raw response and blueprint version is saved
 * (plan_sessions / plan_events) for research replay. The LLM's answer is validated with shared/blueprint.ts; one repair
 * retry inside the same hold if it doesn't parse.
 */
import { randomUUID } from "node:crypto";
import type { RoomManager } from "./rooms.js";
import { getDb } from "./persistence.js";
import { startJob } from "./creations.js";
import type { PlayerProgress } from "../../../shared/crdt-schema.js";
import { estimate, parsePlannerTurn, parseEdit, applyEdit, extractJson, LIMITS, ASSET_MANA, type Blueprint, type BlueprintDraft, type BlueprintEdit } from "../../../shared/blueprint.js";
import { checkCreation, chargeCheck, type SafetyVerdict } from "./safety.js";
import { researchIdFor } from "./research.js";

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";

/** Opus turn with history ≈ $0.03–0.08; settle charges the real cost either way. */
export const PLAN_ESTIMATE_MANA = 10;

/** Models offered in the picker (OpenRouter ids). First = default. */
export const PLANNER_MODELS = [
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "google/gemini-4-argon",
  "moonshotai/kimi-k3",
  "openai/gpt-5.6-terra",
  "x-ai/grok-4.7",
  "anthropic/claude-haiku-5.5",
] as const;

/** The character's chapter/level for admission (Rough Draft M3: was a provisional "everyone is chapter 5"). */
const progressOf = (rooms: RoomManager, playerId: string): PlayerProgress => rooms.progress.playerProgress(playerId);
const MAX_TURNS = 40; // history kept per session (oldest dropped)

export const PLANNER_SYSTEM = `You are the world planner in Aweborn, a shared universe where players dream up small worlds and they become real.
You never make art yourself. You write a BLUEPRINT that cheaper specialist generators carry out: a deterministic voxel terrain plus a list of assets (3D models, sounds, music).

YOUR VOICE
- A quiet companion, not a salesperson. The world is the player's; you help them find it.
- Short: one to three sentences. The preview shows what changed, so your words don't have to.
- Ask at most one question, and only one worth asking. Prefer senses and feelings ("What do you hear on the bridge?") over specs ("How many lanterns?").
- Use their words. If they said "quiet", say "quiet", not "serene ambience".
- Follow their thread. Notice what they keep returning to. Never steer toward what's cheaper or easier.
- Leave room. Offer 2-3 short chips (tappable replies, under 5 words each). Never push them to manifest.
- Honest about cost only when it matters ("a waterfall adds about 60 mana"), never as pressure.

THE BLUEPRINT
- Keep it right-sized: a whole world is roughly 4-12 assets; a small request is 1-2. Change only what the player asked for; keep keys stable across turns so items persist.
- style.artDirection is one sentence carried into every asset prompt, so all assets match. palette: 3-6 hex colors.
- sky: how the world is lit and what the horizon looks like, matching timeOfDay and mood. zenith (color overhead) and horizon (color at the edge of the world; distance fog fades to it, so make it a soft, fairly light color even at night, never near-black); fog = meters until the distance has fully faded, 80-300 (a misty world 80-120, a clear one 200-300); sun {color, intensity 0-3, dir [x,y,z] = the direction the light comes FROM, y positive; low y = long dusk shadows}; ambient {color, intensity 0-1.5} fills the shadows (nights and moonlight: cool color, ambient 0.4-0.7, sun intensity 0.4-0.8 as moonlight). Daylight is about sun 1.3 / ambient 0.6. Players must always be able to see the ground.
- terrain: voxel grid, size [x, y, z] (y is up). The world is BIG: x and z are 4-${LIMITS.world} cells (1 cell = 1 meter) and default to ${LIMITS.world}; y is 4-${LIMITS.grid} (default 16). Keep the default unless the player asks for a small or intimate world, and spread features and assets across the whole footprint (centered on ${LIMITS.world / 2}, ${LIMITS.world / 2}); a hill is radius 8-30, a pond 6-20, a village sits within about 40 cells. The player starts near the center. blocks: 2-6 materials with ids like "grass", "stone". Each block's surface: "smooth" for natural ground (grass, sand, dirt, snow, moss: rolling, soft shapes), "blocks" for built or hard things (bricks, cut stone, ice cubes, a blocky or retro look); if unsure, natural ground is smooth. The ground is a few cells thick everywhere. features place shapes on it: type one of plateau | hill | pond | path | cliff | floating-island; at = [x, y, z] where x, z are grid cells and y is the lift above the ground (usually 0; for floating-island y is the altitude, e.g. 8-14); radius in cells; height in cells (for pond: depth, 1-3); block = a block id. Name a liquid block "water" so it reads as water. Asset at = [x, 0, z]: they sit on the surface there.
- assets: key (kebab-case, stable), kind one of model | terrain-piece | texture | music | ambience | voice | sfx, prompt (a self-contained generator prompt that already includes the art direction; for models describe ONE object), quality "quick" (default) or "full" (only for hero pieces), at = [x, y, z] in grid cells, optional size [x, y, z] in meters, rotationY in radians.
- Approximate mana: model 60, terrain-piece 60, music 30, ambience 20, sfx 5.
- Safety: nothing sexual, hateful, or gory; no real people, brands, or copyrighted characters. If asked, gently offer an original alternative.

ANSWER FORMAT
Reply with ONE JSON object and nothing else:
{"reply": string, "chips": string[], "blueprint": {"name": string, "style": {"artDirection": string, "palette": string[], "lighting": string, "timeOfDay": string}, "sky": {"zenith": hex, "horizon": hex, "fog": meters, "sun": {"color": hex, "intensity": number, "dir": [x,y,z]}, "ambient": {"color": hex, "intensity": number}}, "terrain": {"kind": "voxel", "size": [x,y,z], "seed": integer, "blocks": [{"id","name","color","surface": "blocks"|"smooth"}], "features": [{"type","at","radius","height","block"}]}, "assets": [{"key","kind","prompt","quality","at","size","rotationY"}], "lore": {"name","text"}}}
Always return the FULL blueprint, not a diff.`;

interface Session {
  id: string;
  playerId: string;
  worldId: string;
  version: number;
  history: { role: "user" | "assistant"; content: string }[];
  blueprint: Blueprint | null;
}

// ── Persistence: every turn, every raw response, every blueprint version ──
// Kept forever for research replay (Phase 07 Creation Archive). Lives in the
// sync DB, so the hourly S3 backup covers it.
let schemaReady = false;
function db() {
  const d = getDb();
  if (!schemaReady) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS plan_sessions (
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0, blueprint TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS plan_sessions_player_world ON plan_sessions(player_id, world_id, updated_at);
      CREATE TABLE IF NOT EXISTS plan_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        kind TEXT NOT NULL,          -- user | llm_call | llm_error | turn | invalid
        ref TEXT, model TEXT, cost_mana REAL, version INTEGER,
        payload TEXT NOT NULL,       -- JSON: message / request+raw response / validated turn + blueprint
        at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS plan_events_session ON plan_events(session_id, seq);`);
    // Research id (M5): what research exports key sessions by, instead of the player id
    const cols = d.prepare("PRAGMA table_info(plan_sessions)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "research_id")) d.exec("ALTER TABLE plan_sessions ADD COLUMN research_id TEXT");
    schemaReady = true;
  }
  return d;
}

function logEvent(sessionId: string, kind: string, payload: unknown, extra: { ref?: string; model?: string; costMana?: number; version?: number } = {}) {
  db().prepare("INSERT INTO plan_events (session_id, kind, ref, model, cost_mana, version, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(sessionId, kind, extra.ref ?? null, extra.model ?? null, extra.costMana ?? null, extra.version ?? null, JSON.stringify(payload), Date.now());
}

function saveSession(s: Session, created = false) {
  const now = Date.now();
  if (created) {
    db().prepare("INSERT INTO plan_sessions (id, player_id, world_id, version, blueprint, created_at, updated_at, research_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, s.playerId, s.worldId, s.version, s.blueprint ? JSON.stringify(s.blueprint) : null, now, now, researchIdFor(s.playerId));
  } else {
    db().prepare("UPDATE plan_sessions SET version = ?, blueprint = ?, updated_at = ? WHERE id = ?")
      .run(s.version, s.blueprint ? JSON.stringify(s.blueprint) : null, now, s.id);
  }
}

interface SessionRow { id: string; player_id: string; world_id: string; version: number; blueprint: string | null }

/** Rebuild a session from the DB (history = user messages + accepted planner turns). */
function loadSession(id: string): Session | undefined {
  const row = db().prepare("SELECT * FROM plan_sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) return undefined;
  const history: Session["history"] = [];
  for (const e of db().prepare("SELECT kind, payload FROM plan_events WHERE session_id = ? AND kind IN ('user','turn','blocked') ORDER BY seq").all(id) as { kind: string; payload: string }[]) {
    const p = JSON.parse(e.payload);
    if (e.kind === "user") history.push({ role: "user", content: p.message });
    else if (e.kind === "blocked") history.pop(); // a refused request never becomes context
    else history.push({ role: "assistant", content: JSON.stringify({ reply: p.reply, chips: p.chips }) });
  }
  return { id: row.id, playerId: row.player_id, worldId: row.world_id, version: row.version, history, blueprint: row.blueprint ? JSON.parse(row.blueprint) : null };
}

const cache = new Map<string, Session>();
function getSession(id: string): Session | undefined {
  let s = cache.get(id);
  if (!s) {
    s = loadSession(id);
    if (s) cache.set(id, s);
  }
  return s;
}

type Json = (status: number, body: unknown) => void;
interface LlmOut { content: string; model: string; costUsd: number }

async function callLlm(ref: string, model: string, messages: { role: string; content: string }[], researchId: string): Promise<LlmOut> {
  const res = await fetch(`${GENAI_URL}/llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, model, messages, json: true, maxTokens: 4000, researchId }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<LlmOut> & { error?: string; message?: string };
  if (!res.ok || typeof body.content !== "string") throw new Error(body.message ?? body.error ?? `genai ${res.status}`);
  return { content: body.content, model: body.model ?? model, costUsd: body.costUsd ?? 0 };
}

export async function planTurn(rooms: RoomManager, playerId: string, body: unknown, json: Json): Promise<void> {
  const b = (body ?? {}) as { sessionId?: unknown; worldId?: unknown; message?: unknown; model?: unknown };
  const message = typeof b.message === "string" ? b.message.trim().slice(0, 1000) : "";
  const worldId = typeof b.worldId === "string" ? b.worldId.slice(0, 64) : "";
  if (!message || !worldId) return json(400, { error: "bad_request" });
  const model = (PLANNER_MODELS as readonly string[]).includes(b.model as string) ? (b.model as string) : PLANNER_MODELS[0];

  let s = typeof b.sessionId === "string" ? getSession(b.sessionId) : undefined;
  if (s && s.playerId !== playerId) s = undefined;
  if (!s) {
    s = { id: randomUUID(), playerId, worldId, version: 0, history: [], blueprint: null };
    cache.set(s.id, s);
    saveSession(s, true);
  }

  const ref = `plan:${s.id}:${s.version + 1}:${randomUUID().slice(0, 8)}`;
  const decision = rooms.admission.requestDraw({ playerId, ref, estimate: PLAN_ESTIMATE_MANA, progress: progressOf(rooms, playerId) });
  if (!decision.ok) return json(402, { error: decision.reason, message: decision.message, remainingToday: decision.remainingToday });

  const current = s.blueprint ? `\n\nCURRENT BLUEPRINT (v${s.version}):\n${JSON.stringify(stripMeta(s.blueprint))}` : "";
  const messages = [
    { role: "system", content: PLANNER_SYSTEM + current },
    ...s.history.slice(-MAX_TURNS),
    { role: "user", content: message },
  ];
  // The player's words are saved before anything else can fail
  logEvent(s.id, "user", { message, model }, { ref });
  s.history.push({ role: "user", content: message });

  let costUsd = 0;
  let usedModel = model;
  const sid = s.id;
  const researchId = researchIdFor(playerId);
  const attempt = async (callRef: string, msgs: { role: string; content: string }[]) => {
    try {
      const out = await callLlm(callRef, model, msgs, researchId);
      costUsd += out.costUsd;
      usedModel = out.model;
      logEvent(sid, "llm_call", { requested: model, messages: msgs, response: out.content }, { ref: callRef, model: out.model, costMana: out.costUsd * 100 });
      return out;
    } catch (err) {
      logEvent(sid, "llm_error", { requested: model, messages: msgs, error: (err as Error).message }, { ref: callRef, model });
      throw err;
    }
  };
  try {
    let out = await attempt(ref, messages);
    let parsed = parsePlannerTurn(extractJson(out.content));
    if (!parsed.ok) {
      logEvent(s.id, "invalid", { errors: parsed.errors }, { ref, model: usedModel });
      out = await attempt(`${ref}:repair`, [
        ...messages,
        { role: "assistant", content: out.content.slice(0, 6000) },
        { role: "user", content: `That answer didn't validate: ${parsed.errors.join("; ")}. Reply again with only the JSON object.` },
      ]);
      parsed = parsePlannerTurn(extractJson(out.content));
    }
    // Safety before the blueprint is shown (M1): everything the generators would get and the world would display.
    // Not the player's raw words or the planner's reply: the planner declines gracefully on its own
    // ("I can't make Mario… two original stone brothers"), and naming what it declined is fine.
    let blocked: Extract<SafetyVerdict, { ok: false }> | null = null;
    if (parsed.ok) {
      const bpd = parsed.value.blueprint;
      const safe = await checkCreation(playerId, "plan", [
        bpd.name, bpd.style.artDirection, bpd.lore?.name ?? "", bpd.lore?.text ?? "",
        ...bpd.assets.map((a) => a.prompt),
      ], ref);
      costUsd += safe.costUsd;
      if (!safe.ok) blocked = safe;
    }
    const mana = Math.round(costUsd * 100 * 1000) / 1000;
    rooms.mana.settle(ref, mana, `planner ${usedModel}`);
    if (!parsed.ok) {
      logEvent(s.id, "invalid", { errors: parsed.errors, final: true }, { ref, model: usedModel, costMana: mana });
      console.warn(`[plan] ${ref} invalid after repair:`, parsed.errors.join("; "));
      return json(502, { error: "plan_invalid", message: "The planner lost its thread. Try saying it another way." });
    }
    if (blocked) {
      // Answer in the planner's voice; the blueprint stays as it was and the request is dropped from context
      s.history.pop();
      const reply = blocked.suggestion
        ? `I can't make that one here. How about ${blocked.suggestion.replace(/[.!]+$/, "")}?`
        : "I can't make that one here. What else could live in this world?";
      const chips = blocked.suggestion ? [blocked.suggestion.slice(0, 60)] : [];
      logEvent(s.id, "blocked", { category: blocked.category, reply, chips, refused: parsed.value }, { ref, model: usedModel, costMana: mana });
      return json(200, {
        sessionId: s.id, version: s.version, reply, chips, blueprint: s.blueprint, model: usedModel, mana,
        remainingToday: decision.remainingToday, blocked: blocked.category,
      });
    }

    const turn = parsed.value;
    s.version += 1;
    s.blueprint = {
      ...turn.blueprint,
      id: s.id,
      version: s.version,
      worldId: s.worldId,
      estimate: estimate(turn.blueprint, PLAN_ESTIMATE_MANA),
    };
    s.history.push({ role: "assistant", content: JSON.stringify({ reply: turn.reply, chips: turn.chips }) });
    logEvent(s.id, "turn", { reply: turn.reply, chips: turn.chips, warnings: parsed.warnings, blueprint: s.blueprint }, { ref, model: usedModel, costMana: mana, version: s.version });
    saveSession(s);
    return json(200, {
      sessionId: s.id, version: s.version, reply: turn.reply, chips: turn.chips,
      blueprint: s.blueprint, model: usedModel, mana, remainingToday: decision.remainingToday,
    });
  } catch (err) {
    if (costUsd > 0) rooms.mana.settle(ref, costUsd * 100, `planner ${usedModel} (failed)`);
    else rooms.mana.release(ref);
    console.error("[plan] failed:", (err as Error).message);
    return json(503, { error: "planner_unavailable", message: "The planner is resting right now. Try again soon." });
  }
}

/** Latest session for this player in this world: transcript + blueprint, so a reload loses nothing. */
export function planResume(playerId: string, worldId: string, json: Json): void {
  const row = db().prepare("SELECT id FROM plan_sessions WHERE player_id = ? AND world_id = ? ORDER BY updated_at DESC LIMIT 1").get(playerId, worldId) as { id: string } | undefined;
  if (!row) return json(200, { session: null });
  const s = getSession(row.id)!;
  const turns: { who: "you" | "planner"; text: string; chips?: string[]; meta?: string }[] = [];
  for (const e of db().prepare("SELECT kind, model, cost_mana, payload FROM plan_events WHERE session_id = ? AND kind IN ('user','turn','blocked') ORDER BY seq").all(s.id) as { kind: string; model: string | null; cost_mana: number | null; payload: string }[]) {
    const p = JSON.parse(e.payload);
    if (e.kind === "user") turns.push({ who: "you", text: p.message });
    else turns.push({ who: "planner", text: p.reply, chips: p.chips, meta: `${(e.model ?? "").split("/")[1] ?? ""} · ${(e.cost_mana ?? 0).toFixed(1)} mana` });
  }
  // Manifest jobs from this session, so a reload keeps placing what's still being made
  const jobs: { key: string; jobId: string; version: number }[] = [];
  for (const e of db().prepare("SELECT payload FROM plan_events WHERE session_id = ? AND kind = 'manifest' ORDER BY seq").all(s.id) as { payload: string }[]) {
    const p = JSON.parse(e.payload) as { version: number; items: { key: string; jobId?: string }[] };
    for (const it of p.items) if (it.jobId) jobs.push({ key: it.key, jobId: it.jobId, version: p.version });
  }
  json(200, { session: { sessionId: s.id, version: s.version, blueprint: s.blueprint, turns, jobs } });
}

/**
 * Manifest: make the current blueprint real. Each model asset gets its own
 * hold + Meshy job (a failed item releases only its share). The client
 * writes the terrain to the World CRDT and places each model as it lands.
 * Other asset kinds (music, ambience, …) wait for their providers.
 *
 *   POST /api/player/plan/manifest { sessionId, keys? } → { version, terrain, items: [{ key, jobId } | { key, error }] }
 */
export async function planManifest(rooms: RoomManager, playerId: string, body: unknown, json: Json): Promise<void> {
  const b = (body ?? {}) as { sessionId?: unknown; keys?: unknown };
  const s = typeof b.sessionId === "string" ? getSession(b.sessionId) : undefined;
  if (!s || s.playerId !== playerId || !s.blueprint) return json(404, { error: "not_found" });
  const only = Array.isArray(b.keys) ? new Set(b.keys.filter((k): k is string => typeof k === "string")) : null;
  const bp = s.blueprint;
  const items: { key: string; jobId?: string; error?: string; message?: string }[] = [];
  // Safety before Meshy (M1). Blueprints shown since the check landed already passed, so this is usually a cache hit.
  const toMake = bp.assets.filter((a) => (!only || only.has(a.key)) && (a.kind === "model" || a.kind === "terrain-piece"));
  if (toMake.length) {
    const checkRef = `manifest:${s.id}:v${bp.version}`;
    const safe = await checkCreation(playerId, "manifest", [bp.style.artDirection, ...toMake.map((a) => a.prompt)], checkRef);
    chargeCheck(rooms.mana, playerId, `${checkRef}:${randomUUID().slice(0, 6)}`, safe.costUsd);
    if (!safe.ok) return json(422, { error: "unsafe", category: safe.category, message: safe.message });
  }
  for (const a of bp.assets) {
    if (only && !only.has(a.key)) continue;
    if (a.kind !== "model" && a.kind !== "terrain-piece") {
      items.push({ key: a.key, error: "later", message: `${a.kind} comes later` });
      continue;
    }
    const ref = `manifest:${s.id}:v${bp.version}:${a.key}:${randomUUID().slice(0, 6)}`;
    const est = ASSET_MANA[a.kind].quick; // preview quality only until refine is wired
    const decision = rooms.admission.requestDraw({ playerId, ref, estimate: est, progress: progressOf(rooms, playerId) });
    if (!decision.ok) {
      items.push({ key: a.key, error: decision.reason, message: decision.message });
      continue;
    }
    try {
      const prompt = `${a.prompt}. Style: ${bp.style.artDirection}`;
      items.push({ key: a.key, jobId: await startJob(ref, playerId, prompt) });
    } catch (err) {
      rooms.mana.release(ref);
      items.push({ key: a.key, error: "genai_unavailable", message: (err as Error).message });
    }
  }
  logEvent(s.id, "manifest", { version: bp.version, items }, { version: bp.version });
  json(200, { version: bp.version, terrain: bp.terrain, items });
}

/**
 * Redo one item: optionally reword it ("smaller, darker wood"), then one new
 * job. The client swaps the file in place, keeping where it stands. A
 * reworded prompt is a direct edit: new blueprint version, no planner call.
 *
 *   POST /api/player/plan/redo { sessionId, key, note? } → { version, key, jobId, prompt, blueprint }
 */
export async function planRedo(rooms: RoomManager, playerId: string, body: unknown, json: Json): Promise<void> {
  const b = (body ?? {}) as { sessionId?: unknown; key?: unknown; note?: unknown };
  const s = typeof b.sessionId === "string" ? getSession(b.sessionId) : undefined;
  if (!s || s.playerId !== playerId || !s.blueprint) return json(404, { error: "not_found" });
  const asset = s.blueprint.assets.find((a) => a.key === b.key);
  if (!asset || (asset.kind !== "model" && asset.kind !== "terrain-piece")) return json(400, { error: "bad_item" });
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";

  let prompt = asset.prompt;
  if (note) {
    const checkRef = `redo:${s.id}:${asset.key}:${randomUUID().slice(0, 6)}`;
    const safe = await checkCreation(playerId, "redo", [`${asset.prompt}. ${note}`], checkRef);
    chargeCheck(rooms.mana, playerId, checkRef, safe.costUsd);
    if (!safe.ok) return json(422, { error: "unsafe", category: safe.category, message: safe.message });
    prompt = `${asset.prompt.replace(/\.?\s*$/, "")}. ${note}`.slice(0, LIMITS.prompt);
    const next = applyEdit(s.blueprint, { op: "prompt", key: asset.key, prompt });
    if (!next.ok) return json(400, { error: "bad_item" });
    commitVersion(s, next.value, "edit", { key: asset.key, note, prompt });
  }

  const ref = `redo:${s.id}:v${s.version}:${asset.key}:${randomUUID().slice(0, 6)}`;
  const decision = rooms.admission.requestDraw({ playerId, ref, estimate: ASSET_MANA[asset.kind].quick, progress: progressOf(rooms, playerId) });
  if (!decision.ok) return json(402, { error: decision.reason, message: decision.message, remainingToday: decision.remainingToday });
  try {
    const jobId = await startJob(ref, playerId, `${prompt}. Style: ${s.blueprint.style.artDirection}`);
    logEvent(s.id, "redo", { key: asset.key, note, jobId }, { version: s.version });
    json(200, { version: s.version, key: asset.key, jobId, prompt, blueprint: s.blueprint });
  } catch (err) {
    rooms.mana.release(ref);
    json(503, { error: "genai_unavailable", message: (err as Error).message });
  }
}

/** New blueprint version from a hand edit or a restore: re-stamped, re-estimated, logged with its blueprint so history can return to it. */
function commitVersion(s: Session, draft: BlueprintDraft, kind: "edit" | "restore", payload: Record<string, unknown>) {
  s.version += 1;
  s.blueprint = { ...stripMeta(draft as Blueprint), id: s.id, version: s.version, worldId: s.worldId, estimate: estimate(draft, PLAN_ESTIMATE_MANA) };
  logEvent(s.id, kind, { ...payload, blueprint: s.blueprint }, { version: s.version });
  saveSession(s);
}

// Hand edits are free, so they get their own per-player limit (sliding minute)
const EDITS_PER_MIN = 30;
const editTimes = new Map<string, number[]>();
function takeEdit(playerId: string): boolean {
  const now = Date.now();
  const recent = (editTimes.get(playerId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= EDITS_PER_MIN) {
    editTimes.set(playerId, recent);
    return false;
  }
  recent.push(now);
  editTimes.set(playerId, recent);
  if (editTimes.size > 5000) for (const [k, v] of editTimes) if (!v.some((t) => now - t < 60_000)) editTimes.delete(k);
  return true;
}

const editLabel = (e: BlueprintEdit): string =>
  e.op === "rename" ? `renamed “${e.name}”`
  : e.op === "remove" ? `removed ${e.key}`
  : e.op === "prompt" ? `reworded ${e.key}`
  : `${e.key} ${e.factor > 1 ? "bigger" : "smaller"}`;

/**
 * Direct edit: change the blueprint by hand, no planner call (free, except
 * the safety check on new words). `base` is the version the player was
 * looking at; if the plan moved on, 409 with the current one.
 *
 *   POST /api/player/plan/edit { sessionId, base, edit } → { version, blueprint, warnings } | 409 { blueprint } | 422 unsafe
 */
export async function planEdit(rooms: RoomManager, playerId: string, body: unknown, json: Json): Promise<void> {
  const b = (body ?? {}) as { sessionId?: unknown; base?: unknown; edit?: unknown };
  const s = typeof b.sessionId === "string" ? getSession(b.sessionId) : undefined;
  if (!s || s.playerId !== playerId || !s.blueprint) return json(404, { error: "not_found" });
  if (b.base !== s.version) return json(409, { error: "stale", message: "The plan changed. Here's the latest.", version: s.version, blueprint: s.blueprint });
  const edit = parseEdit(b.edit);
  if (!edit.ok) return json(400, { error: "bad_edit", message: edit.errors.join("; ") });
  if (!takeEdit(playerId)) return json(429, { error: "slow_down", message: "That's a lot of edits. Give it a moment." });
  const next = applyEdit(s.blueprint, edit.value);
  if (!next.ok) return json(400, { error: "bad_edit", message: next.errors.join("; ") });
  const words = edit.value.op === "prompt" ? edit.value.prompt : edit.value.op === "rename" ? edit.value.name : "";
  if (words) {
    const checkRef = `edit:${s.id}:${randomUUID().slice(0, 8)}`;
    const safe = await checkCreation(playerId, "edit", [words], checkRef);
    chargeCheck(rooms.mana, playerId, checkRef, safe.costUsd);
    if (!safe.ok) return json(422, { error: "unsafe", category: safe.category, message: safe.message });
    // The check awaited: someone else's edit may have landed meanwhile
    if (b.base !== s.version) return json(409, { error: "stale", message: "The plan changed. Here's the latest.", version: s.version, blueprint: s.blueprint });
  }
  commitVersion(s, next.value, "edit", { edit: edit.value, label: editLabel(edit.value) });
  json(200, { version: s.version, blueprint: s.blueprint, warnings: next.warnings });
}

interface VersionRow { kind: string; version: number; at: number; payload: string }
const VERSION_KINDS = "('turn','edit','restore')";

/**
 * Version history: every planner turn, hand edit and restore, newest first (last 100).
 *
 *   GET /api/player/plan/versions?sessionId → { current, versions: [{ version, kind, label, at, items }] }
 */
export function planVersions(playerId: string, sessionId: string, json: Json): void {
  const s = getSession(sessionId);
  if (!s || s.playerId !== playerId) return json(404, { error: "not_found" });
  const rows = db().prepare(`SELECT kind, version, at, payload FROM plan_events WHERE session_id = ? AND kind IN ${VERSION_KINDS} AND version IS NOT NULL ORDER BY seq DESC LIMIT 100`).all(s.id) as VersionRow[];
  const versions = rows.map((r) => {
    const p = JSON.parse(r.payload) as { reply?: string; label?: string; note?: string; key?: string; from?: number; blueprint?: Blueprint };
    const label = r.kind === "turn" ? `planner: ${(p.reply ?? "").slice(0, 70)}`
      : r.kind === "restore" ? `restored v${p.from}`
      : p.label ?? (p.key ? `reworded ${p.key}` : "edit");
    return { version: r.version, kind: r.kind, label, at: r.at, items: p.blueprint?.assets.length ?? 0 };
  });
  json(200, { current: s.version, versions });
}

/**
 * Restore: bring an earlier version back as the newest one (history is never rewritten).
 *
 *   POST /api/player/plan/restore { sessionId, version } → { version, blueprint }
 */
export function planRestore(playerId: string, body: unknown, json: Json): void {
  const b = (body ?? {}) as { sessionId?: unknown; version?: unknown };
  const s = typeof b.sessionId === "string" ? getSession(b.sessionId) : undefined;
  if (!s || s.playerId !== playerId || !s.blueprint) return json(404, { error: "not_found" });
  if (typeof b.version !== "number" || b.version === s.version) return json(400, { error: "bad_version" });
  if (!takeEdit(playerId)) return json(429, { error: "slow_down", message: "That's a lot of edits. Give it a moment." });
  const row = db().prepare(`SELECT payload FROM plan_events WHERE session_id = ? AND version = ? AND kind IN ${VERSION_KINDS} ORDER BY seq DESC LIMIT 1`).get(s.id, b.version) as { payload: string } | undefined;
  const old = row ? (JSON.parse(row.payload) as { blueprint?: Blueprint }).blueprint : undefined;
  if (!old) return json(404, { error: "no_version" });
  // Was shown (and safety-checked) when it was made, so no new check
  commitVersion(s, old, "restore", { from: b.version });
  json(200, { version: s.version, blueprint: s.blueprint });
}

function stripMeta(bp: Blueprint): BlueprintDraft {
  const { id: _i, version: _v, worldId: _w, estimate: _e, ...draft } = bp;
  return draft;
}

export function plannerModels(json: Json): void {
  json(200, { models: PLANNER_MODELS, default: PLANNER_MODELS[0] });
}

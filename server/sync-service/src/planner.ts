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
import type { PlayerProgress } from "../../../shared/crdt-schema.js";
import { estimate, parsePlannerTurn, LIMITS, type Blueprint, type BlueprintDraft } from "../../../shared/blueprint.js";

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";

/** Opus turn with history ≈ $0.03–0.08; settle charges the real cost either way. */
export const PLAN_ESTIMATE_MANA = 10;

/** Models offered in the picker (OpenRouter ids). First = default. */
export const PLANNER_MODELS = [
  "anthropic/claude-opus-5.5",
  "anthropic/claude-sonnet-5.5",
  "deepseek/deepseek-v4-pro",
  "google/gemini-4-argon",
  "moonshotai/kimi-k3",
  "openai/gpt-5.6-terra",
  "x-ai/grok-4.7",
  "anthropic/claude-haiku-5.5",
] as const;

const PROVISIONAL_PROGRESS: PlayerProgress = { chapter: 5, warpUnlocked: false, levelsSinceWarp: 0 };
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
- terrain: voxel grid, size [x, y, z] each 4-${LIMITS.grid} (y is up). blocks: 2-6 materials with ids like "grass", "stone". The ground is a few cells thick everywhere. features place shapes on it: type one of plateau | hill | pond | path | cliff | floating-island; at = [x, y, z] where x, z are grid cells and y is the lift above the ground (usually 0; for floating-island y is the altitude, e.g. 8-14); radius in cells; height in cells (for pond: depth, 1-3); block = a block id. Name a liquid block "water" so it reads as water. Asset at = [x, 0, z]: they sit on the surface there.
- assets: key (kebab-case, stable), kind one of model | terrain-piece | texture | music | ambience | voice | sfx, prompt (a self-contained generator prompt that already includes the art direction; for models describe ONE object), quality "quick" (default) or "full" (only for hero pieces), at = [x, y, z] in grid cells, optional size [x, y, z] in meters, rotationY in radians.
- Approximate mana: model quick 40 / full 60, terrain-piece 40/60, music 30, ambience 20, sfx 5.
- Safety: nothing sexual, hateful, or gory; no real people, brands, or copyrighted characters. If asked, gently offer an original alternative.

ANSWER FORMAT
Reply with ONE JSON object and nothing else:
{"reply": string, "chips": string[], "blueprint": {"name": string, "style": {"artDirection": string, "palette": string[], "lighting": string, "timeOfDay": string}, "terrain": {"kind": "voxel", "size": [x,y,z], "seed": integer, "blocks": [{"id","name","color","surface": "blocks"|"smooth"}], "features": [{"type","at","radius","height","block"}]}, "assets": [{"key","kind","prompt","quality","at","size","rotationY"}], "lore": {"name","text"}}}
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
    db().prepare("INSERT INTO plan_sessions (id, player_id, world_id, version, blueprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(s.id, s.playerId, s.worldId, s.version, s.blueprint ? JSON.stringify(s.blueprint) : null, now, now);
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
  for (const e of db().prepare("SELECT kind, payload FROM plan_events WHERE session_id = ? AND kind IN ('user','turn') ORDER BY seq").all(id) as { kind: string; payload: string }[]) {
    const p = JSON.parse(e.payload);
    if (e.kind === "user") history.push({ role: "user", content: p.message });
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

async function callLlm(ref: string, model: string, messages: { role: string; content: string }[]): Promise<LlmOut> {
  const res = await fetch(`${GENAI_URL}/llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, model, messages, json: true, maxTokens: 4000 }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<LlmOut> & { error?: string; message?: string };
  if (!res.ok || typeof body.content !== "string") throw new Error(body.message ?? body.error ?? `genai ${res.status}`);
  return { content: body.content, model: body.model ?? model, costUsd: body.costUsd ?? 0 };
}

/** Models sometimes wrap JSON in prose or fences; take the outermost object. */
function extractJson(text: string): unknown {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
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
  const decision = rooms.admission.requestDraw({ playerId, ref, estimate: PLAN_ESTIMATE_MANA, progress: PROVISIONAL_PROGRESS });
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
  const attempt = async (callRef: string, msgs: { role: string; content: string }[]) => {
    try {
      const out = await callLlm(callRef, model, msgs);
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
    const mana = Math.round(costUsd * 100 * 1000) / 1000;
    rooms.mana.settle(ref, mana, `planner ${usedModel}`);
    if (!parsed.ok) {
      logEvent(s.id, "invalid", { errors: parsed.errors, final: true }, { ref, model: usedModel, costMana: mana });
      console.warn(`[plan] ${ref} invalid after repair:`, parsed.errors.join("; "));
      return json(502, { error: "plan_invalid", message: "The planner lost its thread. Try saying it another way." });
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
  for (const e of db().prepare("SELECT kind, model, cost_mana, payload FROM plan_events WHERE session_id = ? AND kind IN ('user','turn') ORDER BY seq").all(s.id) as { kind: string; model: string | null; cost_mana: number | null; payload: string }[]) {
    const p = JSON.parse(e.payload);
    if (e.kind === "user") turns.push({ who: "you", text: p.message });
    else turns.push({ who: "planner", text: p.reply, chips: p.chips, meta: `${(e.model ?? "").split("/")[1] ?? ""} · ${(e.cost_mana ?? 0).toFixed(1)} mana` });
  }
  json(200, { session: { sessionId: s.id, version: s.version, blueprint: s.blueprint, turns } });
}

function stripMeta(bp: Blueprint): BlueprintDraft {
  const { id: _i, version: _v, worldId: _w, estimate: _e, ...draft } = bp;
  return draft;
}

export function plannerModels(json: Json): void {
  json(200, { models: PLANNER_MODELS, default: PLANNER_MODELS[0] });
}

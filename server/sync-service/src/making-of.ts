/**
 * How a world was made (Alex, 2026-11-02): every planner conversation that shaped a world,
 * readable by everyone who visits it (the story stone by the spawn point). Types and
 * rules: shared/making-of.ts.
 *
 *   GET /making-of?worldId=<id> → MakingOf   (public, no session: guests read it too)
 *
 * Read straight from the planner's log (plan_sessions / plan_events), so nothing new is
 * stored and the history can't drift from what happened. Refused requests are left out
 * (as they are from the planner's own context); player words get world chat's cleaning
 * and masking; raw model calls, costs and blueprints never leave the server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { getDb } from "./persistence.js";
import { characterNames } from "./identity.js";
import { prepareChat } from "../../../shared/chat.js";
import { MAKING_OF_LIMITS, type MakingOf, type MakingOfEntry, type MakingOfSession } from "../../../shared/making-of.js";

const KINDS = "('user','turn','blocked','edit','restore','redo','manifest')";
const STAND_IN = "A traveler";

const say = (raw: unknown) => prepareChat(raw, MAKING_OF_LIMITS.text);
const modelLabel = (m: string | null) => (m ?? "").split("/")[1] ?? m ?? "";

let indexed = false;
const hasPlanTables = (db: Database.Database) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_events'").get();

/** Pure: the world's planner history from the DB (`names` maps player ids to character names). */
export function buildMakingOf(db: Database.Database, worldId: string, names: (ids: string[]) => Record<string, string>): MakingOf {
  if (!hasPlanTables(db)) return { worldId, sessions: [] };
  if (!indexed) {
    db.exec("CREATE INDEX IF NOT EXISTS plan_sessions_world ON plan_sessions(world_id, created_at)");
    indexed = true;
  }
  const rows = db.prepare("SELECT id, player_id, created_at, blueprint FROM plan_sessions WHERE world_id IN (?, ?) ORDER BY created_at, id LIMIT ?")
    .all(worldId, worldId.toLowerCase(), MAKING_OF_LIMITS.sessions) as { id: string; player_id: string; created_at: number; blueprint: string | null }[];
  const who = names([...new Set(rows.map((r) => r.player_id))]);
  const events = db.prepare(`SELECT kind, model, version, payload, at FROM plan_events WHERE session_id = ? AND kind IN ${KINDS} ORDER BY seq`);

  const sessions: MakingOfSession[] = [];
  for (const r of rows) {
    const entries: MakingOfEntry[] = [];
    // A player line only counts once the planner answered it (or it led to a refusal, which drops it)
    let waiting: MakingOfEntry[] = [];
    for (const e of events.all(r.id) as { kind: string; model: string | null; version: number | null; payload: string; at: number }[]) {
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(e.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (e.kind === "user") {
        const text = say(p.message);
        if (text) waiting.push({ kind: "player", at: e.at, text });
      } else if (e.kind === "blocked") {
        waiting.pop();
      } else if (e.kind === "turn") {
        entries.push(...waiting);
        waiting = [];
        const chips = Array.isArray(p.chips) ? p.chips.map((c) => say(c)).filter(Boolean).slice(0, 4) : [];
        entries.push({ kind: "planner", at: e.at, text: say(p.reply), chips, model: modelLabel(e.model), version: e.version ?? 0 });
      } else {
        const text = noteText(e.kind, p);
        if (text) entries.push({ kind: "note", at: e.at, text, ...(e.version != null ? { version: e.version } : {}) });
      }
      if (entries.length >= MAKING_OF_LIMITS.entriesPerSession) break;
    }
    if (!entries.some((x) => x.kind === "planner")) continue; // a conversation that never got an answer made nothing
    let plan: string | undefined;
    try {
      const n = r.blueprint ? (JSON.parse(r.blueprint) as { name?: unknown }).name : undefined;
      plan = typeof n === "string" ? say(n).slice(0, 80) || undefined : undefined;
    } catch { /* no name */ }
    sessions.push({ id: r.id, by: who[r.player_id] ?? STAND_IN, startedAt: r.created_at, ...(plan ? { plan } : {}), entries });
  }
  return { worldId, sessions };
}

/** One short line for the things that change a plan without a planner reply. */
function noteText(kind: string, p: Record<string, unknown>): string {
  const key = typeof p.key === "string" ? say(p.key.replace(/-/g, " ")).slice(0, 60) : "";
  if (kind === "edit") {
    if (typeof p.label === "string") {
      // planner.ts editLabel: "renamed “X”", "removed key", "reworded key", "key bigger|smaller"; read after the author's name
      const label = say(p.label.replace(/-/g, " "));
      const sized = /^(.+) (bigger|smaller)$/.exec(label);
      if (sized) return `made ${sized[1]} ${sized[2]}`;
      return label.startsWith("renamed ") ? `renamed the plan ${label.slice(8)}` : label;
    }
    if (key) return p.note ? `reworded ${key}: “${say(p.note)}”` : `reworded ${key}`;
    return "edited the plan";
  }
  if (kind === "restore") return typeof p.from === "number" ? `went back to version ${p.from}` : "went back to an earlier version";
  if (kind === "redo") return key ? `remade ${key}${p.note ? `: “${say(p.note)}”` : ""}` : "";
  if (kind === "manifest") {
    const items = Array.isArray(p.items) ? (p.items as { jobId?: unknown }[]) : [];
    const made = items.filter((i) => typeof i.jobId === "string").length;
    return made ? `manifested: ${made} ${made === 1 ? "thing" : "things"} began to take shape` : "";
  }
  return "";
}

// ── HTTP ─────────────────────────────────────────────────────────────

/** A world's history changes only when someone plans in it, and it's public: reuse it briefly. */
const CACHE_MS = 8_000;
const cache = new Map<string, { at: number; body: string }>();

/** Called by the planner when it logs something new for a world, so readers see it at once. */
export function makingOfChanged(worldId: string): void {
  cache.delete(worldId);
  cache.delete(worldId.toLowerCase());
}

export function handleMakingOf(req: IncomingMessage, res: ServerResponse, cors: Record<string, string>): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/making-of") return false;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET" });
    res.end();
    return true;
  }
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=5", ...cors };
  const worldId = url.searchParams.get("worldId") ?? "";
  if (req.method !== "GET" || !/^[\w-]{1,64}$/.test(worldId)) {
    res.writeHead(req.method !== "GET" ? 405 : 400, headers);
    res.end(JSON.stringify({ error: req.method !== "GET" ? "method_not_allowed" : "bad_request" }));
    return true;
  }
  const now = Date.now();
  let hit = cache.get(worldId);
  if (!hit || now - hit.at > CACHE_MS) {
    try {
      hit = { at: now, body: JSON.stringify(buildMakingOf(getDb(), worldId, characterNames)) };
    } catch (err) {
      console.error("[making-of]", (err as Error).message);
      res.writeHead(500, headers);
      res.end(JSON.stringify({ error: "internal" }));
      return true;
    }
    if (cache.size > 2000) cache.clear();
    cache.set(worldId, hit);
  }
  res.writeHead(200, headers);
  res.end(hit.body);
  return true;
}

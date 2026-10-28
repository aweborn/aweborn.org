/**
 * Research replay + export (Phase 07 Creation Archive; Rough Draft M5).
 *
 * Replays one research id's planner history from the sync DB and checks it
 * still holds together on today's code:
 *   - planner turn: the saved raw model answer re-parses to the blueprint
 *     that was shown (a difference means the validator changed since)
 *   - hand edit / reword: re-applying it to the version before gives the
 *     version that was saved
 *   - restore: equals the version it brought back
 *   - versions count up by one
 *   - every version's terrain: a hash of its centre chunk. generateVoxels is
 *     deterministic, so the same hash on any machine means the same ground.
 *   - mana spent (planner calls + safety checks), summed
 *
 * Export writes JSONL, one line per planning session, keyed by research id
 * only: never the player id or account, and blueprints are written without
 * their id / worldId stamp. Sessions saved before research ids existed get
 * theirs filled in first.
 *
 *   npm run replay -- <researchId>                  report (JSON) to stdout; exit 1 on mismatches
 *   npm run replay -- --export out.jsonl [id ...]   export (every player when no id is given)
 *   prod:  node dist/server/sync-service/src/replay.js …   (same DB_PATH as the service)
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { applyEdit, extractJson, parsePlannerTurn, type Blueprint, type BlueprintDraft, type BlueprintEdit } from "../../../shared/blueprint.js";
import { CHUNK, generateVoxels } from "../../../shared/voxel.js";
import { isResearchId, playerForResearchId, researchIdFor } from "./research.js";

type Db = Database.Database;

interface SessionRow { id: string; player_id: string; created_at: number; research_id: string | null }
interface EventRow { seq: number; kind: string; ref: string | null; model: string | null; cost_mana: number | null; version: number | null; payload: string; at: number }

export interface Mismatch {
  session: string; seq: number; version: number | null;
  check: "reparse" | "edit" | "restore" | "version";
  detail: string;
}
export interface VersionReport { version: number; kind: string; assets: number; terrainHash: string }
export interface SessionReport {
  session: string; createdAt: number; events: number;
  turns: number; edits: number; restores: number; blocked: number;
  costMana: number; versions: VersionReport[];
}
export interface ReplayReport { researchId: string; sessions: SessionReport[]; costMana: number; checked: number; mismatches: Mismatch[] }

/** JSON with object keys sorted, so equal values always print the same. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]]))
      : x);
}

/** A blueprint without its session stamp (id, version, worldId, estimate). */
function stripMeta(bp: unknown): BlueprintDraft | null {
  if (!bp || typeof bp !== "object") return null;
  const { id: _i, version: _v, worldId: _w, estimate: _e, ...draft } = bp as Blueprint;
  return draft;
}

/** Hash of the generated centre chunk: same hash = same ground, on any machine. */
export function terrainHash(t: BlueprintDraft["terrain"] | undefined): string {
  try {
    if (!t?.size || !t.blocks?.length) return "none";
    const [wx, , wz] = t.size;
    const w = Math.min(CHUNK, wx), d = Math.min(CHUNK, wz);
    const g = generateVoxels(t, { x0: Math.floor((wx - w) / 2), z0: Math.floor((wz - d) / 2), w, d });
    return createHash("sha256").update(JSON.stringify(g.size)).update(g.cells).digest("hex").slice(0, 16);
  } catch {
    return "error";
  }
}

const hasPlanTables = (db: Db): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_sessions'").get();

/** planner.ts adds plan_sessions.research_id on its first call after a deploy, so it may not be there yet. */
const hasResearchColumn = (db: Db): boolean =>
  (db.prepare("PRAGMA table_info(plan_sessions)").all() as { name: string }[]).some((c) => c.name === "research_id");

const parse = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** A research id's sessions, oldest first (including ones saved before research ids, matched through the mapping). */
function sessionsFor(db: Db, researchId: string): SessionRow[] {
  if (!hasPlanTables(db)) return [];
  let player: string | null = null;
  try { player = playerForResearchId(researchId, db); } catch { /* read-only DB without the mapping table yet */ }
  if (!hasResearchColumn(db)) {
    return db.prepare("SELECT id, player_id, created_at, NULL AS research_id FROM plan_sessions WHERE player_id = ? ORDER BY created_at, id")
      .all(player ?? "") as SessionRow[];
  }
  return db.prepare(
    "SELECT id, player_id, created_at, research_id FROM plan_sessions WHERE research_id = ? OR (research_id IS NULL AND player_id = ?) ORDER BY created_at, id",
  ).all(researchId, player ?? "") as SessionRow[];
}

function eventsFor(db: Db, sessionId: string): EventRow[] {
  return db.prepare("SELECT seq, kind, ref, model, cost_mana, version, payload, at FROM plan_events WHERE session_id = ? ORDER BY seq")
    .all(sessionId) as EventRow[];
}

/** Replay one session's events in order. Pure over its inputs. */
export function replaySession(session: { id: string; created_at: number }, events: EventRow[]): { report: SessionReport; mismatches: Mismatch[]; checked: number } {
  const report: SessionReport = { session: session.id, createdAt: session.created_at, events: events.length, turns: 0, edits: 0, restores: 0, blocked: 0, costMana: 0, versions: [] };
  const mismatches: Mismatch[] = [];
  let checked = 0;
  let lastResponse: string | null = null;
  let current: BlueprintDraft | null = null;
  let version = 0;
  const byVersion = new Map<number, BlueprintDraft>();
  const miss = (e: EventRow, check: Mismatch["check"], detail: string) => mismatches.push({ session: session.id, seq: e.seq, version: e.version, check, detail });
  const same = (e: EventRow, check: Mismatch["check"], got: unknown, saved: unknown, what: string) => {
    checked++;
    if (canonical(got) !== canonical(saved)) miss(e, check, what);
  };

  for (const e of events) {
    const p = parse(e.payload);
    // llm_call costs are already inside the turn / blocked / invalid totals
    if (e.kind !== "llm_call" && typeof e.cost_mana === "number") report.costMana += e.cost_mana;
    const saved = stripMeta(p.blueprint);
    switch (e.kind) {
      case "llm_call":
        lastResponse = typeof p.response === "string" ? p.response : null;
        continue;
      case "blocked":
        report.blocked++;
        lastResponse = null;
        continue;
      case "invalid":
        if (p.final) lastResponse = null;
        continue;
      case "turn": {
        report.turns++;
        if (lastResponse !== null) {
          const again = parsePlannerTurn(extractJson(lastResponse));
          if (!again.ok) { checked++; miss(e, "reparse", `answer no longer validates: ${again.errors.join("; ")}`); }
          else same(e, "reparse", again.value.blueprint, saved, "answer re-parses to a different blueprint");
        }
        lastResponse = null;
        break;
      }
      case "edit": {
        report.edits++;
        // Hand edits log { edit }; a reworded redo logs { key, prompt }
        const edit = (p.edit as BlueprintEdit | undefined)
          ?? (typeof p.key === "string" && typeof p.prompt === "string" ? { op: "prompt" as const, key: p.key, prompt: p.prompt } : null);
        if (!current || !edit) { checked++; miss(e, "edit", "nothing to apply the edit to"); break; }
        const next = applyEdit(current, edit);
        if (!next.ok) { checked++; miss(e, "edit", `edit no longer applies: ${next.errors.join("; ")}`); }
        else same(e, "edit", next.value, saved, "re-applied edit gives a different blueprint");
        break;
      }
      case "restore": {
        report.restores++;
        const from = typeof p.from === "number" ? byVersion.get(p.from) : undefined;
        if (!from) { checked++; miss(e, "restore", `v${String(p.from)} is not in the history`); }
        else same(e, "restore", from, saved, `restore differs from v${String(p.from)}`);
        break;
      }
      default:
        continue; // user, llm_error, manifest, redo: nothing to re-derive
    }
    // A new version (turn / edit / restore)
    checked++;
    if (e.version !== version + 1) miss(e, "version", `expected v${version + 1}, saved v${String(e.version)}`);
    version = e.version ?? version + 1;
    if (saved) {
      current = saved;
      byVersion.set(version, saved);
    }
    report.versions.push({ version, kind: e.kind, assets: saved?.assets?.length ?? 0, terrainHash: terrainHash(saved?.terrain) });
  }
  report.costMana = Math.round(report.costMana * 1000) / 1000;
  return { report, mismatches, checked };
}

/** Replay everything one research id planned. Read-only. */
export function replayResearch(db: Db, researchId: string): ReplayReport {
  const out: ReplayReport = { researchId, sessions: [], costMana: 0, checked: 0, mismatches: [] };
  for (const s of sessionsFor(db, researchId)) {
    const r = replaySession(s, eventsFor(db, s.id));
    out.sessions.push(r.report);
    out.mismatches.push(...r.mismatches);
    out.checked += r.checked;
    out.costMana += r.report.costMana;
  }
  out.costMana = Math.round(out.costMana * 1000) / 1000;
  return out;
}

/** An event as research sees it: blueprints without their stamp. */
function scrub(p: Record<string, unknown>): Record<string, unknown> {
  return "blueprint" in p ? { ...p, blueprint: stripMeta(p.blueprint) } : p;
}

/**
 * Write one JSONL line per session, keyed by research id (never the player
 * id). No ids = every player who has planned; their research ids are made
 * (and old sessions stamped) on the way. Returns the number of sessions.
 */
export function exportResearch(db: Db, write: (line: string) => void, researchIds?: string[]): number {
  if (!hasPlanTables(db)) return 0;
  if (!hasResearchColumn(db)) db.exec("ALTER TABLE plan_sessions ADD COLUMN research_id TEXT");
  let ids = researchIds?.filter(isResearchId) ?? [];
  if (!researchIds?.length) {
    const players = db.prepare("SELECT DISTINCT player_id FROM plan_sessions").all() as { player_id: string }[];
    ids = players.map((r) => researchIdFor(r.player_id, db));
  }
  const stamp = db.prepare("UPDATE plan_sessions SET research_id = ? WHERE player_id = ? AND research_id IS NULL");
  let n = 0;
  for (const researchId of ids) {
    const player = playerForResearchId(researchId, db);
    if (player) stamp.run(researchId, player);
    for (const s of sessionsFor(db, researchId)) {
      const events = eventsFor(db, s.id);
      const { report, mismatches } = replaySession(s, events);
      write(JSON.stringify({
        researchId,
        session: s.id,
        createdAt: s.created_at,
        events: events.map((e) => ({ seq: e.seq, kind: e.kind, ref: e.ref, model: e.model, costMana: e.cost_mana, version: e.version, at: e.at, payload: scrub(parse(e.payload)) })),
        replay: { ...report, mismatches },
      }));
      n++;
    }
  }
  return n;
}

// ── CLI ──────────────────────────────────────────────────────────────
function main(argv: string[]): void {
  const path = process.env.DB_PATH ?? resolve(process.cwd(), "data/universe.db");
  if (argv[0] === "--export" && argv[1]) {
    const db = new Database(path, { fileMustExist: true });
    const fd = openSync(argv[1], "w");
    try {
      const n = exportResearch(db, (line) => writeSync(fd, line + "\n"), argv.slice(2));
      console.error(`[replay] wrote ${n} session(s) to ${argv[1]}`);
    } finally {
      closeSync(fd);
      db.close();
    }
    return;
  }
  if (isResearchId(argv[0])) {
    const db = new Database(path, { fileMustExist: true, readonly: true });
    const report = replayResearch(db, argv[0]);
    db.close();
    console.log(JSON.stringify(report, null, 2));
    if (report.mismatches.length) process.exitCode = 1;
    return;
  }
  console.error("usage: replay <researchId>  |  replay --export out.jsonl [researchId ...]");
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));

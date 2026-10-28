/**
 * Research identity (Phase 07 Creation Archive; Rough Draft M5).
 *
 * Archive records (every provider call genai-service saves, research exports)
 * carry a `researchId`: random, one per player, never the player id, account
 * id or email. This table is the only place that maps it back:
 *
 *   research_identity (research_id, player_id, created_at)
 *
 * Research queries and exports never join it; only this service reads it (to
 * stamp new records) and Alex, for support or to replay a creation
 * (`replay.ts`). Deleting a player (`forgetPlayer`) removes their planner
 * history and this row, so archive records that remain can no longer be tied
 * to them (Privacy: "What you made with AI").
 */
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./persistence.js";

let ready: Database.Database | null = null;
function db(d: Database.Database = getDb()): Database.Database {
  if (ready !== d) {
    d.exec(`CREATE TABLE IF NOT EXISTS research_identity (
      research_id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL)`);
    ready = d;
  }
  return d;
}

/** A fresh research id: "r" + 20 hex (80 random bits). */
export const newResearchId = (): string => `r${randomBytes(10).toString("hex")}`;

export const isResearchId = (s: unknown): s is string => typeof s === "string" && /^r[0-9a-f]{20}$/.test(s);

/** The player's research id, made on first use. Stable for the player's lifetime. */
export function researchIdFor(playerId: string, d?: Database.Database): string {
  const conn = db(d);
  const row = conn.prepare("SELECT research_id FROM research_identity WHERE player_id = ?").get(playerId) as { research_id: string } | undefined;
  if (row) return row.research_id;
  const id = newResearchId();
  // INSERT OR IGNORE + reread: two first requests at once still end with one id
  conn.prepare("INSERT OR IGNORE INTO research_identity (research_id, player_id, created_at) VALUES (?, ?, ?)").run(id, playerId, Date.now());
  return (conn.prepare("SELECT research_id FROM research_identity WHERE player_id = ?").get(playerId) as { research_id: string }).research_id;
}

/** For stamping outgoing provider calls: never fails the request (no DB, no player → undefined). */
export function tryResearchId(playerId: string | null | undefined): string | undefined {
  if (!playerId) return undefined;
  try {
    return researchIdFor(playerId);
  } catch {
    return undefined;
  }
}

/** Who a research id belongs to (support / replay only; never in research exports). */
export function playerForResearchId(researchId: string, d?: Database.Database): string | null {
  const row = db(d).prepare("SELECT player_id FROM research_identity WHERE research_id = ?").get(researchId) as { player_id: string } | undefined;
  return row?.player_id ?? null;
}

/**
 * Delete a player's creation history on request (Privacy: delete your player):
 * their planner sessions + events and their research-id row. Archive records
 * elsewhere carry only the research id, so they can no longer be tied back.
 */
export function forgetPlayer(playerId: string, d?: Database.Database): { sessions: number; events: number; researchId: string | null } {
  const conn = db(d);
  const researchId = (conn.prepare("SELECT research_id FROM research_identity WHERE player_id = ?").get(playerId) as { research_id: string } | undefined)?.research_id ?? null;
  let sessions = 0, events = 0;
  conn.transaction(() => {
    const hasPlans = conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_sessions'").get();
    if (hasPlans) {
      events = conn.prepare("DELETE FROM plan_events WHERE session_id IN (SELECT id FROM plan_sessions WHERE player_id = ?)").run(playerId).changes;
      sessions = conn.prepare("DELETE FROM plan_sessions WHERE player_id = ?").run(playerId).changes;
    }
    conn.prepare("DELETE FROM research_identity WHERE player_id = ?").run(playerId);
  })();
  return { sessions, events, researchId };
}

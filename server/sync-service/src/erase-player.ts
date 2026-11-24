/**
 * Deleting a player (Alex, 2026-11-24: "build the delete player feature").
 *
 * "Delete my player" on the Privacy page means the person's whole account: every
 * character on it and everything linked to them. This module is the one place that
 * knows every table and document that holds a player id, an account id, a character
 * name, an e-mail or a passkey, and what happens to each: DELETE, ANONYMISE or KEEP.
 *
 *   DELETE      sign-in (user, account, passkey, session, verification), characters,
 *               where they stood, World Index, progress and awe, the 18+ choice, asks to
 *               build, mutes, the research identity link, what minds remember about
 *               them, safety flags, flight samples, reports against them, unpaid card orders
 *   DETACH      what they wrote stays as written, with nothing that says whose it was
 *               (Alex, 2026-11-24: a world's history keeps no gaps). Chat, the research
 *               copy and the visible log: the sender becomes FORMER_PLAYER_ID ("A former
 *               player"). Planner history: every session and event stays; the player id
 *               becomes a fresh random token per (character, world), so the story stone
 *               keeps that maker's place in the world's numbering ("Maker 2" stays Maker 2)
 *               and nothing links their worlds to each other. The words themselves can
 *               still say who wrote them: the confirm step and the Privacy page say so.
 *   ANONYMISE   things other people use, which stay with the player taken out
 *               (id → FORMER_PLAYER_ID, names dropped): worlds they created and things
 *               they placed, a world plan's "who added what" (those items are then locked:
 *               nobody reworks or drops them as theirs; the safer of the two choices,
 *               since handing them to the builders would need the planner to know owners),
 *               minds they wrote, games and Library entries they saved, credits, replays
 *               (an anonymous stand-in, match-store.ts), reports they filed, other makers'
 *               awe for their visits
 *   KEEP        accounting: the mana ledger and paid card orders keep their amounts and
 *               dates and lose the player (non-profit accounting, Privacy "How long we
 *               keep it"). The archive of AI requests stays under its research id.
 *
 * Three steps, each safe to run again (so a run that stopped half-way is finished by
 * running it again with the same ids):
 *   scrubUniverseDoc / scrubWorldDoc   the shared Yjs documents (pure; rooms.ts applies them)
 *   eraseRows                          every SQL table, in one transaction if the db has one
 *   the genai-service's own database   over HTTP, queued in `erase_pending` until it answers
 *
 * The audit line (`erase_audit`) holds when and how many rows of what. No ids, no names.
 *
 * Pure SQL over the minimal db interface (better-sqlite3 in the service, node:sqlite in
 * tests). Tables are made lazily by their modules, so every statement checks its table.
 */
import { randomBytes } from "node:crypto";
import * as Y from "yjs";
import { FORMER_PLAYER_ID } from "../../../shared/names.js";
import { eraseFromMatches } from "./match-store.js";
import { forgetDoor } from "./age-door.js";
import type { SqlDb } from "./build-requests.js";

/** The word the player types to confirm (the route refuses anything else). */
export const DELETE_CONFIRM_WORD = "DELETE";

export interface EraseTarget {
  /** Better Auth user id. */
  accountId: string;
  /** Every character (public player id) on the account. */
  playerIds: readonly string[];
  /** The account's e-mail as stored (real or the `.invalid` placeholder), for sign-in codes waiting under it. */
  email?: string | null;
}

/** table or document → how many rows / entries were deleted or changed. Only non-zero counts. */
export type EraseCounts = Record<string, number>;

const changes = (r: unknown): number => Number((r as { changes?: number | bigint } | undefined)?.changes ?? 0);

// ── The shared documents ─────────────────────────────────────────────

/** Game credits inside a game record: the erased makers become "a former player". Returns a new record, or null if unchanged. */
export function scrubGame(game: unknown, ids: ReadonlySet<string>): Record<string, unknown> | null {
  if (!game || typeof game !== "object" || Array.isArray(game)) return null;
  const credits = (game as { credits?: unknown }).credits;
  if (!Array.isArray(credits)) return null;
  const next = scrubCredits(credits, ids);
  return next ? { ...(game as Record<string, unknown>), credits: next } : null;
}

/** A credit chain with the erased makers taken out of it (the link stays, so versions still add up). Null if unchanged. */
export function scrubCredits(credits: unknown[], ids: ReadonlySet<string>): unknown[] | null {
  let hit = false;
  const next = credits.map((c) => {
    if (!c || typeof c !== "object" || typeof (c as { by?: unknown }).by !== "string" || !ids.has((c as { by: string }).by)) return c;
    hit = true;
    const { byName: _gone, ...rest } = c as Record<string, unknown>;
    return { ...rest, by: FORMER_PLAYER_ID };
  });
  return hit ? next : null;
}

/**
 * The universe document: worlds the erased player created stay, with no creator
 * (FORMER_PLAYER_ID: nobody inherits it, its builders keep their rights); the player
 * leaves every builders list. Returns the ids of the worlds changed.
 */
export function scrubUniverseDoc(doc: Y.Doc, ids: ReadonlySet<string>): string[] {
  const touched: string[] = [];
  doc.getMap("worlds").forEach((v, worldId) => {
    if (!(v instanceof Y.Map)) return;
    let hit = false;
    if (ids.has(v.get("creator") as string)) {
      v.set("creator", FORMER_PLAYER_ID);
      hit = true;
    }
    const co = v.get("coCreators");
    if (Array.isArray(co) && co.some((id) => ids.has(id))) {
      v.set("coCreators", co.filter((id) => !ids.has(id)));
      hit = true;
    }
    if (hit) touched.push(worldId);
  });
  return touched;
}

/**
 * One world's document.
 *   meta       creator → former player; out of the builders list; game credits anonymised
 *   objects    what they placed stays, `placedBy` → former player (so only the world's
 *              creator and builders can change it: nobody gains it by accident); their
 *              mark on a carried or kicked thing is dropped
 *   chat       every line stays, in place, as written; the sender becomes "A former
 *              player" (and so does the `to` of a mind's reply to them)
 * Run inside a transaction with a server origin. Returns what changed.
 */
export function scrubWorldDoc(doc: Y.Doc, ids: ReadonlySet<string>): { meta: number; objects: number; chat: number } {
  const out = { meta: 0, objects: 0, chat: 0 };
  const meta = doc.getMap("meta");
  if (ids.has(meta.get("creator") as string)) {
    meta.set("creator", FORMER_PLAYER_ID);
    out.meta++;
  }
  const co = meta.get("coCreators");
  if (Array.isArray(co) && co.some((id) => ids.has(id))) {
    meta.set("coCreators", co.filter((id) => !ids.has(id)));
    out.meta++;
  }
  const game = scrubGame(meta.get("game"), ids);
  if (game) {
    meta.set("game", game);
    out.meta++;
  }

  doc.getMap("objects").forEach((v) => {
    if (!(v instanceof Y.Map)) return;
    let hit = false;
    if (ids.has(v.get("placedBy") as string)) {
      v.set("placedBy", FORMER_PLAYER_ID);
      hit = true;
    }
    const carry = v.get("carry") as { by?: unknown } | undefined;
    if (carry && typeof carry === "object" && ids.has(carry.by as string)) {
      v.delete("carry");
      hit = true;
    }
    const kick = v.get("kick") as Record<string, unknown> | undefined;
    if (kick && typeof kick === "object" && ids.has(kick.by as string)) {
      const { by: _gone, ...rest } = kick;
      v.set("kick", rest);
      hit = true;
    }
    if (hit) out.objects++;
  });

  const chat = doc.getArray<Record<string, unknown>>("chat");
  const lines = chat.toArray();
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || typeof line !== "object") continue;
    const from = ids.has(line.sender as string), to = ids.has(line.to as string);
    if (!from && !to) continue;
    // A line is a plain value in the list: swap it for the same line without the id
    chat.delete(i, 1);
    chat.insert(i, [{ ...line, ...(from ? { sender: FORMER_PLAYER_ID } : {}), ...(to ? { to: FORMER_PLAYER_ID } : {}) }]);
    out.chat++;
  }
  return out;
}

// ── The tables ───────────────────────────────────────────────────────

/**
 * Every SQL table. Idempotent: a second run with the same target changes nothing and
 * returns `{}`. Other players' rows are only touched where they name this player.
 */
export function eraseRows(db: SqlDb, target: EraseTarget): EraseCounts {
  const run = () => eraseRowsNow(db, target);
  // better-sqlite3 has transactions (all or nothing); node:sqlite in tests runs the statements as they are
  const tx = (db as unknown as { transaction?: (fn: () => EraseCounts) => () => EraseCounts }).transaction;
  return typeof tx === "function" ? tx.call(db, run)() : run();
}

function eraseRowsNow(db: SqlDb, target: EraseTarget): EraseCounts {
  const { accountId } = target;
  const ids = [...new Set(target.playerIds)].filter((id) => id && id !== FORMER_PLAYER_ID);
  const idSet = new Set(ids);
  const counts: EraseCounts = {};
  const add = (key: string, n: number) => {
    if (n > 0) counts[key] = (counts[key] ?? 0) + n;
  };
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  const has = (t: string) => tables.has(t);
  const marks = ids.map(() => "?").join(",");
  /** `sql` once per table that exists; `:ids` expands to the player ids. */
  const each = (table: string, sql: string, ...params: unknown[]) => {
    if (!has(table) || (sql.includes(":ids") && ids.length === 0)) return;
    // Parameters are given in the order they appear; each `:ids` takes all the ids
    const args: unknown[] = [];
    let p = 0;
    for (const part of sql.split(/(:ids|\?)/)) {
      if (part === ":ids") args.push(...ids);
      else if (part === "?") args.push(params[p++]);
    }
    add(table, changes(db.prepare(sql.replaceAll(":ids", marks)).run(...args)));
  };

  // 1. Money first, while the card orders still say whose they are (KEEP, without the player)
  if (has("mana_ledger")) {
    // A character name shown in the sky with a card sale: off the public ledger
    if (has("card_orders") && ids.length) {
      each("mana_ledger", `UPDATE mana_ledger SET public_name = NULL WHERE public_name IS NOT NULL AND kind = 'inflow'
        AND ref IN (SELECT payment_ref FROM card_orders WHERE payment_ref IS NOT NULL AND player_id IN (:ids))`);
    }
    // Every entry stays (amount, date, what it paid for); who made the creation goes
    each("mana_ledger", "UPDATE mana_ledger SET player_id = NULL WHERE player_id IN (:ids)");
  }
  if (has("card_orders") && ids.length) {
    // Never paid: nothing to account for
    if (has("card_order_photos")) each("card_order_photos", "DELETE FROM card_order_photos WHERE order_id IN (SELECT id FROM card_orders WHERE player_id IN (:ids) AND status IN ('pending', 'cancelled', 'refunded', 'shipped'))");
    each("card_orders", "DELETE FROM card_orders WHERE player_id IN (:ids) AND status = 'pending' AND payment_ref IS NULL");
    // Done orders: the accounting record stays, the buyer's e-mail and name go
    each("card_orders", "UPDATE card_orders SET player_id = NULL, public_name = NULL, show_name = 0, email = NULL WHERE player_id IN (:ids) AND status IN ('pending', 'cancelled', 'refunded', 'shipped')");
    // Paid and not mailed yet: the e-mail (and the photo to print) stay until it ships, so the cards still arrive
    each("card_orders", "UPDATE card_orders SET player_id = NULL, public_name = NULL, show_name = 0 WHERE player_id IN (:ids)");
  }

  // 2. Replays stay with an anonymous stand-in; the research link goes
  for (const id of ids) add("matches", eraseFromMatches(db, id));
  if (has("matches")) {
    for (const id of ids) {
      // What `eraseFromMatches` does not reach: someone linked who got no slot, and the game's credits
      const rows = db.prepare("SELECT id, setup FROM matches WHERE instr(setup, ?) > 0").all(id) as { id: string; setup: string }[];
      for (const r of rows) {
        let next = r.setup;
        try {
          const setup = JSON.parse(r.setup) as { game?: unknown; formed?: { links?: { a: string; b: string }[]; together?: string[][] } };
          const game = scrubGame(setup.game, idSet);
          if (game) setup.game = game;
          if (setup.formed) {
            setup.formed.links = (setup.formed.links ?? []).filter((l) => !idSet.has(l.a) && !idSet.has(l.b));
            setup.formed.together = (setup.formed.together ?? []).map((g) => g.filter((p) => !idSet.has(p))).filter((g) => g.length > 1);
          }
          next = JSON.stringify(setup);
        } catch { /* not JSON: handled below */ }
        // Anywhere else it could be: never leave the id behind
        if (next.includes(id)) next = next.split(id).join(FORMER_PLAYER_ID);
        if (next !== r.setup) add("matches.setup", changes(db.prepare("UPDATE matches SET setup = ? WHERE id = ?").run(next, r.id)));
      }
    }
  }
  // Planner history stays whole (a world's story keeps no gaps), detached: a fresh random token per
  // (character, world) in place of the player id. The story stone numbers makers by this column in the
  // order they first spoke, so the maker keeps their number there; the token means nothing anywhere else.
  if (has("plan_sessions")) {
    for (const id of ids) {
      const worlds = db.prepare("SELECT DISTINCT world_id FROM plan_sessions WHERE player_id = ?").all(id) as { world_id: string }[];
      for (const w of worlds) {
        const token = `${FORMER_PLAYER_ID}:${randomBytes(8).toString("hex")}`;
        if (has("plan_events")) {
          // An event that carries the id in its payload (none do today) loses it too
          const evs = db.prepare("SELECT seq, payload FROM plan_events WHERE instr(payload, ?) > 0 AND session_id IN (SELECT id FROM plan_sessions WHERE player_id = ? AND world_id = ?)").all(id, id, w.world_id) as { seq: number; payload: string }[];
          for (const e of evs) add("plan_events", changes(db.prepare("UPDATE plan_events SET payload = ? WHERE seq = ?").run(e.payload.split(id).join(token), e.seq)));
        }
        add("plan_sessions", changes(db.prepare("UPDATE plan_sessions SET player_id = ? WHERE player_id = ? AND world_id = ?").run(token, id, w.world_id)));
      }
    }
  }
  each("research_identity", "DELETE FROM research_identity WHERE player_id IN (:ids)");
  // A world's plan stays (the world grows from it); who added each item becomes nobody, so nobody else can rework it as theirs
  if (has("world_plans")) {
    for (const id of ids) {
      const rows = db.prepare("SELECT world_id, owners FROM world_plans WHERE instr(owners, ?) > 0").all(id) as { world_id: string; owners: string }[];
      for (const r of rows) {
        try {
          const owners = JSON.parse(r.owners) as Record<string, Record<string, string>>;
          for (const m of Object.values(owners)) for (const k of Object.keys(m ?? {})) if (idSet.has(m[k])) m[k] = FORMER_PLAYER_ID;
          add("world_plans", changes(db.prepare("UPDATE world_plans SET owners = ? WHERE world_id = ?").run(JSON.stringify(owners), r.world_id)));
        } catch {
          add("world_plans", changes(db.prepare("UPDATE world_plans SET owners = ? WHERE world_id = ?").run(r.owners.split(id).join(FORMER_PLAYER_ID), r.world_id)));
        }
      }
    }
  }

  // 3. Chat (the research copy: every message stays as written, from "a former player"), safety flags, reports
  each("chat_messages", "UPDATE chat_messages SET player_id = ? WHERE player_id IN (:ids)", FORMER_PLAYER_ID);
  each("safety_flag", "DELETE FROM safety_flag WHERE player_id IN (:ids)");
  each("report", "DELETE FROM report WHERE target_id IN (:ids)"); // a report about someone who no longer exists
  // A report they filed is about someone else's conduct: it stays, without the reporter or their own words
  each("report", "UPDATE report SET reporter_id = ?, account_id = ?, note = '' WHERE reporter_id IN (:ids)", FORMER_PLAYER_ID, FORMER_PLAYER_ID);
  each("report", "UPDATE report SET reporter_id = ?, account_id = ?, note = '' WHERE account_id = ?", FORMER_PLAYER_ID, FORMER_PLAYER_ID, accountId);
  each("player_mute", "DELETE FROM player_mute WHERE account_id = ?", accountId);
  each("player_mute", "DELETE FROM player_mute WHERE target_id IN (:ids)");

  // 4. Making things: jobs in flight, minds, games
  each("creations", "DELETE FROM creations WHERE player_id IN (:ids)");
  each("animations", "UPDATE animations SET player_id = ? WHERE player_id IN (:ids)", FORMER_PLAYER_ID);
  each("mind_memory", "DELETE FROM mind_memory WHERE player_id IN (:ids)");
  each("mind_library_memory", "DELETE FROM mind_library_memory WHERE player_id IN (:ids)");
  // A mind is never erased (it belongs to the creation, in a world others visit): its writer becomes nobody
  each("minds", "UPDATE minds SET creator = ? WHERE creator IN (:ids)", FORMER_PLAYER_ID);
  each("mind_versions", "UPDATE mind_versions SET player_id = ? WHERE player_id IN (:ids)", FORMER_PLAYER_ID);
  each("mind_nodes", "UPDATE mind_nodes SET player_id = ? WHERE player_id IN (:ids)", FORMER_PLAYER_ID);
  each("mind_library", "UPDATE mind_library SET saved_by = ? WHERE saved_by IN (:ids)", FORMER_PLAYER_ID);
  if (has("minds")) {
    const cols = new Set((db.prepare("PRAGMA table_info(minds)").all() as { name: string }[]).map((c) => c.name));
    if (cols.has("origin")) {
      for (const id of ids) {
        const rows = db.prepare("SELECT world_id, object_id, origin FROM minds WHERE origin IS NOT NULL AND instr(origin, ?) > 0").all(id) as { world_id: string; object_id: string; origin: string }[];
        for (const r of rows) add("minds", changes(db.prepare("UPDATE minds SET origin = ? WHERE world_id = ? AND object_id = ?").run(r.origin.split(id).join(FORMER_PLAYER_ID), r.world_id, r.object_id)));
      }
    }
  }
  // Games: every version is kept as long as replays that ran on it (Privacy), so the rows stay and the maker goes
  each("world_games", "UPDATE world_games SET updated_by = ? WHERE updated_by IN (:ids)", FORMER_PLAYER_ID);
  each("world_game_versions", "UPDATE world_game_versions SET saved_by = ? WHERE saved_by IN (:ids)", FORMER_PLAYER_ID);
  each("game_library", `UPDATE game_library SET "by" = ? WHERE "by" IN (:ids)`, FORMER_PLAYER_ID);
  each("game_library_versions", "UPDATE game_library_versions SET saved_by = ? WHERE saved_by IN (:ids)", FORMER_PLAYER_ID);
  const gameJson: [table: string, key: string, column: string][] = [
    ["world_games", "world_id", "game"], ["world_game_versions", "world_id, version", "game"],
    ["game_library_versions", "library_id, version", "game"], ["game_library_versions", "library_id, version", "credits"],
  ];
  for (const [table, key, column] of gameJson) {
    if (!has(table)) continue;
    const keys = key.split(", ");
    for (const id of ids) {
      const rows = db.prepare(`SELECT ${key}, ${column} AS json FROM ${table} WHERE instr(${column}, ?) > 0`).all(id) as Record<string, unknown>[];
      for (const r of rows) {
        const json = String(r.json);
        let next = json;
        try {
          const v = JSON.parse(json) as unknown;
          const fixed = Array.isArray(v) ? scrubCredits(v, idSet) : scrubGame(v, idSet);
          if (fixed) next = JSON.stringify(fixed);
        } catch { /* handled below */ }
        if (next.includes(id)) next = next.split(id).join(FORMER_PLAYER_ID);
        if (next !== json) {
          add(`${table}.${column}`, changes(db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${keys.map((k) => `${k} = ?`).join(" AND ")}`).run(next, ...keys.map((k) => r[k]))));
        }
      }
    }
  }

  // 5. Playing: progress and awe, where they stood, flight, the World Index, the 18+ choice, asks to build
  each("xp_event", "DELETE FROM xp_event WHERE character_id IN (:ids)");
  each("progress", "DELETE FROM progress WHERE character_id IN (:ids)");
  // Other makers keep the awe this player's first visits gave them; the visitor's account id leaves the entry
  // (the entry's id keeps it unique, as the account id did)
  each("xp_event", "UPDATE xp_event SET ref = substr(ref, 1, length(ref) - length(?)) || 'former-' || id WHERE kind = 'reaction' AND substr(ref, length(ref) - length(?)) = ':' || ?", accountId, accountId, accountId);
  each("character_location", "DELETE FROM character_location WHERE characterId IN (:ids)");
  each("flight_samples", "DELETE FROM flight_samples WHERE player_id IN (:ids)");
  each("sim_last_known", "DELETE FROM sim_last_known WHERE player_id IN (:ids)");
  each("world_index", "DELETE FROM world_index WHERE accountId = ?", accountId);
  each("world_index", "UPDATE world_index SET characterId = NULL WHERE characterId IN (:ids)");
  if (forgetDoor(db, accountId)) add("age_door", 1);
  each("build_request_inbox", "DELETE FROM build_request_inbox WHERE account_id = ?", accountId);
  each("build_request_inbox", "DELETE FROM build_request_inbox WHERE owner_id IN (:ids)");
  each("build_requests", "DELETE FROM build_requests WHERE account_id = ?", accountId);
  each("build_requests", "DELETE FROM build_requests WHERE requester IN (:ids)");
  each("build_requests", "UPDATE build_requests SET decided_by = NULL WHERE decided_by IN (:ids)");

  // 6. Last, the sign-in itself (Better Auth's tables) and the characters: after this the account is gone
  each("session_character", "DELETE FROM session_character WHERE characterId IN (:ids)");
  if (has("session")) each("session_character", "DELETE FROM session_character WHERE sessionId IN (SELECT id FROM session WHERE userId = ?)", accountId);
  each("session", "DELETE FROM session WHERE userId = ?", accountId);
  each("passkey", "DELETE FROM passkey WHERE userId = ?", accountId);
  each("account", "DELETE FROM account WHERE userId = ?", accountId);
  // Sign-in codes waiting under their e-mail (the identifier carries the address)
  const email = (target.email ?? "").trim().toLowerCase();
  if (email) each("verification", "DELETE FROM verification WHERE instr(lower(identifier), ?) > 0 OR instr(lower(value), ?) > 0", email, email);
  each("verification", "DELETE FROM verification WHERE instr(identifier, ?) > 0 OR instr(value, ?) > 0", accountId, accountId);
  each("character", "DELETE FROM character WHERE accountId = ?", accountId);
  each("character", "DELETE FROM character WHERE id IN (:ids)");
  each("user", `DELETE FROM "user" WHERE id = ?`, accountId);
  return counts;
}

// ── The audit line and the genai queue ───────────────────────────────

function ensureEraseTables(db: SqlDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS erase_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
      characters INTEGER NOT NULL,   -- how many characters the account had
      counts TEXT NOT NULL           -- JSON: table or document → rows changed. No ids, no names.
    );
    -- The genai-service keeps its own database (job history with the maker's player id, the Library
    -- with the maker's pseudonym). It is told over HTTP; until it answers, the ids wait here.
    CREATE TABLE IF NOT EXISTS erase_pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, audit_id INTEGER, player_ids TEXT NOT NULL
    );
  `);
}

/** Write the audit line: when, how many characters, how many rows of what. Returns its id. */
export function writeEraseAudit(db: SqlDb, characters: number, counts: EraseCounts, at: number): number {
  ensureEraseTables(db);
  const r = db.prepare("INSERT INTO erase_audit (at, characters, counts) VALUES (?, ?, ?)").run(at, characters, JSON.stringify(counts));
  return Number((r as { lastInsertRowid?: number | bigint }).lastInsertRowid ?? 0);
}

/** Add what a later step found (the genai-service answering) to an audit line. */
export function amendEraseAudit(db: SqlDb, auditId: number, more: EraseCounts): void {
  ensureEraseTables(db);
  const row = db.prepare("SELECT counts FROM erase_audit WHERE id = ?").get(auditId) as { counts: string } | undefined;
  if (!row) return;
  let counts: EraseCounts = {};
  try { counts = JSON.parse(row.counts) as EraseCounts; } catch { /* start over */ }
  for (const [k, v] of Object.entries(more)) if (v > 0) counts[k] = (counts[k] ?? 0) + v;
  db.prepare("UPDATE erase_audit SET counts = ? WHERE id = ?").run(JSON.stringify(counts), auditId);
}

export function eraseAudit(db: SqlDb, limit = 50): { id: number; at: number; characters: number; counts: EraseCounts }[] {
  ensureEraseTables(db);
  return (db.prepare("SELECT id, at, characters, counts FROM erase_audit ORDER BY id DESC LIMIT ?").all(limit) as { id: number; at: number; characters: number; counts: string }[])
    .map((r) => ({ id: r.id, at: r.at, characters: r.characters, counts: JSON.parse(r.counts) as EraseCounts }));
}

/** Queue the genai-service step (its counts are added to audit line `auditId` when it answers). */
export function queueGenaiForget(db: SqlDb, playerIds: readonly string[], at: number, auditId: number | null = null): number {
  ensureEraseTables(db);
  const r = db.prepare("INSERT INTO erase_pending (at, audit_id, player_ids) VALUES (?, ?, ?)").run(at, auditId, JSON.stringify(playerIds));
  return Number((r as { lastInsertRowid?: number | bigint }).lastInsertRowid ?? 0);
}

/** Tells the genai-service (POST /forget). Resolves to its counts, or null if it could not be reached. */
export type GenaiForget = (playerIds: string[]) => Promise<EraseCounts | null>;

/**
 * Tell the genai-service about every queued player; a row leaves the queue only when it
 * answers. Called right after an erase and again on a timer, so a genai-service that was
 * down is told later. Returns how many are still waiting.
 */
export async function flushGenaiForget(db: SqlDb, forget: GenaiForget): Promise<number> {
  ensureEraseTables(db);
  const rows = db.prepare("SELECT id, audit_id, player_ids FROM erase_pending ORDER BY id LIMIT 50").all() as { id: number; audit_id: number | null; player_ids: string }[];
  let waiting = 0;
  for (const r of rows) {
    let ids: string[] = [];
    try { ids = JSON.parse(r.player_ids) as string[]; } catch { /* nothing to tell */ }
    const counts = ids.length ? await forget(ids).catch(() => null) : {};
    if (counts === null) {
      waiting++;
      continue;
    }
    db.prepare("DELETE FROM erase_pending WHERE id = ?").run(r.id);
    if (r.audit_id !== null) amendEraseAudit(db, r.audit_id, counts);
  }
  return waiting;
}

// ── Asking: once in a while, not in a loop ───────────────────────────

/** Delete attempts per key (an account, an address) per hour. Wrong word, stale sign-in and success all count. */
export class EraseLimiter {
  private readonly seen = new Map<string, number[]>();
  constructor(private readonly max = 5, private readonly windowMs = 3600_000) {}
  take(key: string, now = Date.now()): boolean {
    const recent = (this.seen.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(key, recent);
    if (this.seen.size > 20_000) for (const [k, v] of this.seen) if (v.every((t) => now - t >= this.windowMs)) this.seen.delete(k);
    return true;
  }
}

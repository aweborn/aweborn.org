/**
 * Aweborn — Characters and the World Index (I5).
 *
 * An *account* is one Better Auth user (a saved player). Saved players never
 * merge (Alex, 2026-10-12). What does carry over is anonymous play: when an
 * anonymous device signs in to an account, its *character* (a `playerId`:
 * public presence colour, world `creator`) and its World Index join that
 * account, and the device keeps playing it. Each session plays one character
 * (`session_character`) and can switch to any of the account's characters.
 *
 * The World Index is per account (any character can warp to anything the
 * person has found).
 *
 * Tables live in `universe.db` beside the auth tables, so backups/DR cover them.
 */

import type Database from "better-sqlite3";
import type { DiscoveryMethod, WorldIndexEntry, WorldIndexState } from "../../../shared/crdt-schema.js";

let db: Database.Database;

export function initIdentity(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS character (
      id TEXT PRIMARY KEY,          -- the public playerId
      accountId TEXT NOT NULL,      -- Better Auth user id
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS character_account ON character(accountId);

    CREATE TABLE IF NOT EXISTS session_character (
      sessionId TEXT PRIMARY KEY,
      characterId TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_index (
      accountId TEXT NOT NULL,
      worldId TEXT NOT NULL,
      characterId TEXT,             -- who found it first
      discoveredAt INTEGER NOT NULL,
      PRIMARY KEY (accountId, worldId)
    );
  `);
  // 08B: two states + how it was found. Rows from before this were all
  // recorded by entering a world, i.e. visited by flight.
  const cols = new Set((db.prepare(`PRAGMA table_info(world_index)`).all() as { name: string }[]).map((c) => c.name));
  const add = (name: string, def: string) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE world_index ADD COLUMN ${name} ${def}`);
  };
  add("state", "TEXT NOT NULL DEFAULT 'visited'");
  add("method", "TEXT NOT NULL DEFAULT 'flight'");
  add("visitCount", "INTEGER NOT NULL DEFAULT 1");
  add("visitedAt", "INTEGER");
  add("lastVisitedAt", "INTEGER");
  db.exec(
    `UPDATE world_index SET visitedAt = discoveredAt, lastVisitedAt = discoveredAt
       WHERE state = 'visited' AND visitedAt IS NULL`,
  );
}

/** Make sure a character row exists. Never steals one owned by another account. */
function ensureCharacter(characterId: string, accountId: string): void {
  db.prepare(`INSERT OR IGNORE INTO character (id, accountId, createdAt) VALUES (?, ?, ?)`).run(
    characterId,
    accountId,
    Date.now(),
  );
}

function ownsCharacter(accountId: string, characterId: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM character WHERE id = ? AND accountId = ?`).get(characterId, accountId),
  );
}

export interface Identity {
  accountId: string;
  /** The character this session plays (public playerId). */
  playerId: string;
}

/**
 * Which character a session plays: the one chosen for this session if the
 * account still owns it, else the user's home character.
 */
export function resolveIdentity(userId: string, homePlayerId: string, sessionId: string): Identity {
  ensureCharacter(homePlayerId, userId);
  const chosen = db.prepare(`SELECT characterId FROM session_character WHERE sessionId = ?`).get(sessionId) as
    | { characterId: string }
    | undefined;
  if (chosen && ownsCharacter(userId, chosen.characterId)) {
    return { accountId: userId, playerId: chosen.characterId };
  }
  return { accountId: userId, playerId: homePlayerId };
}

export function setSessionCharacter(sessionId: string, characterId: string): void {
  db.prepare(
    `INSERT INTO session_character (sessionId, characterId) VALUES (?, ?)
     ON CONFLICT(sessionId) DO UPDATE SET characterId = excluded.characterId`,
  ).run(sessionId, characterId);
}

/** Switch a session to another character of the same account. */
export function switchCharacter(accountId: string, sessionId: string, characterId: string): boolean {
  if (!ownsCharacter(accountId, characterId)) return false;
  setSessionCharacter(sessionId, characterId);
  return true;
}

export function listCharacters(accountId: string): { id: string; createdAt: number }[] {
  return db
    .prepare(`SELECT id, createdAt FROM character WHERE accountId = ? ORDER BY createdAt`)
    .all(accountId) as { id: string; createdAt: number }[];
}

/**
 * An anonymous player signed in to an account. Its character and World Index
 * join that account (Better Auth then deletes the anonymous user row; the
 * character lives on, so worlds it created keep their `creator`).
 */
export function absorbAnonymous(anonUserId: string, anonPlayerId: string, intoUserId: string): void {
  db.transaction(() => {
    ensureCharacter(anonPlayerId, anonUserId);
    db.prepare(`UPDATE character SET accountId = ? WHERE accountId = ?`).run(intoUserId, anonUserId);
    db.prepare(
      `INSERT INTO world_index (accountId, worldId, characterId, discoveredAt, state, method, visitCount, visitedAt, lastVisitedAt)
         SELECT ?, worldId, characterId, discoveredAt, state, method, visitCount, visitedAt, lastVisitedAt
           FROM world_index WHERE accountId = ?
       ON CONFLICT(accountId, worldId) DO UPDATE SET
         characterId = CASE WHEN excluded.discoveredAt < world_index.discoveredAt
                            THEN excluded.characterId ELSE world_index.characterId END,
         method = CASE
                       WHEN excluded.discoveredAt < world_index.discoveredAt THEN excluded.method
                       ELSE world_index.method END,
         discoveredAt = MIN(world_index.discoveredAt, excluded.discoveredAt),
         state = CASE WHEN 'visited' IN (excluded.state, world_index.state) THEN 'visited' ELSE 'sighted' END,
         visitCount = world_index.visitCount + excluded.visitCount,
         visitedAt = MIN(COALESCE(world_index.visitedAt, excluded.visitedAt), COALESCE(excluded.visitedAt, world_index.visitedAt)),
         lastVisitedAt = MAX(COALESCE(world_index.lastVisitedAt, excluded.lastVisitedAt), COALESCE(excluded.lastVisitedAt, world_index.lastVisitedAt))`,
    ).run(intoUserId, anonUserId);
    db.prepare(`DELETE FROM world_index WHERE accountId = ?`).run(anonUserId);
  })();
}

/** A real (not placeholder) verified email, usable for email-code sign-in. */
export function realEmail(user: { email?: string | null; emailVerified?: boolean | number | null }): string | null {
  return user.email && user.emailVerified && !user.email.endsWith(".invalid") ? user.email : null;
}

export interface WaysIn {
  passkeys: { id: string; name: string | null; createdAt: number | string; credentialID: string }[];
  google: boolean;
  email: string | null;
  password: boolean;
  /** Account row ids, which `/unlink-account` needs (it takes an id, not a provider). */
  accountIds: { google: string | null; password: string | null };
}

/** Every way into an account, for the panel and the keep-one rule. */
export function waysIn(userId: string): WaysIn {
  const passkeys = db
    .prepare(`SELECT id, name, createdAt, credentialID FROM passkey WHERE userId = ? ORDER BY createdAt`)
    .all(userId) as WaysIn["passkeys"];
  const accounts = db.prepare(`SELECT id, providerId FROM account WHERE userId = ?`).all(userId) as {
    id: string;
    providerId: string;
  }[];
  const idOf = (provider: string) => accounts.find((a) => a.providerId === provider)?.id ?? null;
  const user = db.prepare(`SELECT email, emailVerified FROM "user" WHERE id = ?`).get(userId) as
    | { email: string; emailVerified: number }
    | undefined;
  const google = idOf("google");
  const password = idOf("credential");
  return {
    passkeys,
    google: google !== null,
    email: user ? realEmail(user) : null,
    password: password !== null,
    accountIds: { google, password },
  };
}

export function countWaysIn(w: WaysIn): number {
  return w.passkeys.length + (w.google ? 1 : 0) + (w.email ? 1 : 0);
  // (A password always comes with a verified email, so it isn't a separate way in.)
}

// ── World Index ──────────────────────────────────────────────────────────────

/** Arrivals closer together than this count as one visit (reconnects, hopping in and out). */
export const VISIT_DEDUPE_MS = 30_000;

export interface DiscoveryResult {
  /** First time this account has found the world at all. */
  isNew: boolean;
  /** This event turned it visited (new or sighted → visited): the card reveal. */
  firstVisit: boolean;
}

/**
 * Record a sighting or a visit. A world only moves sighted → visited; a
 * sighting of a known world changes nothing, except that an earlier `now`
 * (an offline sighting arriving late) moves the discovery earlier.
 */
export function recordDiscovery(
  accountId: string,
  worldId: string,
  characterId: string | null,
  state: WorldIndexState = "visited",
  method: DiscoveryMethod = "flight",
  now: number = Date.now(),
): DiscoveryResult {
  return db.transaction((): DiscoveryResult => {
    const row = db
      .prepare(`SELECT state, discoveredAt, lastVisitedAt FROM world_index WHERE accountId = ? AND worldId = ?`)
      .get(accountId, worldId) as
      | { state: WorldIndexState; discoveredAt: number; lastVisitedAt: number | null }
      | undefined;
    const visited = state === "visited";
    if (!row) {
      db.prepare(
        `INSERT INTO world_index (accountId, worldId, characterId, discoveredAt, state, method, visitCount, visitedAt, lastVisitedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        accountId,
        worldId,
        characterId,
        now,
        state,
        method,
        visited ? 1 : 0,
        visited ? now : null,
        visited ? now : null,
      );
      return { isNew: true, firstVisit: visited };
    }
    if (now < row.discoveredAt) {
      db.prepare(
        `UPDATE world_index SET discoveredAt = ?, characterId = ?, method = ? WHERE accountId = ? AND worldId = ?`,
      ).run(now, characterId, method, accountId, worldId);
    }
    if (!visited) return { isNew: false, firstVisit: false };
    const firstVisit = row.state === "sighted";
    const repeat = !firstVisit && row.lastVisitedAt !== null && now - row.lastVisitedAt < VISIT_DEDUPE_MS;
    db.prepare(
      `UPDATE world_index SET
         state = 'visited',
         visitCount = visitCount + ?,
         visitedAt = COALESCE(visitedAt, ?),
         lastVisitedAt = ?
       WHERE accountId = ? AND worldId = ?`,
    ).run(repeat ? 0 : 1, now, now, accountId, worldId);
    return { isNew: false, firstVisit };
  })();
}

export function worldIndex(accountId: string): WorldIndexEntry[] {
  return db
    .prepare(
      `SELECT worldId, state, method, characterId, discoveredAt, visitedAt, visitCount, lastVisitedAt
         FROM world_index WHERE accountId = ? ORDER BY discoveredAt`,
    )
    .all(accountId) as WorldIndexEntry[];
}

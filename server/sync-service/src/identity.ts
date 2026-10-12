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
      `INSERT INTO world_index (accountId, worldId, characterId, discoveredAt)
         SELECT ?, worldId, characterId, discoveredAt FROM world_index WHERE accountId = ?
       ON CONFLICT(accountId, worldId) DO UPDATE SET
         characterId = CASE WHEN excluded.discoveredAt < world_index.discoveredAt
                            THEN excluded.characterId ELSE world_index.characterId END,
         discoveredAt = MIN(world_index.discoveredAt, excluded.discoveredAt)`,
    ).run(intoUserId, anonUserId);
    db.prepare(`DELETE FROM world_index WHERE accountId = ?`).run(anonUserId);
  })();
}

/** A real (not placeholder) verified email, usable for email-code sign-in. */
export function realEmail(user: { email?: string | null; emailVerified?: boolean | number | null }): string | null {
  return user.email && user.emailVerified && !user.email.endsWith(".invalid") ? user.email : null;
}

export interface WaysIn {
  passkeys: { id: string; name: string | null; createdAt: number | string }[];
  google: boolean;
  email: string | null;
  password: boolean;
  /** Account row ids, which `/unlink-account` needs (it takes an id, not a provider). */
  accountIds: { google: string | null; password: string | null };
}

/** Every way into an account, for the panel and the keep-one rule. */
export function waysIn(userId: string): WaysIn {
  const passkeys = db
    .prepare(`SELECT id, name, createdAt FROM passkey WHERE userId = ? ORDER BY createdAt`)
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

/** Record that an account found a world (first time wins; later visits no-op). */
export function recordDiscovery(accountId: string, worldId: string, characterId: string | null): boolean {
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO world_index (accountId, worldId, characterId, discoveredAt) VALUES (?, ?, ?, ?)`,
    )
    .run(accountId, worldId, characterId, Date.now());
  return res.changes > 0;
}

export function worldIndex(accountId: string): { worldId: string; characterId: string | null; discoveredAt: number }[] {
  return db
    .prepare(`SELECT worldId, characterId, discoveredAt FROM world_index WHERE accountId = ? ORDER BY discoveredAt`)
    .all(accountId) as { worldId: string; characterId: string | null; discoveredAt: number }[];
}

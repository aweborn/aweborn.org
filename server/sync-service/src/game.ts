/**
 * A world's game, stored (Phase 10, slice 1): see shared/game.ts for the record.
 *
 * Two tables in universe.db (so the hourly/S3 backups cover them):
 *   world_games          the world's current game (absent = the world has no game)
 *   world_game_versions  every version ever saved, never deleted
 *
 * Why a table and not only the world doc (decided 2026-11-23): matches will record
 * the game version they ran, and replays are kept forever, so every version has to
 * stay readable after the game changes or is removed. The server is the only writer
 * (Phase 09's direction): it validates, bumps the version, stores it here, then
 * writes a copy into the world doc's `meta.game` so every client gets it through the
 * world sync. Clients can't write that key (shared/world-policy.ts).
 *
 * `by` is the character who saved the version: the credit chain games will carry to
 * the Library (Q13), like `placedBy` on objects.
 *
 * Pure SQL over a minimal db interface (better-sqlite3 in the service, node:sqlite in
 * tests). Every method is synchronous.
 */
import { parseGame, sameGame, type Game } from "../../../shared/game.js";
import type { SqlDb } from "./build-requests.js";

export type SaveGameResult =
  | { ok: true; game: Game; changed: boolean; warnings: string[] }
  | { ok: false; error: "bad_game"; message: string };

export class WorldGames {
  constructor(private readonly db: SqlDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS world_games (
        world_id TEXT PRIMARY KEY, version INTEGER NOT NULL, game TEXT NOT NULL,
        updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_game_versions (
        world_id TEXT NOT NULL, version INTEGER NOT NULL, game TEXT NOT NULL,
        saved_at INTEGER NOT NULL, saved_by TEXT NOT NULL,
        PRIMARY KEY (world_id, version)
      );
    `);
  }

  private read(json: string | undefined): Game | null {
    if (!json) return null;
    try {
      const p = parseGame(JSON.parse(json));
      return p.ok ? p.value : null;
    } catch {
      return null;
    }
  }

  /** The world's current game, or null. */
  get(worldId: string): Game | null {
    const row = this.db.prepare("SELECT game FROM world_games WHERE world_id = ?").get(worldId) as { game: string } | undefined;
    return this.read(row?.game);
  }

  /** One saved version (what a match ran), even after the game changed or was removed. */
  getVersion(worldId: string, version: number): Game | null {
    const row = this.db.prepare("SELECT game FROM world_game_versions WHERE world_id = ? AND version = ?").get(worldId, version) as { game: string } | undefined;
    return this.read(row?.game);
  }

  /** The highest version this world ever had (versions are never reused, even after a removal). */
  private lastVersion(worldId: string): number {
    const row = this.db.prepare("SELECT MAX(version) AS v FROM world_game_versions WHERE world_id = ?").get(worldId) as { v: number | null } | undefined;
    return row?.v ?? 0;
  }

  /**
   * Validate and save a game as the next version. An unchanged game keeps its version.
   * The caller has already checked that `by` may write this world's game.
   */
  save(worldId: string, raw: unknown, by: string, now = Date.now()): SaveGameResult {
    const p = parseGame(raw);
    if (!p.ok) return { ok: false, error: "bad_game", message: p.errors.join("; ") };
    const current = this.get(worldId);
    if (current && sameGame(current, p.value)) return { ok: true, game: current, changed: false, warnings: p.warnings };
    const game: Game = { ...p.value, version: this.lastVersion(worldId) + 1 };
    const json = JSON.stringify(game);
    this.db.prepare("INSERT INTO world_game_versions (world_id, version, game, saved_at, saved_by) VALUES (?, ?, ?, ?, ?)").run(worldId, game.version, json, now, by);
    this.db.prepare(`INSERT INTO world_games (world_id, version, game, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (world_id) DO UPDATE SET version = excluded.version, game = excluded.game, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(worldId, game.version, json, now, by);
    return { ok: true, game, changed: true, warnings: p.warnings };
  }

  /** The world stops being a game. Its saved versions stay (replays need them). True if it had one. */
  remove(worldId: string): boolean {
    const had = this.get(worldId) !== null || this.db.prepare("SELECT 1 FROM world_games WHERE world_id = ?").get(worldId) !== undefined;
    this.db.prepare("DELETE FROM world_games WHERE world_id = ?").run(worldId);
    return had;
  }
}

/**
 * The game Library (Phase 10, slice 7, Q13): games travel. A world's owners save its game
 * (rules, zones, lobby, NPC roster, and a snapshot of the things on the stage) as a
 * Library game; any world's owners can bring one in. Versioned and credited like minds.
 *
 * Two tables in universe.db:
 *   game_library           one row per Library game: its name, who made it, the world it came from, the latest version
 *   game_library_versions  every version, never deleted: the game and the stage's objects, both with
 *                          coordinates **relative to the arena's `at`** (so it can be put anywhere),
 *                          and the credit chain the game carried when it was saved
 *
 * Saving again from the same world by the same account makes the next version of the same
 * Library game (an unchanged save keeps its version). Bringing appends
 * `{ libraryId, version, by, name }` to the game's `credits`: who made which version of
 * which Library game, newest last. Credits are server-written (game.ts ignores a client's).
 *
 * The snapshot holds plain things only: type, place, turn, size, look and asset. Never a
 * mind (minds travel through their own shelf), never who placed it, no signs (their text
 * is the placer's words). At most LIBRARY_OBJECTS_MAX objects.
 *
 * Pure SQL over the minimal db interface, like game.ts. The routes are in index.ts.
 */
import { randomUUID } from "node:crypto";
import { inBounds, stageOf, type Game, type GameCredit, type Vec3 } from "../../../shared/game.js";
import { isSaneObject } from "../../../shared/world-policy.js";
import type { SqlDb } from "./build-requests.js";

export const LIBRARY_OBJECTS_MAX = 200;
export const LIBRARY_NAME_MIN = 3;
export const LIBRARY_NAME_MAX = 40;
export const LIBRARY_LIST_MAX = 60;

/** What the client lists (the brief's `LibraryGame`). */
export interface LibraryGame {
  id: string;
  name: string;
  version: number;
  template: string;
  /** The character who made it. */
  by: string;
  byName: string;
  credits: GameCredit[];
  updatedAt: number;
  mine: boolean;
}

/** One thing from the stage, relative to the arena. */
export type LibraryObject = Record<string, string | number | boolean>;

type Rec = Record<string, unknown>;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const shift = (p: Vec3, by: Vec3, sign: 1 | -1): Vec3 => [round2(p[0] + sign * by[0]), round2(p[1] + sign * by[1]), round2(p[2] + sign * by[2])];

function translate(game: Game, by: Vec3, sign: 1 | -1): Game {
  return {
    ...game,
    arena: game.arena ? { ...game.arena, at: shift(game.arena.at, by, sign) } : null,
    zones: game.zones.map((z) => ({ ...z, at: shift(z.at, by, sign) })),
    lobby: game.lobby
      ? { ...game.lobby, at: shift(game.lobby.at, by, sign), ring: { ...game.lobby.ring, at: shift(game.lobby.ring.at, by, sign) }, arrival: shift(game.lobby.arrival, by, sign) }
      : null,
  };
}

/** The game with the arena's floor middle at the origin (zones and lobby keep their offsets). Null without an arena. */
export function relativeGame(game: Game): Game | null {
  if (!game.arena) return null;
  return { ...translate(game, game.arena.at, -1), version: 0 };
}

/** A Library game put down with its arena's floor middle at `at`. */
export function placeGame(relative: Game, at: Vec3): Game {
  return translate(relative, at, 1);
}

const NUMBERS = ["rotX", "rotY", "rotZ", "scaleX", "scaleY", "scaleZ", "volume"] as const;
const STRINGS = ["type", "material", "color", "asset", "media"] as const;

/** The plain things standing on the game's stage, relative to the arena. */
export function snapshotStage(objects: readonly Rec[], game: Game): LibraryObject[] {
  const stage = stageOf(game);
  const origin = game.arena?.at;
  if (!stage || !origin) return [];
  const out: LibraryObject[] = [];
  for (const o of objects) {
    if (out.length >= LIBRARY_OBJECTS_MAX) break;
    const { x, y, z } = o;
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" || typeof o.type !== "string") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !inBounds(stage, x, y, z)) continue;
    if (o.mind !== undefined || o.type === "sign") continue;
    const copy: LibraryObject = { x: round2(x - origin[0]), y: round2(y - origin[1]), z: round2(z - origin[2]) };
    for (const k of STRINGS) if (typeof o[k] === "string") copy[k] = (o[k] as string).slice(0, 200);
    for (const k of NUMBERS) if (typeof o[k] === "number" && Number.isFinite(o[k] as number)) copy[k] = o[k] as number;
    if (typeof o.loop === "boolean") copy.loop = o.loop;
    out.push(copy);
  }
  return out;
}

/**
 * A snapshot's objects as world objects around `at`, placed by `by`. Anything that would
 * land outside a world is left out. With `libraryId` each is marked `gameProp: <libraryId>`
 * (a server-only key), so the next bring can clear what this one placed.
 */
export function placedObjects(snapshot: readonly LibraryObject[], at: Vec3, by: string, now: number, libraryId?: string): Rec[] {
  const out: Rec[] = [];
  for (const o of snapshot.slice(0, LIBRARY_OBJECTS_MAX)) {
    if (typeof o.x !== "number" || typeof o.y !== "number" || typeof o.z !== "number" || typeof o.type !== "string") continue;
    const obj: Rec = {
      rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "default",
      ...o,
      id: `obj-${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      x: round2(o.x + at[0]), y: round2(o.y + at[1]), z: round2(o.z + at[2]),
      placedBy: by, placedAt: now,
      ...(libraryId ? { gameProp: libraryId } : {}),
    };
    if (isSaneObject(obj)) out.push(obj);
  }
  return out;
}

interface LibRow { id: string; name: string; by: string; world_id: string; version: number; updated_at: number }
interface VersionRow { library_id: string; version: number; game: string; objects: string; credits: string; saved_at: number; saved_by: string }

export interface LibraryVersion {
  libraryId: string;
  name: string;
  version: number;
  /** Relative to the arena. */
  game: Game;
  objects: LibraryObject[];
  credits: GameCredit[];
  savedBy: string;
}

export class GameLibrary {
  constructor(private readonly db: SqlDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS game_library (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, by TEXT NOT NULL, world_id TEXT NOT NULL,
        version INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_library_updated ON game_library (updated_at);
      CREATE TABLE IF NOT EXISTS game_library_versions (
        library_id TEXT NOT NULL, version INTEGER NOT NULL, game TEXT NOT NULL, objects TEXT NOT NULL,
        credits TEXT NOT NULL, saved_at INTEGER NOT NULL, saved_by TEXT NOT NULL,
        PRIMARY KEY (library_id, version)
      );
    `);
  }

  private versionRow(libraryId: string, version: number): VersionRow | undefined {
    return this.db.prepare("SELECT * FROM game_library_versions WHERE library_id = ? AND version = ?").get(libraryId, version) as VersionRow | undefined;
  }

  private view(row: LibRow, mine: ReadonlySet<string>, names: Readonly<Record<string, string>>): LibraryGame {
    const v = this.versionRow(row.id, row.version);
    let template = "race";
    let credits: GameCredit[] = [];
    try {
      template = String((JSON.parse(v?.game ?? "{}") as { template?: unknown }).template ?? "race");
      credits = JSON.parse(v?.credits ?? "[]") as GameCredit[];
    } catch {
      // an unreadable version lists as a plain race with no credits
    }
    return { id: row.id, name: row.name, version: row.version, template, by: row.by, byName: names[row.by] ?? "", credits, updatedAt: row.updated_at, mine: mine.has(row.by) };
  }

  /** Mine first (newest first), then recent ones by others. `names` turns character ids into names. */
  list(mine: readonly string[], names: (ids: string[]) => Record<string, string>, limit = LIBRARY_LIST_MAX): LibraryGame[] {
    const mark = mine.map(() => "?").join(",");
    const own = mine.length
      ? (this.db.prepare(`SELECT * FROM game_library WHERE by IN (${mark}) ORDER BY updated_at DESC, id LIMIT ?`).all(...mine, limit) as LibRow[])
      : [];
    const rest = limit - own.length;
    const others = rest > 0
      ? (this.db.prepare(`SELECT * FROM game_library ${mine.length ? `WHERE by NOT IN (${mark})` : ""} ORDER BY updated_at DESC, id LIMIT ?`).all(...mine, rest) as LibRow[])
      : [];
    const rows = [...own, ...others];
    const who = names([...new Set(rows.map((r) => r.by))]);
    const set = new Set(mine);
    return rows.map((r) => this.view(r, set, who));
  }

  /**
   * Save a world's game as a Library game, or as the next version of the one this
   * account already saved from this world. The caller has checked ownership and the
   * name. `mine` = every character of the saving account. Null when the game has no arena.
   */
  save(input: { worldId: string; name: string; by: string; mine: readonly string[]; game: Game; objects: readonly Rec[]; byName?: string }, now = Date.now()): LibraryGame | null {
    const relative = relativeGame(input.game);
    if (!relative) return null;
    const game = JSON.stringify({ ...relative, credits: [] });
    const objects = JSON.stringify(snapshotStage(input.objects, input.game));
    const credits = JSON.stringify(input.game.credits ?? []);
    const owners = [...new Set([input.by, ...input.mine])];
    const existing = this.db
      .prepare(`SELECT * FROM game_library WHERE world_id = ? AND by IN (${owners.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT 1`)
      .get(input.worldId, ...owners) as LibRow | undefined;
    let row: LibRow;
    if (existing) {
      const last = this.versionRow(existing.id, existing.version);
      const same = last !== undefined && last.game === game && last.objects === objects && last.credits === credits;
      row = { ...existing, name: input.name, version: same ? existing.version : existing.version + 1, updated_at: now };
      this.db.prepare("UPDATE game_library SET name = ?, version = ?, updated_at = ? WHERE id = ?").run(row.name, row.version, now, row.id);
      if (!same) this.insertVersion(row, game, objects, credits, now, input.by);
    } else {
      row = { id: randomUUID(), name: input.name, by: input.by, world_id: input.worldId, version: 1, updated_at: now };
      this.db.prepare("INSERT INTO game_library (id, name, by, world_id, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(row.id, row.name, row.by, row.world_id, 1, now);
      this.insertVersion(row, game, objects, credits, now, input.by);
    }
    return this.view(row, new Set(owners), input.byName ? { [row.by]: input.byName } : {});
  }

  private insertVersion(row: LibRow, game: string, objects: string, credits: string, now: number, by: string): void {
    this.db.prepare("INSERT INTO game_library_versions (library_id, version, game, objects, credits, saved_at, saved_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.version, game, objects, credits, now, by);
  }

  /** A Library game's latest version, to bring into a world. Null if there is none (or it can't be read). */
  latest(libraryId: string): LibraryVersion | null {
    const row = this.db.prepare("SELECT * FROM game_library WHERE id = ?").get(libraryId) as LibRow | undefined;
    const v = row ? this.versionRow(row.id, row.version) : undefined;
    if (!row || !v) return null;
    try {
      const game = parseGameLoose(JSON.parse(v.game));
      if (!game) return null;
      return { libraryId: row.id, name: row.name, version: row.version, game, objects: JSON.parse(v.objects) as LibraryObject[], credits: JSON.parse(v.credits) as GameCredit[], savedBy: v.saved_by };
    } catch {
      return null;
    }
  }

  /**
   * What bringing a Library game to `at` gives: the game in world coordinates, the credit
   * chain with this Library version appended, and the stage's objects to place. The caller
   * saves the game (WorldGames.save with these credits) and places the objects.
   */
  bring(libraryId: string, at: Vec3, by: string, now = Date.now()): { game: Game; credits: GameCredit[]; objects: Rec[]; version: LibraryVersion } | null {
    const v = this.latest(libraryId);
    if (!v) return null;
    const credits: GameCredit[] = [...v.credits, { libraryId: v.libraryId, version: v.version, by: v.savedBy, name: v.name }].slice(-16);
    return { game: placeGame(v.game, at), credits, objects: placedObjects(v.objects, at, by, now), version: v };
  }
}

/**
 * A stored relative game is server-written, so it is read as it is: `parseGame` would clamp
 * its offsets as if they were world coordinates. It is validated once it has a place
 * (WorldGames.save parses the placed game).
 */
function parseGameLoose(raw: unknown): Game | null {
  const g = raw as Partial<Game> | null;
  if (!g || typeof g !== "object" || typeof g.template !== "string" || !g.arena || !Array.isArray(g.zones)) return null;
  return g as Game;
}

// ── The two writing routes, without the HTTP (index.ts wires them) ──

export type LibraryReply = { status: number; body: Record<string, unknown> };

export interface LibraryRouteDeps {
  lib: GameLibrary;
  /** Is this character (or another on their account) the world's creator or a builder? */
  isOwner(worldId: string, playerId: string): boolean;
  game(worldId: string): Game | null;
  /** Every placed object in the world, as plain JSON. */
  objects(worldId: string): Rec[];
  /** The check world names pass (world-create.ts): the cleaned name, or null. */
  cleanName(raw: unknown): string | null;
  /** WorldGames.save with a credit chain, then the copy in the world doc. */
  saveGame(worldId: string, game: Game, by: string, credits: GameCredit[]): { ok: true; game: Game; warnings: string[] } | { ok: false; message: string };
  placeObjects(worldId: string, objects: Rec[]): void;
  /** Remove the objects an earlier bring placed (those with a `gameProp`). Returns how many went. */
  clearProps?(worldId: string): number;
  name(playerId: string): string;
}

const refuse = (status: number, error: string, message: string): LibraryReply => ({ status, body: { error, message } });

/** `POST /api/player/game-library { worldId, name }`: owners save this world's game to the Library. */
export function saveLibraryGame(deps: LibraryRouteDeps, who: { playerId: string; mine: readonly string[] }, worldId: string | null, rawName: unknown, now = Date.now()): LibraryReply {
  if (!worldId) return refuse(400, "bad_request", "That world isn't there.");
  if (!deps.isOwner(worldId, who.playerId)) return refuse(403, "not_owner", "Only this world's creator and builders can save its game to the Library.");
  const name = deps.cleanName(rawName);
  if (!name || name.length < LIBRARY_NAME_MIN || name.length > LIBRARY_NAME_MAX) {
    return refuse(400, "bad_name", `Give the game a name of ${LIBRARY_NAME_MIN} to ${LIBRARY_NAME_MAX} letters.`);
  }
  const game = deps.game(worldId);
  if (!game) return refuse(404, "no_game", "This world has no game yet.");
  const saved = deps.lib.save({ worldId, name, by: who.playerId, mine: who.mine, game, objects: deps.objects(worldId), byName: deps.name(who.playerId) }, now);
  if (!saved) return refuse(400, "no_arena", "Mark the arena first: a Library game is saved around it.");
  return { status: 200, body: { game: saved } };
}

/** `POST /api/player/game-library/bring { worldId, libraryId, at }`: owners make a Library game this world's game. */
export function bringLibraryGame(deps: LibraryRouteDeps, who: { playerId: string }, worldId: string | null, libraryId: unknown, rawAt: unknown, now = Date.now()): LibraryReply {
  if (!worldId) return refuse(400, "bad_request", "That world isn't there.");
  if (!deps.isOwner(worldId, who.playerId)) return refuse(403, "not_owner", "Only this world's creator and builders can bring a game here.");
  const at = Array.isArray(rawAt) && rawAt.length === 3 && rawAt.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1000) ? (rawAt as Vec3) : null;
  if (typeof libraryId !== "string" || !at) return refuse(400, "bad_request", "Say which game, and where to put it.");
  const b = deps.lib.bring(libraryId, at, who.playerId, now);
  if (!b) return refuse(404, "not_found", "That game isn't in the Library any more.");
  // The credit carries the name its maker shows now, so the Game tab never prints a raw id
  const maker = deps.name(b.version.savedBy);
  const credits = b.credits.map((c, i) => (i === b.credits.length - 1 && maker ? { ...c, byName: maker } : c));
  const r = deps.saveGame(worldId, b.game, who.playerId, credits);
  if (!r.ok) return refuse(400, "bad_game", r.message);
  // Around where the arena really ended up (the game is clamped into the world when saved)
  const placed = r.game.arena ? placedObjects(b.version.objects, r.game.arena.at, who.playerId, now, b.version.libraryId) : [];
  // Bringing again (the same game or another) replaces what the last bring placed, instead of stacking a second copy
  const cleared = deps.clearProps?.(worldId) ?? 0;
  deps.placeObjects(worldId, placed);
  return { status: 200, body: { game: r.game, warnings: r.warnings, placed: placed.length, cleared } };
}

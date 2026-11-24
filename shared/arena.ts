/**
 * A match's own copy of the arena (Phase 10, Q1b; Alex, 2026-11-24: "We definitely don't
 * want an owner modifying mid-match actually change someone's running match").
 *
 * When a match starts the server copies what stands on the stage (the arena's box in the
 * live world) into the match's setup, so it is stored with the record. While the match
 * runs its players see and collide with that copy, whatever the owners do to the live
 * stage; a replay shows the arena as it was. The next match copies the stage again.
 *
 * What is copied: the placed objects whose middle is inside the arena's box, with what it
 * takes to draw and collide exactly as the live object does (its id, place, turn, size,
 * look, file, sign text, life). Never a mind (the persona stays in the live world), never
 * who placed it or the words it was made from, and nothing that is only motion (a kick in
 * flight, being carried): a copied object stands where it stood.
 *
 * What is not copied: the ground. The voxel terrain under the arena is locked instead
 * while a match runs there (`terrainLock`, enforced by the server's world authority).
 *
 * Pure and shared: the match host makes the copy, the client draws from it.
 */
import { boundsOf, inBounds, stageOf, type Bounds, type Game } from "./game.js";

/** Most objects one match copies. Past it the ones farthest from the arena's middle are left out of the match (and counted in `cut`). */
export const ARENA_OBJECTS_MAX = 500;

/** One copied object: plain JSON, always with an id, a type and a place. */
export interface ArenaObject { id: string; type: string; x: number; y: number; z: number; [key: string]: unknown }

export interface ArenaCopy {
  objects: ArenaObject[];
  /** How many objects on the stage did not fit (ARENA_OBJECTS_MAX): they are not part of this match. */
  cut?: number;
}

type Rec = Record<string, unknown>;
const NUMBERS = ["rotX", "rotY", "rotZ", "scaleX", "scaleY", "scaleZ", "volume"] as const;
const STRINGS = ["material", "color", "asset", "media", "stillAsset"] as const;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The life settings as plain data (mode, pace, roam radius…): small, numbers and short strings only. */
function plainLife(v: unknown): Rec | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v as Rec).slice(0, 12)) {
    if (finite(x) || typeof x === "boolean") out[k] = x;
    else if (typeof x === "string") out[k] = x.slice(0, 40);
  }
  return out;
}

/**
 * The stage as a match keeps it: every placed object whose middle is inside the game's
 * arena, nearest the arena's middle first (so the cap cuts the outskirts, and the order
 * doesn't depend on how the world happens to list them).
 */
export function snapshotArena(objects: Iterable<Rec>, game: Game): ArenaCopy {
  const stage = stageOf(game);
  const mid = game.arena?.at;
  if (!stage || !mid) return { objects: [] };
  const found: { o: ArenaObject; d: number }[] = [];
  for (const o of objects) {
    const { id, type, x, y, z } = o;
    if (typeof id !== "string" || !id || typeof type !== "string" || !finite(x) || !finite(y) || !finite(z)) continue;
    if (!inBounds(stage, x, y, z)) continue;
    const copy: ArenaObject = { id: id.slice(0, 64), type: type.slice(0, 40), x, y, z };
    for (const k of NUMBERS) if (finite(o[k])) copy[k] = o[k];
    for (const k of STRINGS) if (typeof o[k] === "string") copy[k] = (o[k] as string).slice(0, 200);
    if (typeof o.loop === "boolean") copy.loop = o.loop;
    // A sign's words are part of how it is drawn (they passed the server's text check when it was placed)
    if (typeof o.text === "string") copy.text = o.text.slice(0, 700);
    const life = plainLife(o.life);
    if (life) copy.life = life;
    found.push({ o: copy, d: (x - mid[0]) ** 2 + (y - mid[1]) ** 2 + (z - mid[2]) ** 2 });
  }
  found.sort((a, b) => a.d - b.d || (a.o.id < b.o.id ? -1 : a.o.id > b.o.id ? 1 : 0));
  const kept = found.slice(0, ARENA_OBJECTS_MAX).map((f) => f.o);
  return found.length > kept.length ? { objects: kept, cut: found.length - kept.length } : { objects: kept };
}

/**
 * What someone inside a match (or looking at one) is shown instead of the live world's
 * objects: everything live that is **not** on the stage and not one of the copied
 * objects, plus the copy. So an object added to the stage after the start is not there,
 * and one moved, recoloured, kicked or removed since is still where and how it was.
 * `make` turns a copied object into whatever the caller draws.
 */
export function arenaView<T extends { id: string; x: number; y: number; z: number }>(live: ReadonlyMap<string, T>, stage: Bounds, copy: readonly ArenaObject[], make: (o: ArenaObject) => T): Map<string, T> {
  const ids = new Set(copy.map((o) => o.id));
  const out = new Map<string, T>();
  for (const [id, o] of live) {
    if (ids.has(id) || inBounds(stage, o.x, o.y, o.z)) continue;
    out.set(id, o);
  }
  for (const o of copy) out.set(o.id, make(o));
  return out;
}

// ── The ground under the arena: locked while a match runs ──────────────

/** How far past the arena's sides the lock reaches (cells): a hole dug right at the edge changes the arena's rim. */
export const TERRAIN_LOCK_MARGIN = 1;

/**
 * The columns of terrain a running match locks: the arena's footprint (plus a margin),
 * from the bottom of the world up to the arena's top. Below the floor counts too: the
 * ground players stand on is the cells under it. Null when the game has no arena.
 */
export function terrainLock(game: Game | null | undefined): Bounds | null {
  if (!game?.arena) return null;
  const b = boundsOf(game.arena);
  const m = TERRAIN_LOCK_MARGIN;
  return { minX: b.minX - m, maxX: b.maxX + m, minY: -Infinity, maxY: b.maxY + m, minZ: b.minZ - m, maxZ: b.maxZ + m };
}

/** The middle of a terrain cell in world coordinates (the terrain is centred on the world's origin; cell j spans y = j … j + 1). */
export function terrainCellMiddle(size: readonly [number, number, number], gi: number, j: number, gk: number): [number, number, number] {
  return [gi - size[0] / 2 + 0.5, j + 0.5, gk - size[2] / 2 + 0.5];
}

/** Is this terrain cell one a running match locks? */
export function cellLocked(lock: Bounds | null, size: readonly [number, number, number], gi: number, j: number, gk: number): boolean {
  if (!lock) return false;
  const [x, y, z] = terrainCellMiddle(size, gi, j, gk);
  return x >= lock.minX && x <= lock.maxX && y <= lock.maxY && z >= lock.minZ && z <= lock.maxZ;
}

/** What an owner is told when the lock refuses them. */
export const TERRAIN_LOCK_NOTICE = "A match is running here. The arena's ground can be changed when it ends, or hold the queue first.";

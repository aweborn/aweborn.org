/**
 * World write authority (Rough Draft M1, 2026-10-27): who may change what in a
 * world's CRDT. Pure and shared: the sync-service enforces it on every client
 * `world-update` (reverting what breaks it), and the client uses the same rules
 * to only offer tools that will stick.
 *
 * ROADMAP "Object removal governance":
 *   1. The world's **creator** may change anything (as may **co-creators** the
 *      creator names).
 *   2. A **placer** may move, edit or delete what they placed.
 *   3. Everyone else (guests included) may place new things as themselves and
 *      **kick** anything (event-sourced physics), nothing more.
 * Terrain, sky, physics and world meta: creator + co-creators only; `creator`
 * and `coCreators` themselves are server-written only.
 */

export type Rec = Record<string, unknown>;

export interface WorldActor {
  /** The acting character's playerId; null for a guest (no session). */
  readonly id: string | null;
  /** True when this actor is the world's creator or a co-creator. May be computed lazily. */
  readonly owner: boolean;
}

/** Top-level world maps the authority guards (besides `objects` and the server-only `chat`). */
export const GUARDED_WORLD_MAPS = ["meta", "physics", "terrain"] as const;
export type GuardedWorldMap = (typeof GUARDED_WORLD_MAPS)[number];

/** Meta keys nobody but the server writes. */
export const SERVER_ONLY_META_KEYS: ReadonlySet<string> = new Set(["creator", "coCreators", "createdAt", "parentWorldId", "solidified"]);

/** Most co-creators a world can name. */
export const MAX_CO_CREATORS = 24;

/** Sanity bounds for any placed object (stops giant or far-flung griefing). */
export const OBJECT_LIMITS = { maxScale: 100, minScale: 0.02, maxXZ: 4000, minY: -500, maxY: 2000 } as const;

/** Kicks: fastest legal kick (KICK_SPEED 7 + lift 3 ≈ 7.6 today) and farthest legal landing. */
export const KICK_LIMITS = { maxSpeed: 12, maxSettleDistance: 40 } as const;

/** Is this playerId the world's creator or one of its co-creators? */
export function isWorldOwnerId(
  id: string | null | undefined,
  roles: { creator?: string | null; coCreators?: readonly string[] | null },
): boolean {
  if (!id) return false;
  if (roles.creator && roles.creator === id && roles.creator !== "system" && roles.creator !== "guest") return true;
  return Boolean(roles.coCreators?.includes(id));
}

/** May this actor move / rotate / scale / recolor / redo / delete this object? */
export function canEditObject(actor: WorldActor, obj: Rec | { placedBy?: unknown } | undefined | null): boolean {
  if (actor.owner) return true;
  if (!actor.id || !obj) return false;
  const placedBy = (obj as { placedBy?: unknown }).placedBy;
  return typeof placedBy === "string" && placedBy !== "" && placedBy === actor.id;
}

/** May this actor create an object stamped with this `placedBy`? (No impersonation.) */
export function canPlaceAs(actor: WorldActor, placedBy: unknown): boolean {
  if (placedBy === "" || placedBy === undefined) return true; // unowned: only owners can edit it later
  if (typeof placedBy !== "string") return false;
  if (actor.id) return placedBy === actor.id;
  return placedBy.startsWith("guest");
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Positions and scales inside sane bounds (applies to everyone, owners included). */
export function isSaneObject(obj: Rec): boolean {
  for (const k of ["x", "y", "z", "rotX", "rotY", "rotZ", "scaleX", "scaleY", "scaleZ"]) {
    if (obj[k] !== undefined && !finite(obj[k])) return false;
  }
  const { maxScale, minScale, maxXZ, minY, maxY } = OBJECT_LIMITS;
  for (const k of ["scaleX", "scaleY", "scaleZ"]) {
    const s = obj[k];
    if (finite(s) && (Math.abs(s) > maxScale || Math.abs(s) < minScale)) return false;
  }
  if (finite(obj.x) && Math.abs(obj.x) > maxXZ) return false;
  if (finite(obj.z) && Math.abs(obj.z) > maxXZ) return false;
  if (finite(obj.y) && (obj.y < minY || obj.y > maxY)) return false;
  return true;
}

/** Deep equality for CRDT plain values (JSON-ish). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as Rec);
  const kb = Object.keys(b as Rec);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameValue((a as Rec)[k], (b as Rec)[k]));
}

/** Keys whose values differ between two records. */
export function changedKeys(before: Rec, after: Rec): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !sameValue(before[k], after[k]));
}

function isLegalKick(kick: unknown): boolean {
  if (!kick || typeof kick !== "object") return false;
  const { vx, vy, vz, t } = kick as Rec;
  if (!finite(vx) || !finite(vy) || !finite(vz) || !finite(t)) return false;
  return Math.hypot(vx, vy, vz) <= KICK_LIMITS.maxSpeed;
}

/**
 * A non-owner's change to someone else's object is only legal as part of a
 * kick: starting one (`kick` set on a resting object), or settling it (x/y/z
 * written and `kick` cleared, landing within reach of where it started).
 */
export function isKickChange(before: Rec, after: Rec): boolean {
  const keys = changedKeys(before, after);
  if (keys.length === 0) return true;
  if (keys.length === 1 && keys[0] === "kick") {
    return before.kick === undefined && isLegalKick(after.kick);
  }
  const settleKeys = new Set(["x", "y", "z", "kick"]);
  if (keys.every((k) => settleKeys.has(k)) && before.kick !== undefined && after.kick === undefined) {
    const [bx, by, bz, ax, ay, az] = [before.x, before.y, before.z, after.x, after.y, after.z];
    if (![bx, by, bz, ax, ay, az].every(finite)) return false;
    return Math.hypot((ax as number) - (bx as number), (ay as number) - (by as number), (az as number) - (bz as number)) <= KICK_LIMITS.maxSettleDistance;
  }
  return false;
}

export type Verdict = "ok" | "revert";

/** Judge one object's change (undefined = absent). Does not count create budgets; callers do. */
export function judgeObjectChange(actor: WorldActor, before: Rec | undefined, after: Rec | undefined): Verdict {
  if (before === undefined && after === undefined) return "ok";
  if (before === undefined) {
    // Create
    return after && canPlaceAs(actor, after.placedBy) && isSaneObject(after) ? "ok" : "revert";
  }
  if (after === undefined) {
    // Delete
    return canEditObject(actor, before) ? "ok" : "revert";
  }
  // Modify
  if (!isSaneObject(after)) return "revert";
  const keys = changedKeys(before, after);
  if (keys.length === 0) return "ok";
  // Nobody rewrites who placed a thing (or when): that would launder ownership.
  if (keys.includes("placedBy") || keys.includes("id")) return "revert";
  if (canEditObject(actor, before)) return "ok";
  return isKickChange(before, after) ? "ok" : "revert";
}

/** Judge one key of meta / physics / terrain. */
export function judgeMapChange(actor: WorldActor, map: GuardedWorldMap, key: string, before: unknown, after: unknown): Verdict {
  if (sameValue(before, after)) return "ok";
  if (map === "meta" && SERVER_ONLY_META_KEYS.has(key)) return "revert";
  return actor.owner ? "ok" : "revert";
}

/** Clean a co-creator list from untrusted input: unique non-empty ids, never the creator, capped. */
export function cleanCoCreators(raw: unknown, creator: string): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") return null;
    const id = v.trim();
    if (!id || id.length > 64 || id === creator || id.startsWith("guest") || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_CO_CREATORS) break;
  }
  return out;
}

/** Read a stored co-creator list (CRDT value) as an optional field for WorldEntry / WorldMeta. */
export function coCreatorsField(v: unknown): { coCreators?: string[] } {
  if (!Array.isArray(v)) return {};
  return { coCreators: v.filter((x): x is string => typeof x === "string") };
}

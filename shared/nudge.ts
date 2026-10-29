/**
 * Collision nudge (Phase 06, Rough Draft M7c).
 *
 * Two phones that were offline (or two players at once) can place a thing on
 * the very same spot. When the server accepts a new object that sits on top of
 * another player's object, it moves the newcomer to the nearest free spot
 * around it and marks it with `nudge` so every client slides it there.
 *
 * Only near-identical spots count (every axis within `overlap`), so building
 * blocks next to or on top of each other is never touched, and a player's own
 * objects never nudge each other.
 */
import { OBJECT_LIMITS, type Rec } from "./world-policy.js";

export const NUDGE_LIMITS = {
  /** Same spot: every axis closer than this (world units). */
  overlap: 0.3,
  /** Rings of 8 candidate spots tried, each one spacing further out. */
  rings: 3,
  /** Worlds with more objects than this skip the check (keeps a create O(n) with a small n). */
  maxScan: 5000,
} as const;

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

function footprint(o: Rec): number {
  return Math.max(Math.abs(num(o.scaleX, 1)), Math.abs(num(o.scaleZ, 1)));
}

/**
 * Where `created` should move, or null if it doesn't sit on another player's object.
 * `others` is the accepted state before this update (the new object is not in it).
 */
export function findNudge(created: Rec, others: readonly Rec[]): { x: number; z: number } | null {
  if (others.length > NUDGE_LIMITS.maxScan) return null;
  const x = num(created.x, 0);
  const y = num(created.y, 0);
  const z = num(created.z, 0);
  const by = created.placedBy;
  const { overlap } = NUDGE_LIMITS;

  let hit: Rec | null = null;
  for (const o of others) {
    if (o.placedBy === by) continue;
    if (Math.abs(num(o.x, 0) - x) < overlap && Math.abs(num(o.y, 0) - y) < overlap && Math.abs(num(o.z, 0) - z) < overlap) {
      hit = o;
      break;
    }
  }
  if (!hit) return null;

  const spacing = Math.max(1, footprint(created), footprint(hit));
  const clear = spacing * 0.6;
  for (let r = 1; r <= NUDGE_LIMITS.rings; r++) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cx = x + Math.cos(a) * spacing * r;
      const cz = z + Math.sin(a) * spacing * r;
      if (Math.abs(cx) > OBJECT_LIMITS.maxXZ || Math.abs(cz) > OBJECT_LIMITS.maxXZ) continue;
      const taken = others.some(
        (o) => Math.abs(num(o.y, 0) - y) < spacing && Math.hypot(num(o.x, 0) - cx, num(o.z, 0) - cz) < clear,
      );
      if (!taken) return { x: Math.round(cx * 1000) / 1000, z: Math.round(cz * 1000) / 1000 };
    }
  }
  return null; // crowded all round: leave it where it was placed
}

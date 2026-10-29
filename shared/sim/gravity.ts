/**
 * Gravity for the shared flight simulation (Phase 09, 9A).
 *
 * A pure port of `src/systems/GravitySystem.ts`: same constants, same
 * operation order (so it matches the three.js version to the last bit on
 * V8), but plain numbers, no allocation in the loop, and no wall clock:
 * a world's age bonus uses the `nowMs` the caller puts in the `SimWorld`.
 *
 * Determinism: only + - * / sqrt min max abs (see dmath.ts).
 */
import { ORIGIN_POSITION, ORIGIN_WORLD_ID } from "../crdt-schema.js";

// ── Tuning (moved from GravitySystem.ts, unchanged) ──────────────────

/** Gravitational constant: a game-feel constant, not real physics. */
export const G = 10.0;
/** Maximum distance at which gravity is calculated. */
export const GRAVITY_RANGE = 120.0;
/** Minimum distance, to prevent infinite force at zero distance. */
export const MIN_DISTANCE = 2.0;
/**
 * Maximum gravitational acceleration (u/s²), per body and in total.
 * Invariant: stays BELOW the NEUTRAL thrust (10), so holding thrust away
 * from any well always escapes it.
 */
export const MAX_GRAVITY_ACCEL = 8.0;
/** Within this distance, head-on approaches are slowed. */
export const APPROACH_DRAG_RANGE = 12.0;
/** Maximum approach drag strength (0-1). */
export const APPROACH_DRAG_STRENGTH = 0.4;
/** Minimum player speed (u/s) to trigger a slingshot boost. */
export const SLINGSHOT_MIN_SPEED = 15.0;
/** Maximum distance from a body for slingshot detection. */
export const SLINGSHOT_RANGE = 15.0;
/** Fixed mass for the Aweborn Portal (origin): the strongest pull. */
export const PORTAL_MASS = 25.0;

const DAY_MS = 1000 * 60 * 60 * 24;

/** A gravity source. `isWorld` false = the Portal (no orbit capture). */
export interface SimBody {
  id: string;
  x: number;
  y: number;
  z: number;
  mass: number;
  isWorld: boolean;
}

/** Everything outside the player that one step depends on. */
export interface SimWorld {
  /** Portal first, then every top-level world. */
  bodies: SimBody[];
  /** Beginner leash radius around Origin, or null for none. */
  leashRadius: number | null;
}

/** Active worlds with more players and history pull harder (caps at 3× age after 2 days). */
export function worldMass(playerCount: number, createdAt: number, nowMs: number): number {
  const playerBoost = 1 + playerCount * 0.5;
  const ageBonus = Math.min(1 + (nowMs - createdAt) / DAY_MS, 3);
  return 2.0 * playerBoost * ageBonus;
}

export interface BodySource {
  id: string;
  parentWorldId?: string | null;
  resolvedPosition: { x: number; y: number; z: number };
  playerCount: number;
  createdAt: number;
}

/** Portal + every top-level world, at sim time `nowMs`. */
export function buildBodies(worlds: Iterable<BodySource>, nowMs: number): SimBody[] {
  const bodies: SimBody[] = [
    { id: ORIGIN_WORLD_ID, x: ORIGIN_POSITION.x, y: ORIGIN_POSITION.y, z: ORIGIN_POSITION.z, mass: PORTAL_MASS, isWorld: false },
  ];
  for (const w of worlds) {
    if (w.parentWorldId) continue;
    bodies.push({
      id: w.id,
      x: w.resolvedPosition.x,
      y: w.resolvedPosition.y,
      z: w.resolvedPosition.z,
      mass: worldMass(w.playerCount, w.createdAt, nowMs),
      isWorld: true,
    });
  }
  return bodies;
}

export interface GravityOut {
  fx: number;
  fy: number;
  fz: number;
  /** Index into `bodies` of the nearest body, or -1 if there are none. */
  nearest: number;
  nearestDistance: number;
  /** Index of the world being orbit-captured, or -1. */
  orbit: number;
  /** Slingshot this step: body index, player speed, boost factor (body -1 = none). */
  slingBody: number;
  slingSpeed: number;
  slingBoost: number;
  /** 0 = no approach drag, up to APPROACH_DRAG_STRENGTH. */
  approachDrag: number;
}

export function emptyGravity(): GravityOut {
  return { fx: 0, fy: 0, fz: 0, nearest: -1, nearestDistance: Infinity, orbit: -1, slingBody: -1, slingSpeed: 0, slingBoost: 1, approachDrag: 0 };
}

/**
 * Total gravitational acceleration on a player at (px,py,pz) moving at
 * (vx,vy,vz). Writes into `out` (and returns it). O(bodies).
 */
export function computeGravity(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  bodies: readonly SimBody[],
  out: GravityOut = emptyGravity(),
): GravityOut {
  let tfx = 0, tfy = 0, tfz = 0;
  let nearest = -1;
  let nearestDistance = Infinity;
  let orbit = -1;
  let slingBody = -1, slingSpeed = 0, slingBoost = 1;
  let approachDrag = 0;

  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  // velocity direction, as THREE's normalize (multiply by 1 / (len || 1))
  const vInv = 1 / (speed || 1);
  const vdx = vx * vInv, vdy = vy * vInv, vdz = vz * vInv;

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const tx = b.x - px, ty = b.y - py, tz = b.z - pz;
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const dist = Math.max(tLen, MIN_DISTANCE);

    if (dist < nearestDistance) {
      nearestDistance = dist;
      nearest = i;
    }
    if (dist > GRAVITY_RANGE) continue;

    const strength = Math.min(G * b.mass / (dist * dist), MAX_GRAVITY_ACCEL);
    const tInv = 1 / (tLen || 1);
    const tdx = tx * tInv, tdy = ty * tInv, tdz = tz * tInv;

    // Slingshot detection (the boost is applied as an impulse by the step,
    // never by scaling the inward pull)
    if (speed > SLINGSHOT_MIN_SPEED && dist < SLINGSHOT_RANGE) {
      const dot = Math.abs(vdx * tdx + vdy * tdy + vdz * tdz);
      if (dot < 0.5) {
        const proximity = 1.0 - dist / SLINGSHOT_RANGE;
        const tangentiality = 1.0 - dot / 0.5;
        const speedFactor = Math.min(speed / 15.0, 20.0);
        slingBody = i;
        slingSpeed = speed;
        slingBoost = 1.0 + speedFactor * proximity * (0.5 + tangentiality * 0.5);
      }
    }

    // Orbit capture (worlds only): tangent = normalize(cross(to, +Y))
    if (b.isWorld && speed < 2.0 && dist < 3.0 && dist > 0.8) {
      orbit = i;
      const cx = -tz;
      const cy = 0;
      const cz = tx;
      const cInv = 1 / (Math.sqrt(cx * cx + cy * cy + cz * cz) || 1);
      const orbitStrength = strength * 0.3 * (1 - speed / 2.0);
      tfx += cx * cInv * orbitStrength;
      tfy += cy * cInv * orbitStrength;
      tfz += cz * cInv * orbitStrength;
    }

    tfx += tdx * strength;
    tfy += tdy * strength;
    tfz += tdz * strength;

    // Approach drag
    if (dist < APPROACH_DRAG_RANGE && speed > 1.0) {
      const headOnDot = vdx * tdx + vdy * tdy + vdz * tdz;
      if (headOnDot > 0.7) {
        const proximityFactor = 1 - dist / APPROACH_DRAG_RANGE;
        const drag = proximityFactor * headOnDot * APPROACH_DRAG_STRENGTH;
        approachDrag = Math.max(approachDrag, drag);
      }
    }
  }

  // Cap the combined pull too (overlapping wells must not out-pull thrust)
  const fLen = Math.sqrt(tfx * tfx + tfy * tfy + tfz * tfz);
  if (fLen > MAX_GRAVITY_ACCEL) {
    const inv = 1 / fLen;
    tfx = tfx * inv * MAX_GRAVITY_ACCEL;
    tfy = tfy * inv * MAX_GRAVITY_ACCEL;
    tfz = tfz * inv * MAX_GRAVITY_ACCEL;
  }

  out.fx = tfx; out.fy = tfy; out.fz = tfz;
  out.nearest = nearest;
  out.nearestDistance = nearestDistance;
  out.orbit = orbit;
  out.slingBody = slingBody;
  out.slingSpeed = slingSpeed;
  out.slingBoost = slingBoost;
  out.approachDrag = approachDrag;
  return out;
}

/**
 * Interior movement: one deterministic step, shared by client and server.
 *
 * Phase 07 (Interior Movement & Physics), chosen 2026-10-17: our own
 * kinematic controller instead of a physics engine, because Phase 09 needs
 * the same step to run on the server (prediction, authority, offline replay).
 *
 * Determinism rules for this file:
 *  - only + - * / and Math.sqrt / Math.min / Math.max / Math.abs (IEEE-exact
 *    everywhere); no Math.sin/cos/atan2 (engines may differ in the last bit)
 *  - facing is a unit vector (fx, fz), turned by a first-order rotation and
 *    renormalized with sqrt
 *  - fixed dt (call with INTERIOR_DT), no Date/random, no allocation-order effects
 *
 * Coordinates: y up, the ground is the plane y = 0, `x/y/z` is the player's
 * feet. Forward at facing (0, -1) is -Z, matching THREE.js.
 */
import type { PhysicsParams, PlacedObject } from "../crdt-schema.js";

export const INTERIOR_DT = 1 / 60;

/** Half-size of the walkable square (the interior grid is 40 × 40). */
export const INTERIOR_HALF_EXTENT = 19.5;

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.7;

const WALK_SPEED = 4; // u/s
const SPRINT_SPEED = 8;
const JUMP_SPEED = 5;
const JET_ACCEL = 14; // > Earth gravity, so holding jump lifts you
const JET_FUEL = 1.2; // seconds of jetpack per landing
const TURN_RATE = 2.5; // rad/s
const LOOK_RATE = 1.5; // rad/s
const PITCH_LIMIT = 1.3; // rad
const AIR_CONTROL = 2; // 1/s, how fast velocity follows input in the air
const WATER_GRAVITY_SCALE = 0.3;
const WATER_DRAG = 0.1; // per 1/60 s
const SWIM_SPEED = 3;

export interface InteriorState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Facing, a unit vector in the XZ plane. */
  fx: number;
  fz: number;
  /** Camera pitch in radians (+ = look up), clamped. Not used for movement. */
  pitch: number;
  grounded: boolean;
  /** Seconds of jetpack left; refills on landing. */
  fuel: number;
}

export interface InteriorInput {
  /** -1..1, + = forward (W), - = back (S) */
  move: number;
  /** -1..1, + = right (D), - = left (A) */
  strafe: number;
  /** -1..1, + = turn right (E), - = turn left (Q) */
  turn: number;
  /** -1..1, + = look up (R), - = look down (F) */
  look: number;
  /** Space: jump on the ground, jetpack in the air, swim up in water */
  jump: boolean;
  /** K */
  sprint: boolean;
}

export const NO_INPUT: InteriorInput = { move: 0, strafe: 0, turn: 0, look: 0, jump: false, sprint: false };

/** An axis-aligned box, the collider for a placed object. */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Terrain (voxels): walk up it when grounded and it's at most STEP_UP above the feet. */
  step?: boolean;
}

/** One voxel, so voxel hills can be walked instead of jumped. */
export const STEP_UP = 1.01;

/** Spawn point: a few steps in from the edge, facing the middle. */
export function spawnInterior(): InteriorState {
  return { x: 0, y: 0, z: 8, vx: 0, vy: 0, vz: 0, fx: 0, fz: -1, pitch: 0, grounded: true, fuel: JET_FUEL };
}

/**
 * Colliders for placed objects. Every type is approximated by its unit box
 * scaled (rotation ignored for now); good enough to stand on and bump into.
 */
export function collidersFor(objects: Iterable<PlacedObject>): Box[] {
  const boxes: Box[] = [];
  for (const o of objects) {
    const hx = 0.5 * Math.abs(o.scaleX || 1);
    const hy = 0.5 * Math.abs(o.scaleY || 1);
    const hz = 0.5 * Math.abs(o.scaleZ || 1);
    boxes.push({ minX: o.x - hx, minY: o.y - hy, minZ: o.z - hz, maxX: o.x + hx, maxY: o.y + hy, maxZ: o.z + hz });
  }
  return boxes;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function overlaps(x: number, y: number, z: number, b: Box): boolean {
  return (
    x + PLAYER_RADIUS > b.minX &&
    x - PLAYER_RADIUS < b.maxX &&
    z + PLAYER_RADIUS > b.minZ &&
    z - PLAYER_RADIUS < b.maxZ &&
    y + PLAYER_HEIGHT > b.minY &&
    y < b.maxY
  );
}

/** Advance one fixed step. Pure: returns a new state. */
export function stepInterior(
  s: InteriorState,
  input: InteriorInput,
  physics: PhysicsParams,
  boxes: readonly Box[],
  dt: number = INTERIOR_DT,
  halfExtent: number = INTERIOR_HALF_EXTENT,
): InteriorState {
  const move = clamp(input.move, -1, 1);
  const strafe = clamp(input.strafe, -1, 1);
  const turn = clamp(input.turn, -1, 1);
  const look = clamp(input.look, -1, 1);

  // ── Facing: rotate (fx, fz) clockwise seen from above, then renormalize ──
  const a = turn * TURN_RATE * dt;
  let fx = s.fx - s.fz * a;
  let fz = s.fz + s.fx * a;
  const fl = Math.sqrt(fx * fx + fz * fz) || 1;
  fx /= fl;
  fz /= fl;

  const pitch = clamp(s.pitch + look * LOOK_RATE * dt, -PITCH_LIMIT, PITCH_LIMIT);

  // ── Desired horizontal velocity ──
  // right = (-fz, fx) for forward (fx, fz) with y up
  let dx = fx * move + -fz * strafe;
  let dz = fz * move + fx * strafe;
  const dl = Math.sqrt(dx * dx + dz * dz);
  if (dl > 1) {
    dx /= dl;
    dz /= dl;
  }
  const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
  const tx = dx * speed;
  const tz = dz * speed;

  const inWater = s.y < physics.waterLevel;
  const steps = dt * 60; // per-1/60 s constants scale with dt

  // Ground grip follows friction (0.3 = Earth-like); ice is slippery, mud grips.
  const grip = 10 * clamp(physics.friction / 0.3, 0.2, 3);
  const k = Math.min(1, (s.grounded ? grip : AIR_CONTROL) * dt);
  let vx = s.vx + (tx - s.vx) * k;
  let vz = s.vz + (tz - s.vz) * k;
  let vy = s.vy;

  // ── Gravity (full vector; the floor is still y = 0) ──
  const gScale = inWater ? WATER_GRAVITY_SCALE : 1;
  vx += physics.gravityX * gScale * dt;
  vy += physics.gravityY * gScale * dt;
  vz += physics.gravityZ * gScale * dt;

  // ── Jump / jetpack / swim ──
  let fuel = s.fuel;
  if (input.jump) {
    if (inWater) {
      vy = Math.max(vy, SWIM_SPEED);
    } else if (s.grounded) {
      vy = JUMP_SPEED;
    } else if (fuel > 0) {
      vy += JET_ACCEL * dt;
      fuel = Math.max(0, fuel - dt);
    }
  }

  // ── Drag ──
  const drag = clamp(physics.airResistance * steps + (inWater ? WATER_DRAG * steps : 0), 0, 1);
  vx *= 1 - drag;
  vy *= 1 - drag;
  vz *= 1 - drag;

  // ── Integrate, resolving collisions one axis at a time ──
  // Terrain boxes low enough to step onto lift the feet instead of blocking.
  let feet = s.y;
  const canStep = (b: Box) => s.grounded && b.step === true && b.maxY - feet <= STEP_UP;
  let x = s.x + vx * dt;
  for (const b of boxes) {
    if (overlaps(x, feet, s.z, b)) {
      if (canStep(b)) {
        feet = b.maxY;
        continue;
      }
      x = vx > 0 ? b.minX - PLAYER_RADIUS : b.maxX + PLAYER_RADIUS;
      vx = 0;
    }
  }
  x = clamp(x, -halfExtent, halfExtent);

  let z = s.z + vz * dt;
  for (const b of boxes) {
    if (overlaps(x, feet, z, b)) {
      if (canStep(b)) {
        feet = b.maxY;
        continue;
      }
      z = vz > 0 ? b.minZ - PLAYER_RADIUS : b.maxZ + PLAYER_RADIUS;
      vz = 0;
    }
  }
  z = clamp(z, -halfExtent, halfExtent);

  let y = feet + vy * dt;
  let grounded = false;
  for (const b of boxes) {
    if (overlaps(x, y, z, b)) {
      if (vy <= 0) {
        y = b.maxY; // landed on top
        grounded = true;
      } else {
        y = b.minY - PLAYER_HEIGHT; // bumped head
      }
      vy = 0;
    }
  }
  if (y <= 0) {
    y = 0;
    if (vy < 0) vy = 0;
    grounded = true;
  }
  if (grounded) fuel = JET_FUEL;

  return { x, y, z, vx, vy, vz, fx, fz, pitch, grounded, fuel };
}

// ── Kicked objects (event-sourced physics) ──────────────────────────

/** How long a kicked object flies before it is settled (and written back). */
export const KICK_SETTLE_SEC = 4;
const KICK_SPEED = 7;
const KICK_LIFT = 3;
const KICK_REACH = 1.6; // from the player's centre to the object's surface

/** Kick velocity for a player facing (fx, fz). */
export function kickVelocity(fx: number, fz: number): { vx: number; vy: number; vz: number } {
  return { vx: fx * KICK_SPEED, vy: KICK_LIFT, vz: fz * KICK_SPEED };
}

/** The closest object in front of the player within reach, or null. */
export function kickTarget(s: InteriorState, objects: Iterable<PlacedObject>): PlacedObject | null {
  let best: PlacedObject | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    const r = 0.5 * Math.max(Math.abs(o.scaleX || 1), Math.abs(o.scaleZ || 1));
    const d = Math.sqrt(dx * dx + dz * dz) - r;
    if (d > KICK_REACH || dx * s.fx + dz * s.fz < 0) continue; // out of reach or behind
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/**
 * Where a kicked object is `elapsed` seconds after the kick. Deterministic
 * fixed-step sim (gravity, drag, ground bounce + friction, interior bounds),
 * so every client lands it in the same spot.
 */
export function kickedPosition(o: PlacedObject, physics: PhysicsParams, elapsed: number): { x: number; y: number; z: number } {
  const k = o.kick;
  if (!k) return { x: o.x, y: o.y, z: o.z };
  const half = 0.5 * Math.abs(o.scaleY || 1);
  let x = o.x, y = o.y, z = o.z, vx = k.vx, vy = k.vy, vz = k.vz;
  const steps = Math.floor(Math.min(Math.max(elapsed, 0), KICK_SETTLE_SEC) / INTERIOR_DT);
  const dt = INTERIOR_DT;
  const drag = clamp(physics.airResistance, 0, 1);
  for (let i = 0; i < steps; i++) {
    vx += physics.gravityX * dt; vy += physics.gravityY * dt; vz += physics.gravityZ * dt;
    vx *= 1 - drag; vy *= 1 - drag; vz *= 1 - drag;
    x += vx * dt; y += vy * dt; z += vz * dt;
    if (y < half) {
      y = half;
      vy = -vy * physics.bounceCoefficient;
      if (vy < 0.5) vy = 0;
      const f = clamp(1 - physics.friction * 0.2, 0, 1); // ground friction per step
      vx *= f; vz *= f;
    }
    if (x < -INTERIOR_HALF_EXTENT || x > INTERIOR_HALF_EXTENT) { x = clamp(x, -INTERIOR_HALF_EXTENT, INTERIOR_HALF_EXTENT); vx = -vx * physics.bounceCoefficient; }
    if (z < -INTERIOR_HALF_EXTENT || z > INTERIOR_HALF_EXTENT) { z = clamp(z, -INTERIOR_HALF_EXTENT, INTERIOR_HALF_EXTENT); vz = -vz * physics.bounceCoefficient; }
  }
  return { x, y, z };
}

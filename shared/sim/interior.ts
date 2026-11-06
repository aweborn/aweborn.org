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
export const TURN_RATE = 2.5; // rad/s
export const LOOK_RATE = 1.5; // rad/s
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
//
// Revamped 2026-11-06 (playtest: kicked things fell through the floor). The old
// flight only knew the plane y = 0, so anything kicked on voxel ground (every
// planned world) sank into the hill under it and came to rest inside the terrain,
// and it was clamped to the old 40 m room even in bigger worlds. Now the flight
// collides with the terrain (floors, walls, ledges, caves), with other placed
// things and with the world's real edge, and the whole trajectory is computed
// once per kick, so drawing it every frame costs nothing and every client lands
// it in the same spot.

/** How long a kicked object flies before it is settled (and written back). */
export const KICK_SETTLE_SEC = 4;
/** After this long anyone settles a kick (its kicker left before writing the landing). */
export const KICK_ORPHAN_SEC = KICK_SETTLE_SEC + 3;
const KICK_SPEED = 7;
const KICK_LIFT = 3;
const KICK_REACH = 1.6; // from the player's centre to the object's surface
/** A kicked thing hops up onto a ledge this high (m) instead of bouncing off it. */
const KICK_CLIMB = 0.3;
/** Slower than this (m/s) on the ground = at rest. */
const KICK_REST_SPEED = 0.05;
/** Bounces softer than this (m/s) stop. */
const KICK_MIN_BOUNCE = 0.6;
/** Cells scanned down a column looking for ground (then the floor y = 0 counts). */
const KICK_SCAN = 64;

/** Kick velocity for a player facing (fx, fz). */
export function kickVelocity(fx: number, fz: number): { vx: number; vy: number; vz: number } {
  return { vx: fx * KICK_SPEED, vy: KICK_LIFT, vz: fz * KICK_SPEED };
}

/** Where a placed thing is right now, when that isn't its x/z (a roaming creature). Default: x/y/z. */
export type PositionOf = (o: PlacedObject) => { x: number; y: number; z: number };

/** The closest object in front of the player within reach, or null. */
export function kickTarget(s: InteriorState, objects: Iterable<PlacedObject>, at?: PositionOf): PlacedObject | null {
  let best: PlacedObject | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    const p = at ? at(o) : o;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const r = 0.5 * Math.max(Math.abs(o.scaleX || 1), Math.abs(o.scaleZ || 1));
    const d = Math.sqrt(dx * dx + dz * dz) - r;
    if (d > KICK_REACH || dx * s.fx + dz * s.fz < 0) continue; // out of reach or behind
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

/**
 * What a kicked thing can hit. Everything here must be the same on every client
 * (the terrain from the world's CRDT, other objects' plain boxes), never what one
 * client happens to have loaded.
 */
export interface KickWorld {
  /** Is the 1 m terrain cell with its centre nearest (x, y, z) solid? Omit for flat ground at y = 0. */
  solid?: (x: number, y: number, z: number) => boolean;
  /** Half-size of the world's square (default: the classic 40 m room). */
  halfExtent?: number;
  /** Other things it bounces off and lands on (not itself). */
  boxes?: readonly Box[];
}

/** One sample per fixed step (x, y, z interleaved), from the kick until it settles. */
export interface KickTrajectory {
  readonly points: Float64Array;
  /** Number of steps simulated (points has steps + 1 entries). */
  readonly steps: number;
}

/** Top of the highest solid cell in this column that starts below `yCap` (0 = the floor). */
function groundUnder(solid: KickWorld["solid"], x: number, z: number, yCap: number): number {
  if (!solid) return 0;
  const top = Math.floor(yCap);
  for (let j = top, n = 0; j >= 0 && n < KICK_SCAN; j--, n++) {
    if (j + 1e-6 >= yCap) continue; // the cell starts at or above the cap: not under it
    if (solid(x, j + 0.5, z)) return j + 1;
  }
  return 0;
}

/** Highest ground under the footprint (centre + 4 corners, a little inset). */
function supportUnder(w: KickWorld, x: number, z: number, hx: number, hz: number, yCap: number): number {
  const ix = hx * 0.98, iz = hz * 0.98;
  let g = groundUnder(w.solid, x, z, yCap);
  if (!w.solid) return g;
  g = Math.max(g, groundUnder(w.solid, x - ix, z - iz, yCap));
  g = Math.max(g, groundUnder(w.solid, x + ix, z - iz, yCap));
  g = Math.max(g, groundUnder(w.solid, x - ix, z + iz, yCap));
  g = Math.max(g, groundUnder(w.solid, x + ix, z + iz, yCap));
  return g;
}

function boxHit(x: number, y: number, z: number, hx: number, hy: number, hz: number, b: Box): boolean {
  return x + hx > b.minX && x - hx < b.maxX && y + hy > b.minY && y - hy < b.maxY && z + hz > b.minZ && z - hz < b.maxZ;
}

/**
 * The whole flight of a kicked object: deterministic fixed steps (gravity, drag,
 * bounces off terrain, walls and other things, ground friction, the world's edge)
 * until KICK_SETTLE_SEC. Only + - * / floor and sqrt, so every client agrees.
 */
export function kickTrajectory(o: PlacedObject, physics: PhysicsParams, world: KickWorld = {}): KickTrajectory {
  const steps = Math.round(KICK_SETTLE_SEC / INTERIOR_DT);
  const points = new Float64Array((steps + 1) * 3);
  const k = o.kick;
  let x = o.x, y = o.y, z = o.z;
  points[0] = x; points[1] = y; points[2] = z;
  if (!k) {
    for (let i = 1; i <= steps; i++) { points[i * 3] = x; points[i * 3 + 1] = y; points[i * 3 + 2] = z; }
    return { points, steps };
  }
  const hx = 0.5 * Math.abs(o.scaleX || 1), hy = 0.5 * Math.abs(o.scaleY || 1), hz = 0.5 * Math.abs(o.scaleZ || 1);
  const edge = world.halfExtent ?? INTERIOR_HALF_EXTENT;
  const boxes = world.boxes ?? [];
  const dt = INTERIOR_DT;
  const drag = clamp(physics.airResistance, 0, 1);
  const bounce = clamp(physics.bounceCoefficient, 0, 0.95);
  const rub = clamp(1 - physics.friction * 0.2, 0, 1); // per step on the ground
  let vx = k.vx, vy = k.vy, vz = k.vz;
  let resting = false;

  // Where it starts may already be dug into a slope: never count its own column as a wall
  for (let i = 1; i <= steps; i++) {
    if (!resting) {
      vx += physics.gravityX * dt; vy += physics.gravityY * dt; vz += physics.gravityZ * dt;
      vx *= 1 - drag; vy *= 1 - drag; vz *= 1 - drag;

      // ── Horizontal, one axis at a time: walls bounce it back, low ledges lift it ──
      for (let axis = 0; axis < 2; axis++) {
        const v = axis === 0 ? vx : vz;
        if (v === 0) continue;
        const nx = axis === 0 ? x + v * dt : x;
        const nz = axis === 0 ? z : z + v * dt;
        const bottom = y - hy;
        const here = supportUnder(world, x, z, hx, hz, bottom + KICK_CLIMB);
        const there = supportUnder(world, nx, nz, hx, hz, bottom + KICK_CLIMB);
        let blocked = there > Math.max(bottom + KICK_CLIMB, here) + 1e-9;
        if (!blocked) for (const b of boxes) if (boxHit(nx, y, nz, hx, hy, hz, b) && b.maxY - bottom > KICK_CLIMB) { blocked = true; break; }
        if (blocked) {
          if (axis === 0) vx = -vx * bounce; else vz = -vz * bounce;
          continue;
        }
        x = nx; z = nz;
        if (there > bottom) y = there + hy; // hopped up a low ledge
      }
      // The world's edge is a wall too
      if (x < -edge + hx) { x = -edge + hx; vx = Math.abs(vx) * bounce; }
      else if (x > edge - hx) { x = edge - hx; vx = -Math.abs(vx) * bounce; }
      if (z < -edge + hz) { z = -edge + hz; vz = Math.abs(vz) * bounce; }
      else if (z > edge - hz) { z = edge - hz; vz = -Math.abs(vz) * bounce; }

      // ── Vertical: land on the highest thing under where it was, bounce, rub ──
      const prevBottom = y - hy;
      y += vy * dt;
      let floor = supportUnder(world, x, z, hx, hz, Math.max(prevBottom, y - hy) + 1e-3);
      for (const b of boxes) {
        if (x + hx > b.minX && x - hx < b.maxX && z + hz > b.minZ && z - hz < b.maxZ && b.maxY <= prevBottom + KICK_CLIMB && b.maxY > floor) floor = b.maxY;
      }
      let grounded = false;
      if (y - hy <= floor) {
        y = floor + hy;
        if (vy < 0) vy = -vy * bounce;
        if (vy < KICK_MIN_BOUNCE) vy = 0;
        grounded = true;
      } else if (vy > 0) {
        // Ceilings (a cave roof, something above): stop rising
        const headCell = Math.floor(y + hy);
        let hit = !!world.solid && world.solid(x, headCell + 0.5, z) && headCell + 1e-6 >= y - hy;
        if (!hit) for (const b of boxes) if (boxHit(x, y, z, hx, hy, hz, b)) { hit = true; break; }
        if (hit) { y -= vy * dt; vy = 0; }
      }
      if (grounded && vy === 0) {
        vx *= rub; vz *= rub;
        if (Math.sqrt(vx * vx + vz * vz) < KICK_REST_SPEED) { vx = 0; vz = 0; resting = true; }
      }
    }
    points[i * 3] = x; points[i * 3 + 1] = y; points[i * 3 + 2] = z;
  }
  return { points, steps };
}

/** Position `elapsed` seconds into a trajectory, smoothly between steps (120 Hz screens too). */
export function trajectoryAt(tr: KickTrajectory, elapsed: number): { x: number; y: number; z: number } {
  const f = clamp(elapsed, 0, KICK_SETTLE_SEC) / INTERIOR_DT;
  const i = Math.min(tr.steps, Math.floor(f));
  const j = Math.min(tr.steps, i + 1);
  const t = f - i;
  const p = tr.points;
  return {
    x: p[i * 3] + (p[j * 3] - p[i * 3]) * t,
    y: p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t,
    z: p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * t,
  };
}

/** Where a kicked object is `elapsed` seconds after the kick (computes the whole flight; cache it for drawing). */
export function kickedPosition(o: PlacedObject, physics: PhysicsParams, elapsed: number, world: KickWorld = {}): { x: number; y: number; z: number } {
  if (!o.kick) return { x: o.x, y: o.y, z: o.z };
  const tr = kickTrajectory(o, physics, world);
  const i = Math.min(tr.steps, Math.floor(clamp(elapsed, 0, KICK_SETTLE_SEC) / INTERIOR_DT));
  return { x: tr.points[i * 3], y: tr.points[i * 3 + 1], z: tr.points[i * 3 + 2] };
}

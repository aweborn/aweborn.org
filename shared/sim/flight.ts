/**
 * Flight: one deterministic 60 Hz step, shared by client and server
 * (Phase 09, 9A).
 *
 * A pure port of the star-orb flight that used to live in
 * `src/systems/FlightController.ts` (rotation, DRIVE / NEUTRAL movement,
 * auto-orient) plus the per-step extras `Scene.tsx` applied around it
 * (approach drag, gravity-well dead zone, slingshot turn dampening, the
 * slingshot impulse, and the beginner leash). Same constants and operation
 * order as the three.js version, so on V8 it matches it to within the last
 * bits of sin/cos (see flight.test.ts); trig goes through dmath.ts so other
 * engines agree bit for bit.
 *
 * Not in here yet (logged in phases/09): warp leaps and link teleports still
 * move the player outside the sim (the client adapter copies the result
 * back in); 9B/9C turn them into input actions.
 *
 * Determinism rules: fixed dt (FLIGHT_DT), plain doubles, no Date/random,
 * trig only via dmath, analog axes arrive already quantized (int8).
 */
import {
  dsin, dcos, dacos,
  NEUTRAL_DRAG_PER_STEP, AUTO_ORIENT_PER_STEP, LEASH_EASE_PER_STEP,
} from "./dmath.js";
import { computeGravity, emptyGravity, type GravityOut, type SimWorld } from "./gravity.js";
import { ORIGIN_POSITION } from "../crdt-schema.js";

export const FLIGHT_HZ = 60;
export const FLIGHT_DT = 1 / FLIGHT_HZ;

// ── Tuning (moved from FlightController.ts, unchanged) ───────────────

/** Angular velocity for pitch/yaw (rad/s). */
const TURN_RATE = 2.5;
/** Angular velocity for roll (rad/s). */
const ROLL_RATE = 2.8;
/** DRIVE (oracle / gravity-free): instant velocity magnitudes (u/s) and hard cap. */
const DRIVE_THRUST_SPEED = 12.0;
const DRIVE_REVERSE_SPEED = 12.0;
/** Strafe — additive velocity magnitude (u/s). */
const DRIVE_STRAFE_SPEED = 12.0;
const DRIVE_MAX_SPEED = 60.0;
/** NEUTRAL thrust acceleration (u/s²): builds speed over time. */
const NEUTRAL_THRUST_ACCEL = 10.0;
const NEUTRAL_REVERSE_ACCEL = 5.0;
const NEUTRAL_STRAFE_ACCEL = 6.0;
/** Brake deceleration in NEUTRAL (u/s²): gradual, not instant. */
const NEUTRAL_BRAKE_DECEL = 20.0;
// NEUTRAL drag: 0.15 per-second exponential decay (dmath.NEUTRAL_DRAG_PER_STEP),
// gentle enough to keep slingshot momentum, strong enough to eventually settle.
/** Soft speed cap in NEUTRAL (u/s). Low from thrusters alone: slingshots are the way to go fast. */
const NEUTRAL_MAX_SPEED = 80.0;
/** Slingshot turn dampening approach rate (1/s): ~0.3 s transition. */
const DAMPEN_RATE = 8.0;
/** Slingshot forward impulse = speed × (boost − 1) × this (was Scene.tsx SLINGSHOT_IMPULSE_MULTIPLIER). */
export const SLINGSHOT_IMPULSE_MULTIPLIER = 0.1;

// ── Input ────────────────────────────────────────────────────────────

/** Bits of `InputFrame.bits`. Append only: logs and the wire depend on them. */
export const IN = {
  thrust: 1 << 0,
  brake: 1 << 1,
  reverse: 1 << 2,
  strafe: 1 << 3,
  moveUp: 1 << 4,
  moveDown: 1 << 5,
  pitchUp: 1 << 6,
  pitchDown: 1 << 7,
  yawLeft: 1 << 8,
  yawRight: 1 << 9,
  rollLeft: 1 << 10,
  rollRight: 1 << 11,
  autoOrient: 1 << 12,
  /** NEUTRAL (gravity on). A level, not a toggle, so a lost frame can't flip modes. */
  neutral: 1 << 13,
} as const;

/** One tick of player input. `yaw` / `pitch` are analog sticks quantized to int8 (−127..127). */
export interface InputFrame {
  bits: number;
  yaw: number;
  pitch: number;
}

export const NO_INPUT: InputFrame = { bits: 0, yaw: 0, pitch: 0 };

/** Quantize an analog axis (−1..1) to int8. The client must simulate with the quantized value. */
export function quantizeAxis(v: number): number {
  if (!(v === v)) return 0; // NaN
  return Math.max(-127, Math.min(127, Math.round(v * 127)));
}

export function axisValue(q: number): number {
  return q / 127;
}

export function sameInput(a: InputFrame, b: InputFrame): boolean {
  return a.bits === b.bits && a.yaw === b.yaw && a.pitch === b.pitch;
}

// ── State ────────────────────────────────────────────────────────────

export interface FlightSimState {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  qx: number; qy: number; qz: number; qw: number;
  /** Slingshot turn dampening, smoothed (0-1). */
  dampen: number;
  /** Body id of the slingshot whose impulse was already given, or null. */
  slingId: string | null;
}

export function initialFlightState(px = 0, py = 2, pz = 60): FlightSimState {
  return { px, py, pz, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, dampen: 0, slingId: null };
}

/** What a step reports besides the new state (for visuals, hints, progress). */
export interface StepInfo {
  gravity: GravityOut;
  /** True on the step a slingshot impulse was applied. */
  slingshotImpulse: boolean;
  /** True while the beginner leash is pulling. */
  leashed: boolean;
  /** Any control held this tick (keys or sticks). */
  activelyControlling: boolean;
}

export function newStepInfo(): StepInfo {
  return { gravity: emptyGravity(), slingshotImpulse: false, leashed: false, activelyControlling: false };
}

// ── Math helpers (THREE's formulas, written out) ─────────────────────

/** v.applyQuaternion(q) for a unit quaternion, THREE's exact formula. */
function rotate(vx: number, vy: number, vz: number, s: FlightSimState, out: number[], o: number): void {
  const qx = s.qx, qy = s.qy, qz = s.qz, qw = s.qw;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + qy * tz - qz * ty;
  out[o + 1] = vy + qw * ty + qz * tx - qx * tz;
  out[o + 2] = vz + qw * tz + qx * ty - qy * tx;
}

/** s.q = axisAngle(axis, angle) * s.q (THREE setFromAxisAngle + premultiply). */
function premulAxisAngle(s: FlightSimState, ax: number, ay: number, az: number, angle: number): void {
  const half = angle / 2;
  const sn = dsin(half);
  const ax2 = ax * sn, ay2 = ay * sn, az2 = az * sn, aw = dcos(half);
  const bx = s.qx, by = s.qy, bz = s.qz, bw = s.qw;
  s.qx = ax2 * bw + aw * bx + ay2 * bz - az2 * by;
  s.qy = ay2 * bw + aw * by + az2 * bx - ax2 * bz;
  s.qz = az2 * bw + aw * bz + ax2 * by - ay2 * bx;
  s.qw = aw * bw - ax2 * bx - ay2 * by - az2 * bz;
}

function normalizeQ(s: FlightSimState): void {
  let l = Math.sqrt(s.qx * s.qx + s.qy * s.qy + s.qz * s.qz + s.qw * s.qw);
  if (l === 0) {
    s.qx = 0; s.qy = 0; s.qz = 0; s.qw = 1;
  } else {
    l = 1 / l;
    s.qx = s.qx * l; s.qy = s.qy * l; s.qz = s.qz * l; s.qw = s.qw * l;
  }
}

/** Velocity length capped (THREE setLength = normalize then multiply). */
function capSpeed(s: FlightSimState, max: number): void {
  const len = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  if (len > max) {
    const inv = 1 / (len || 1);
    s.vx = s.vx * inv * max;
    s.vy = s.vy * inv * max;
    s.vz = s.vz * inv * max;
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

// scratch: forward, right, up (computed once per step from the pre-rotation quaternion)
const AX = [0, 0, 0, 0, 0, 0, 0, 0, 0];

// ── Step ─────────────────────────────────────────────────────────────

/**
 * Advance one FLIGHT_DT tick. Mutates `s` in place (callers that need
 * history copy it first) and fills `info`.
 */
export function stepFlight(s: FlightSimState, input: InputFrame, world: SimWorld, info: StepInfo = newStepInfo()): StepInfo {
  const dt = FLIGHT_DT;
  const b = input.bits;
  const neutral = (b & IN.neutral) !== 0;
  const has = (bit: number) => (b & bit) !== 0;
  const yawAxis = axisValue(input.yaw);
  const pitchAxis = axisValue(input.pitch);

  // ── Gravity + well effects (were in Scene.tsx's substep loop) ──
  const g = computeGravity(s.px, s.py, s.pz, s.vx, s.vy, s.vz, world.bodies, info.gravity);
  const nearest = g.nearest >= 0 ? world.bodies[g.nearest] : null;

  if (neutral && g.approachDrag > 0.01 && nearest) {
    // Dampen only the approach component (keeps tangential speed for slingshots)
    let tx = nearest.x - s.px, ty = nearest.y - s.py, tz = nearest.z - s.pz;
    const inv = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
    tx = tx * inv; ty = ty * inv; tz = tz * inv;
    const approachSpeed = s.vx * tx + s.vy * ty + s.vz * tz;
    if (approachSpeed > 0) {
      const dampen = approachSpeed * g.approachDrag * dt * 2.0;
      s.vx += tx * -dampen;
      s.vy += ty * -dampen;
      s.vz += tz * -dampen;
    }
  }

  // Dead zone at a well's center (only when not thrusting, so you can escape)
  if (neutral && g.nearestDistance < 2.5 && !has(IN.thrust)) {
    const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    if (speed < 0.5) {
      s.vx = 0; s.vy = 0; s.vz = 0;
      g.fx = 0; g.fy = 0; g.fz = 0;
    }
  }

  const slingNow = neutral && g.slingBody >= 0;
  const dampenTarget = slingNow ? 1.0 : 0.0;
  s.dampen += (dampenTarget - s.dampen) * Math.min(DAMPEN_RATE * dt, 1.0);

  info.activelyControlling =
    (b & (IN.thrust | IN.brake | IN.reverse | IN.strafe | IN.moveUp | IN.moveDown |
      IN.pitchUp | IN.pitchDown | IN.yawLeft | IN.yawRight | IN.rollLeft | IN.rollRight)) !== 0 ||
    input.yaw !== 0 || input.pitch !== 0;

  // ── Local axes from the quaternion (before this tick's rotation) ──
  rotate(0, 0, -1, s, AX, 0);
  rotate(1, 0, 0, s, AX, 3);
  rotate(0, 1, 0, s, AX, 6);
  const fx = AX[0], fy = AX[1], fz = AX[2];
  const rx = AX[3], ry = AX[4], rz = AX[5];
  const ux = AX[6], uy = AX[7], uz = AX[8];

  // ── Rotation ──
  const dampenMultiplier = neutral ? 1.0 - s.dampen * 0.6 : 1.0;
  const turnRate = TURN_RATE * dampenMultiplier;
  const rollRate = ROLL_RATE * dampenMultiplier;
  const pitchIn = clamp1((has(IN.pitchUp) ? 1 : 0) - (has(IN.pitchDown) ? 1 : 0) + pitchAxis);
  const yawIn = clamp1((has(IN.yawRight) ? 1 : 0) - (has(IN.yawLeft) ? 1 : 0) + yawAxis);
  const targetPitch = pitchIn * turnRate;
  const targetYaw = -yawIn * turnRate;
  let targetRoll = 0;
  if (has(IN.rollLeft)) targetRoll += rollRate;
  if (has(IN.rollRight)) targetRoll -= rollRate;
  const hasTurn = Math.abs(targetPitch) > 0.01 || Math.abs(targetYaw) > 0.01 || Math.abs(targetRoll) > 0.01;
  // Angular velocity snaps to the target on input and stops dead on release
  const avx = hasTurn ? targetPitch : 0;
  const avy = hasTurn ? targetYaw : 0;
  const avz = hasTurn ? targetRoll : 0;
  if (avx * avx + avy * avy + avz * avz > 0.0001) {
    premulAxisAngle(s, rx, ry, rz, avx * dt); // pitch (local X)
    premulAxisAngle(s, ux, uy, uz, avy * dt); // yaw (local Y, no gimbal lock)
    premulAxisAngle(s, fx, fy, fz, avz * dt); // roll (local forward)
    normalizeQ(s);
  }
  if (has(IN.autoOrient)) autoOrient(s, fx, fy, fz);

  // ── Movement ──
  if (neutral) {
    if (has(IN.thrust)) { const k = NEUTRAL_THRUST_ACCEL * dt; s.vx += fx * k; s.vy += fy * k; s.vz += fz * k; }
    if (has(IN.reverse)) { const k = -NEUTRAL_REVERSE_ACCEL * dt; s.vx += fx * k; s.vy += fy * k; s.vz += fz * k; }
    if (has(IN.strafe)) { const k = NEUTRAL_STRAFE_ACCEL * dt; s.vx += rx * k; s.vy += ry * k; s.vz += rz * k; }
    if (has(IN.moveUp)) { const k = NEUTRAL_THRUST_ACCEL * dt; s.vx += ux * k; s.vy += uy * k; s.vz += uz * k; }
    if (has(IN.moveDown)) { const k = -NEUTRAL_THRUST_ACCEL * dt; s.vx += ux * k; s.vy += uy * k; s.vz += uz * k; }
    if (has(IN.brake)) {
      const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
      if (speed > 0.1) {
        const k = 1 - Math.min(NEUTRAL_BRAKE_DECEL * dt, speed) / speed;
        s.vx = s.vx * k; s.vy = s.vy * k; s.vz = s.vz * k;
      } else {
        s.vx = 0; s.vy = 0; s.vz = 0;
      }
    }
    // Full gravity, then light exponential space drag
    s.vx += g.fx * dt; s.vy += g.fy * dt; s.vz += g.fz * dt;
    s.vx = s.vx * NEUTRAL_DRAG_PER_STEP;
    s.vy = s.vy * NEUTRAL_DRAG_PER_STEP;
    s.vz = s.vz * NEUTRAL_DRAG_PER_STEP;
    capSpeed(s, NEUTRAL_MAX_SPEED);
  } else {
    // DRIVE: instant velocity, no coasting, no gravity
    s.vx = 0; s.vy = 0; s.vz = 0;
    if (has(IN.thrust)) { s.vx = fx * DRIVE_THRUST_SPEED; s.vy = fy * DRIVE_THRUST_SPEED; s.vz = fz * DRIVE_THRUST_SPEED; }
    if (has(IN.reverse)) { s.vx = fx * -DRIVE_REVERSE_SPEED; s.vy = fy * -DRIVE_REVERSE_SPEED; s.vz = fz * -DRIVE_REVERSE_SPEED; }
    if (has(IN.strafe)) { s.vx += rx * DRIVE_STRAFE_SPEED; s.vy += ry * DRIVE_STRAFE_SPEED; s.vz += rz * DRIVE_STRAFE_SPEED; }
    if (has(IN.moveUp)) { s.vx += ux * DRIVE_THRUST_SPEED; s.vy += uy * DRIVE_THRUST_SPEED; s.vz += uz * DRIVE_THRUST_SPEED; }
    if (has(IN.moveDown)) { s.vx += ux * -DRIVE_THRUST_SPEED; s.vy += uy * -DRIVE_THRUST_SPEED; s.vz += uz * -DRIVE_THRUST_SPEED; }
    if (has(IN.brake)) { s.vx = 0; s.vy = 0; s.vz = 0; }
    capSpeed(s, DRIVE_MAX_SPEED);
  }
  s.px += s.vx * dt; s.py += s.vy * dt; s.pz += s.vz * dt;

  // ── Slingshot impulse: once per pass around a body ──
  info.slingshotImpulse = false;
  if (slingNow) {
    const id = world.bodies[g.slingBody].id;
    if (s.slingId !== id) {
      s.slingId = id;
      const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
      const inv = 1 / (speed || 1);
      const impulse = g.slingSpeed * (g.slingBoost - 1.0) * SLINGSHOT_IMPULSE_MULTIPLIER;
      s.vx += s.vx * inv * impulse;
      s.vy += s.vy * inv * impulse;
      s.vz += s.vz * inv * impulse;
      info.slingshotImpulse = true;
    }
  } else {
    s.slingId = null;
  }

  // ── Beginner leash: bleed outward speed, ease the overshoot back ──
  info.leashed = applyLeash(s, world.leashRadius);
  return info;
}

/** Smoothly align roll to galactic up (THREE makeBasis + setFromRotationMatrix + slerp). */
function autoOrient(s: FlightSimState, fx: number, fy: number, fz: number): void {
  // idealRight = normalize(cross(forward, +Y))
  let rx = -fz, ry = 0, rz = fx;
  let inv = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz) || 1);
  rx = rx * inv; ry = ry * inv; rz = rz * inv;
  if (rx * rx + ry * ry + rz * rz < 0.001) return; // looking straight up/down
  // idealUp = normalize(cross(idealRight, forward))
  let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  inv = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) || 1);
  ux = ux * inv; uy = uy * inv; uz = uz * inv;
  // basis (right, up, -forward) → quaternion
  const m11 = rx, m12 = ux, m13 = -fx;
  const m21 = ry, m22 = uy, m23 = -fy;
  const m31 = rz, m32 = uz, m33 = -fz;
  const trace = m11 + m22 + m33;
  let tx: number, ty: number, tz: number, tw: number;
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1.0);
    tw = 0.25 / k; tx = (m32 - m23) * k; ty = (m13 - m31) * k; tz = (m21 - m12) * k;
  } else if (m11 > m22 && m11 > m33) {
    const k = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    tw = (m32 - m23) / k; tx = 0.25 * k; ty = (m12 + m21) / k; tz = (m13 + m31) / k;
  } else if (m22 > m33) {
    const k = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    tw = (m13 - m31) / k; tx = (m12 + m21) / k; ty = 0.25 * k; tz = (m23 + m32) / k;
  } else {
    const k = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    tw = (m21 - m12) / k; tx = (m13 + m31) / k; ty = (m23 + m32) / k; tz = 0.25 * k;
  }
  // slerp(s.q → target, t), THREE r185's formula
  let t = AUTO_ORIENT_PER_STEP;
  let dot = s.qx * tx + s.qy * ty + s.qz * tz + s.qw * tw;
  if (dot < 0) { tx = -tx; ty = -ty; tz = -tz; tw = -tw; dot = -dot; }
  let k = 1 - t;
  if (dot < 0.9995) {
    const theta = dacos(dot);
    const sin = dsin(theta);
    k = dsin(k * theta) / sin;
    t = dsin(t * theta) / sin;
    s.qx = s.qx * k + tx * t; s.qy = s.qy * k + ty * t; s.qz = s.qz * k + tz * t; s.qw = s.qw * k + tw * t;
  } else {
    s.qx = s.qx * k + tx * t; s.qy = s.qy * k + ty * t; s.qz = s.qz * k + tz * t; s.qw = s.qw * k + tw * t;
    normalizeQ(s);
  }
  normalizeQ(s);
}

/** Beginner cradle (Rough Draft M3c), now per sim step. Returns true while pulling. */
function applyLeash(s: FlightSimState, R: number | null): boolean {
  if (R === null) return false;
  const dx = s.px - ORIGIN_POSITION.x, dy = s.py - ORIGIN_POSITION.y, dz = s.pz - ORIGIN_POSITION.z;
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (r <= R || r === 0) return false;
  const ux = dx / r, uy = dy / r, uz = dz / r;
  const out = s.vx * ux + s.vy * uy + s.vz * uz;
  if (out > 0) {
    s.vx -= ux * out; s.vy -= uy * out; s.vz -= uz * out;
  }
  const target = R + (r - R) * LEASH_EASE_PER_STEP;
  s.px = ORIGIN_POSITION.x + ux * target;
  s.py = ORIGIN_POSITION.y + uy * target;
  s.pz = ORIGIN_POSITION.z + uz * target;
  return true;
}

/** FNV-1a over the state's doubles: a cheap fingerprint for determinism checks. */
export function stateHash(s: FlightSimState): string {
  const f = new Float64Array([s.px, s.py, s.pz, s.vx, s.vy, s.vz, s.qx, s.qy, s.qz, s.qw, s.dampen]);
  const bytes = new Uint8Array(f.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Position sanity for matches (Phase 10; Alex, 2026-11-24: movement is "trusted but also
 * reconciled by the server"). Players still move themselves (the interior sim on their
 * own device) and the match host samples where each one says they are. This is the check
 * the host runs on every such sample before the referee sees it.
 *
 * What it stops:
 * - **Teleports**: a sample farther from the last accepted one than anyone could have
 *   moved in the time since (plus a burst allowance, below).
 * - **Speed hacks beyond the slack**: over any stretch of time a player cannot cover more
 *   ground than sprinting flat out at the match's speed trait allows, plus one burst.
 * - **Leaving a walled arena**: with `edge: "wall"` a sample outside the arena's box.
 *
 * What it does NOT stop (that needs the interior sim on the server with the world's
 * terrain and objects, Phase 09 item 9F):
 * - walking through walls, objects or terrain, or standing in mid-air below the jump limits;
 * - a client that lies within the limits (moving at sprint speed without pressing sprint,
 *   jumping the burst allowance — about 10 m at normal speed — once it has stood still or
 *   moved slowly for a second, flying with the jetpack trait off as long as it rises no
 *   faster than a jump and stairs allow);
 * - anything at all in a world whose gravity pulls sideways or upward: those axes are
 *   not checked there, because an honest fall has no speed limit the host can know.
 *
 * How: one allowance ("budget") per direction (sideways, up, down), in metres. It refills
 * with time at the fastest honest speed and is capped at one burst (BURST_S seconds of
 * that speed plus a fixed slack), so a connection that hiccups for a second and then
 * reports where the player got to is believed, and jitter between ten-a-second samples
 * never trips it. Moving spends it. A sample that would overspend is refused: nothing is
 * spent and the last accepted position stands.
 *
 * Pure: no clock (the caller passes its time in ms), no randomness.
 */
import { boundsOf, type Bounds, type Game } from "./game.js";
import type { ControlInput, MatchRecord } from "./match.js";
import { JET_ACCEL, JET_FUEL, JUMP_SPEED, SPRINT_SPEED } from "./sim/interior.js";

/** How long a client may go quiet and still be believed about where it got to. */
export const BURST_S = 1;
/** Fixed slack on top of the burst (metres): centimetre rounding, one late sample. */
export const SLACK_M = 1;
/** Speeds are allowed this much over what the sim gives (frame pacing differs between devices). */
export const SPEED_MARGIN = 1.15;
/** Around a walled arena's box: the client clamps a body's middle, the sample is its feet, and both are rounded. */
export const WALL_SLACK = 0.5;
/** The fastest honest fall the host assumes: this many seconds of free fall with no drag, and never less than MIN_FALL m/s. */
const FALL_S = 4;
const MIN_FALL = 30;
/** Gravity pulling sideways harder than this (m/s²) makes sideways speed unknowable here. */
const SIDE_GRAVITY = 0.5;

export interface SanityLimits {
  /** Fastest honest speed (m/s) sideways, upward and downward; Infinity = that direction is not checked. */
  side: number; up: number; down: number;
  /** A walled arena's box (already grown by WALL_SLACK), or null. */
  wall: Bounds | null;
}

/** The last accepted position, when it was accepted (or last refilled), and what is left to spend in each direction. */
export interface SanityState { x: number; y: number; z: number; at: number; side: number; up: number; down: number }

export type SanityVerdict = { ok: true; state: SanityState } | { ok: false; why: "speed" | "wall"; state: SanityState };

interface Pos { x: number; y: number; z: number }

/**
 * A match's limits, from its own game (the version it started with) and the world's gravity.
 * - Sideways: sprinting × the speed trait.
 * - Up: a jump, plus the whole jetpack on top unless the match has `fly: false`, plus
 *   climbing steps at a sprint (each step lifts the feet at once).
 * - Down: a generous free fall under the world's gravity × the gravity trait.
 */
export function sanityLimits(game: Game, gravity?: { x: number; y: number; z: number } | null): SanityLimits {
  const t = game.settings.traits;
  const speedMul = Number.isFinite(t.speedMul) && t.speedMul > 0 ? t.speedMul : 1;
  const gravityMul = Number.isFinite(t.gravityMul) && t.gravityMul > 0 ? t.gravityMul : 1;
  const g = gravity ?? { x: 0, y: -9.8, z: 0 };
  const sideways = Math.hypot(g.x, g.z) > SIDE_GRAVITY;
  const upward = g.y > 0;
  const run = SPRINT_SPEED * speedMul;
  const b = game.settings.edge === "wall" && game.arena ? boundsOf(game.arena) : null;
  return {
    side: sideways ? Infinity : run * SPEED_MARGIN,
    up: upward ? Infinity : (JUMP_SPEED + (t.fly === false ? 0 : JET_ACCEL * JET_FUEL) + run) * SPEED_MARGIN,
    down: upward ? Infinity : Math.max(MIN_FALL, Math.abs(g.y) * gravityMul * FALL_S),
    wall: b ? { minX: b.minX - WALL_SLACK, maxX: b.maxX + WALL_SLACK, minY: b.minY - WALL_SLACK, maxY: b.maxY + WALL_SLACK, minZ: b.minZ - WALL_SLACK, maxZ: b.maxZ + WALL_SLACK } : null,
  };
}

const cap = (rate: number): number => (Number.isFinite(rate) ? rate * BURST_S + SLACK_M : Infinity);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const inWall = (w: Bounds, p: Pos): boolean => p.x >= w.minX && p.x <= w.maxX && p.y >= w.minY && p.y <= w.maxY && p.z >= w.minZ && p.z <= w.maxZ;

/**
 * Start (or restart) from a position the server itself chose: a spawn, a return, a rejoin.
 * Full allowance. With a walled arena the position is brought inside the box, so "go back
 * to the last accepted position" can never send a player to a spot the wall then refuses.
 */
export function sanityStart(limits: SanityLimits, pos: Pos, now: number): SanityState {
  const w = limits.wall;
  const p = w ? { x: clamp(pos.x, w.minX, w.maxX), y: clamp(pos.y, w.minY, w.maxY), z: clamp(pos.z, w.minZ, w.maxZ) } : pos;
  return { x: p.x, y: p.y, z: p.z, at: now, side: cap(limits.side), up: cap(limits.up), down: cap(limits.down) };
}

/** Judge one sample. Accepted: it becomes the last accepted position and its distance is spent. Refused: nothing moves, nothing is spent. */
export function checkSample(limits: SanityLimits, st: SanityState, pos: Pos, now: number): SanityVerdict {
  const dt = Math.max(0, now - st.at) / 1000;
  const refill = (left: number, rate: number): number => (Number.isFinite(rate) ? Math.min(cap(rate), left + rate * dt) : Infinity);
  const have: SanityState = { ...st, at: now, side: refill(st.side, limits.side), up: refill(st.up, limits.up), down: refill(st.down, limits.down) };
  if (limits.wall && !inWall(limits.wall, pos)) return { ok: false, why: "wall", state: have };
  const side = Math.hypot(pos.x - st.x, pos.z - st.z);
  const dy = pos.y - st.y;
  const up = dy > 0 ? dy : 0;
  const down = dy < 0 ? -dy : 0;
  if (side > have.side || up > have.up || down > have.down) return { ok: false, why: "speed", state: have };
  return { ok: true, state: { x: pos.x, y: pos.y, z: pos.z, at: now, side: have.side - side, up: have.up - up, down: have.down - down } };
}

/** The refused samples in a record (`reject` control inputs), for research and for whoever settles a dispute. */
export function rejectionsIn(record: Pick<MatchRecord, "frames">): { tick: number; slot: number; why: string; at: [number, number, number] }[] {
  const out: { tick: number; slot: number; why: string; at: [number, number, number] }[] = [];
  for (const f of record.frames) {
    for (const c of f.c ?? []) {
      const r = c as ControlInput;
      if (r.type === "reject") out.push({ tick: f.t, slot: r.slot, why: r.why, at: r.at });
    }
  }
  return out;
}

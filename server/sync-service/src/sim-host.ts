/**
 * Online flight authority (Phase 09, 9B rough draft).
 *
 * Every universe socket that flies gets a copy of the shared deterministic
 * sim (`shared/sim/flight.ts`). The client predicts with the same code and
 * sends its inputs (~20 Hz) plus where it thinks it ended up; the server
 * steps the same inputs and:
 *
 *  - adopts the client's state when it matches (the normal case: same code,
 *    same numbers, so nothing is sent back at all),
 *  - sends a correction (`sim-correct`) when it doesn't, or when the client
 *    sends more ticks than real time allows (speed hacks),
 *  - accepts an out-of-sim move (`sim-reset`: warp, card/link teleport,
 *    leaving a world, spawn) only if it lands near a world / the Portal, or
 *    within what a perfect honest flier could have covered since the last
 *    confirmed state (80 u/s + slack). Anything else is corrected back.
 *
 * Epochs: a correction bumps the epoch; bundles still in flight from before it
 * are stepped but not compared, so one correction never cascades.
 *
 * Cost: one step per tick per flying player, against only the bodies within
 * BODY_RADIUS (refreshed each second), so O(players × nearby worlds).
 *
 * Not yet (logged in phases/09): the last confirmed state is in memory only
 * (a deploy forgets it, and then a resume is accepted as a fresh spawn);
 * warp unlock / World-Index checks for warp targets (9C); presence still uses
 * client-reported positions.
 */
import { stepFlight, newStepInfo, FLIGHT_HZ, type FlightSimState } from "../../../shared/sim/flight.js";
import { buildBodies, type BodySource, type SimBody, type SimWorld } from "../../../shared/sim/gravity.js";
import { decodeInputBundle, decodeReset, encodeCorrection } from "../../../shared/sim/wire.js";

/** Real-time budget: ticks may run this far ahead of the wall clock (network bunching). */
const SLACK_TICKS = 30;
/** Unused ticks banked while idle (a paused tab), at most this many. */
const BANK_TICKS = 180;
/** Gravity bodies kept per player (GRAVITY_RANGE is 120; flight covers < 80 u in the 1 s refresh). */
const BODY_RADIUS = 300;
const BODY_REFRESH_MS = 1000;
const WORLDS_REFRESH_MS = 5000;
/** A reset may land this close to any world or the Portal (arrivals, warps, world exits). */
const RESET_NEAR_WORLD = 40;
/** The honest-flier bound: NEUTRAL's speed cap, plus slack. */
const HONEST_SPEED = 80;
const RESET_SLACK = 50;
/** Agreement needed to adopt the client's state, per frame in the bundle. */
const POS_TOL_PER_FRAME = 0.002;
const VEL_TOL_PER_FRAME = 0.02;
const QUAT_TOL = 0.002;
const LAST_KNOWN_MAX = 20_000;

interface Conn {
  state: FlightSimState | null;
  nextSeq: number;
  epoch: number;
  /** Real-time budget start (ms) and ticks used since. */
  t0: number;
  used: number;
  lastAt: number;
  bodies: SimBody[];
  bodiesAt: number;
  playerId: string | null;
}

export interface SimHostStats {
  conns: number;
  steps: number;
  corrections: number;
  droppedFrames: number;
  rejectedResets: number;
}

export class SimHost {
  private conns = new Map<object, Conn>();
  /** Last confirmed state per character (survives reconnects, not restarts). */
  private lastKnown = new Map<string, { s: FlightSimState; at: number }>();
  private allBodies: SimBody[] = [];
  private allAt = -Infinity;
  private counters = { steps: 0, corrections: 0, droppedFrames: 0, rejectedResets: 0 };
  private info = newStepInfo();

  constructor(
    private worlds: () => Iterable<BodySource>,
    private now: () => number = () => Date.now(),
  ) {}

  /** The universe changed (a world was added / moved): rebuild bodies on next use. */
  invalidateWorlds(): void {
    this.allAt = -Infinity;
  }

  stats(): SimHostStats {
    return { conns: this.conns.size, ...this.counters };
  }

  /** Where the server believes this socket's player is, or null. */
  stateOf(key: object): FlightSimState | null {
    return this.conns.get(key)?.state ?? null;
  }

  drop(key: object): void {
    const c = this.conns.get(key);
    if (c?.state && c.playerId) this.remember(c.playerId, c.state, c.lastAt);
    this.conns.delete(key);
  }

  /** A `sim-input` bundle. Returns a `sim-correct` payload to send back, or null. */
  input(key: object, playerId: string | null, data: Uint8Array): Uint8Array | null {
    const b = decodeInputBundle(data);
    const c = this.conns.get(key);
    if (!b || !c || !c.state) return null; // the client opens with a reset
    const now = this.now();
    let seq = b.firstSeq;
    let frames = b.frames;
    if (seq < c.nextSeq) {
      frames = frames.slice(c.nextSeq - seq);
      seq = c.nextSeq;
      if (frames.length === 0) return null;
    }
    const contiguous = seq === c.nextSeq;
    c.nextSeq = seq;

    // Real-time budget (+ a capped bank for idle time)
    const elapsedTicks = Math.floor(((now - c.t0) * FLIGHT_HZ) / 1000);
    if (elapsedTicks - c.used > BANK_TICKS) {
      c.t0 = now - ((c.used + BANK_TICKS) * 1000) / FLIGHT_HZ;
    }
    const allowed = Math.floor(((now - c.t0) * FLIGHT_HZ) / 1000) + SLACK_TICKS;

    const world: SimWorld = { bodies: this.bodiesFor(c, now), leashRadius: b.leashRadius };
    let over = false;
    for (const f of frames) {
      if (c.used >= allowed) {
        over = true;
        this.counters.droppedFrames += 1;
        continue;
      }
      stepFlight(c.state, f, world, this.info);
      c.used++;
      c.nextSeq++;
      this.counters.steps++;
    }
    c.lastAt = now;
    c.playerId = playerId;
    if (playerId) this.remember(playerId, c.state, now);

    if (over) return this.correct(c);
    if (b.epoch !== c.epoch || !contiguous) return contiguous ? null : this.correct(c);
    if (agrees(c.state, b.state, frames.length)) {
      const sling = c.state.slingId;
      Object.assign(c.state, b.state, { slingId: sling });
      return null;
    }
    return this.correct(c);
  }

  /** A `sim-reset` (the game moved the player outside the sim). Returns a correction if refused. */
  reset(key: object, playerId: string | null, data: Uint8Array): Uint8Array | null {
    const r = decodeReset(data);
    if (!r) return null;
    const now = this.now();
    let c = this.conns.get(key);
    if (!c) {
      c = { state: null, nextSeq: r.nextSeq, epoch: 0, t0: now, used: 0, lastAt: now, bodies: [], bodiesAt: -Infinity, playerId };
      this.conns.set(key, c);
    }
    c.playerId = playerId;
    const s = sanitize(r.state);
    const ref = c.state ? { s: c.state, at: c.lastAt } : playerId ? this.lastKnown.get(playerId) ?? null : null;
    const ok =
      !ref || // first state ever seen for this player (in memory): accepted as a spawn
      this.nearWorld(s, now) ||
      dist(s, ref.s) <= (HONEST_SPEED * Math.max(0, now - ref.at)) / 1000 + RESET_SLACK;
    c.nextSeq = r.nextSeq;
    c.bodiesAt = -Infinity;
    if (ok) {
      c.state = s;
      c.lastAt = now;
      if (playerId) this.remember(playerId, s, now);
      return null;
    }
    this.counters.rejectedResets++;
    if (!c.state && ref) c.state = { ...ref.s, slingId: null };
    return this.correct(c);
  }

  // ── private ──

  private correct(c: Conn): Uint8Array {
    c.epoch = (c.epoch + 1) & 0xffff;
    this.counters.corrections++;
    return encodeCorrection({ ackSeq: (c.nextSeq - 1) >>> 0, epoch: c.epoch, state: c.state! });
  }

  private remember(playerId: string, s: FlightSimState, at: number): void {
    const prev = this.lastKnown.get(playerId);
    if (prev) {
      Object.assign(prev.s, s);
      prev.at = at;
      return;
    }
    if (this.lastKnown.size >= LAST_KNOWN_MAX) {
      const oldest = this.lastKnown.keys().next().value;
      if (oldest !== undefined) this.lastKnown.delete(oldest);
    }
    this.lastKnown.set(playerId, { s: { ...s }, at });
  }

  private all(now: number): SimBody[] {
    if (now - this.allAt > WORLDS_REFRESH_MS) {
      // World age is read at minute resolution, as on the client (GravitySystem.simWorld)
      this.allBodies = buildBodies(this.worlds(), Math.floor(now / 60_000) * 60_000);
      this.allAt = now;
    }
    return this.allBodies;
  }

  /** Bodies within BODY_RADIUS, in the universe's order (so gravity sums match the client's bit for bit). */
  private bodiesFor(c: Conn, now: number): SimBody[] {
    if (now - c.bodiesAt > BODY_REFRESH_MS && c.state) {
      const s = c.state;
      const r2 = BODY_RADIUS * BODY_RADIUS;
      c.bodies = this.all(now).filter((b) => (b.x - s.px) ** 2 + (b.y - s.py) ** 2 + (b.z - s.pz) ** 2 <= r2);
      c.bodiesAt = now;
    }
    return c.bodies;
  }

  private nearWorld(s: FlightSimState, now: number): boolean {
    const r2 = RESET_NEAR_WORLD * RESET_NEAR_WORLD;
    for (const b of this.all(now)) if ((b.x - s.px) ** 2 + (b.y - s.py) ** 2 + (b.z - s.pz) ** 2 <= r2) return true;
    return false;
  }
}

function dist(a: FlightSimState, b: FlightSimState): number {
  return Math.sqrt((a.px - b.px) ** 2 + (a.py - b.py) ** 2 + (a.pz - b.pz) ** 2);
}

function agrees(a: FlightSimState, b: FlightSimState, frames: number): boolean {
  const n = Math.max(1, frames);
  return (
    dist(a, b) <= POS_TOL_PER_FRAME * n &&
    Math.sqrt((a.vx - b.vx) ** 2 + (a.vy - b.vy) ** 2 + (a.vz - b.vz) ** 2) <= VEL_TOL_PER_FRAME * n &&
    Math.abs(a.qx - b.qx) + Math.abs(a.qy - b.qy) + Math.abs(a.qz - b.qz) + Math.abs(a.qw - b.qw) <= QUAT_TOL &&
    Math.abs(a.dampen - b.dampen) <= 0.01
  );
}

/** Clamp a client-claimed state into what the sim can produce. */
function sanitize(s: FlightSimState): FlightSimState {
  const out = { ...s, slingId: null };
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  if (sp > HONEST_SPEED) {
    const k = HONEST_SPEED / sp;
    out.vx *= k; out.vy *= k; out.vz *= k;
  }
  const ql = Math.sqrt(s.qx * s.qx + s.qy * s.qy + s.qz * s.qz + s.qw * s.qw);
  if (ql > 0) {
    out.qx /= ql; out.qy /= ql; out.qz /= ql; out.qw /= ql;
  } else {
    out.qx = 0; out.qy = 0; out.qz = 0; out.qw = 1;
  }
  out.dampen = Math.max(0, Math.min(1, s.dampen));
  return out;
}

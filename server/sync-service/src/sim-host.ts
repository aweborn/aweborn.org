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
 * Offline replay (9C): back online, the client sends `sim-resume` (start
 * state + how many ticks it flew offline) and then its offline log as
 * ordinary `sim-input` / `sim-reset` messages. The server grants those ticks
 * as a credit, capped by how long it actually was away since the last
 * confirmed state (+ slack, ≤ 30 min), so an offline log can never hold more
 * flight than real time allowed. The last confirmed state per character is
 * kept through a `SimStore` (SQLite: sim-store.ts), so a deploy no longer
 * forgets it.
 *
 * Not yet (logged in phases/09): warp unlock / World-Index checks for warp
 * targets; sightings derived from the replayed path; presence still uses
 * client-reported positions; the replay runs on the main thread (bounded by
 * the 30 min cap and per-message size, not in a worker).
 */
import { stepFlight, newStepInfo, FLIGHT_HZ, IN, type FlightSimState } from "../../../shared/sim/flight.js";
import { buildBodies, type BodySource, type SimBody, type SimWorld } from "../../../shared/sim/gravity.js";
import { decodeInputBundle, decodeReset, decodeResume, encodeCorrection } from "../../../shared/sim/wire.js";

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
/** Offline credit: at most this much flight per resume (30 min), and this much with no known last state (2 min). */
const MAX_OFFLINE_TICKS = 30 * 60 * FLIGHT_HZ;
const MAX_UNVERIFIED_TICKS = 2 * 60 * FLIGHT_HZ;

/** Where the last confirmed state per character is kept between restarts. */
export interface SimStore {
  load(playerId: string): { s: FlightSimState; at: number } | null;
  save(rows: Array<{ playerId: string; s: FlightSimState; at: number }>): void;
}

const MEMORY_ONLY: SimStore = { load: () => null, save: () => {} };

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
  /** Offline-log ticks still allowed beyond real time (9C). */
  credit: number;
}

export interface SimHostStats {
  conns: number;
  steps: number;
  corrections: number;
  droppedFrames: number;
  rejectedResets: number;
  resumes: number;
  offlineTicks: number;
}

export class SimHost {
  private conns = new Map<object, Conn>();
  /** Last confirmed state per character (survives reconnects, not restarts). */
  private lastKnown = new Map<string, { s: FlightSimState; at: number }>();
  private allBodies: SimBody[] = [];
  private allAt = -Infinity;
  private counters = { steps: 0, corrections: 0, droppedFrames: 0, rejectedResets: 0, resumes: 0, offlineTicks: 0 };
  private info = newStepInfo();
  /** Characters whose last confirmed state changed since the last flush(). */
  private dirty = new Set<string>();
  /** Telemetry (9D): called with each checked state at the end of a bundle (telemetry.ts downsamples). */
  sampler: ((playerId: string, s: FlightSimState, neutral: boolean, t: number) => void) | null = null;
  /** One screen steers (M9): called when a bundle carries real (non-idle) input. */
  onActive: ((key: object, playerId: string) => void) | null = null;

  constructor(
    private worlds: () => Iterable<BodySource>,
    private now: () => number = () => Date.now(),
    private store: SimStore = MEMORY_ONLY,
  ) {}

  /** Write changed last-known states to the store (RoomManager's periodic flush + shutdown). */
  flush(): void {
    if (this.dirty.size === 0) return;
    const rows: Array<{ playerId: string; s: FlightSimState; at: number }> = [];
    for (const id of this.dirty) {
      const k = this.lastKnown.get(id);
      if (k) rows.push({ playerId: id, s: k.s, at: k.at });
    }
    this.dirty.clear();
    this.store.save(rows);
  }

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
    let flown = false;
    for (const f of frames) {
      if (!flown && ((f.bits & ~(IN.neutral | IN.autoOrient)) !== 0 || f.yaw !== 0 || f.pitch !== 0)) flown = true;
      if (c.credit > 0) {
        c.credit--; // offline log ticks (9C): already bounded by the time away
        this.counters.offlineTicks++;
      } else if (c.used >= allowed) {
        over = true;
        this.counters.droppedFrames += 1;
        continue;
      } else {
        c.used++;
      }
      stepFlight(c.state, f, world, this.info);
      c.nextSeq++;
      this.counters.steps++;
    }
    c.lastAt = now;
    c.playerId = playerId;
    if (playerId) {
      this.remember(playerId, c.state, now);
      // Offline replays: the tick happened (credit left) ticks ago
      const last = frames[frames.length - 1];
      if (this.sampler && last) this.sampler(playerId, c.state, (last.bits & IN.neutral) !== 0, now - (c.credit * 1000) / FLIGHT_HZ);
      if (flown && this.onActive) this.onActive(key, playerId);
    }

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
    return this.start(key, playerId, r.nextSeq, r.state, -1);
  }

  /**
   * A `sim-resume` (9C): back online with an offline log of `frames` ticks,
   * starting from `state`. The log's messages follow on the same socket.
   */
  resume(key: object, playerId: string | null, data: Uint8Array): Uint8Array | null {
    const r = decodeResume(data);
    if (!r) return null;
    this.counters.resumes++;
    return this.start(key, playerId, r.nextSeq, r.state, r.frames);
  }

  /** Shared by reset/resume: accept the new state if it's plausible, else correct to the last known one. */
  private start(key: object, playerId: string | null, nextSeq: number, claimed: FlightSimState, offlineFrames: number): Uint8Array | null {
    const now = this.now();
    let c = this.conns.get(key);
    if (!c) {
      c = { state: null, nextSeq, epoch: 0, t0: now, used: 0, lastAt: now, bodies: [], bodiesAt: -Infinity, playerId, credit: 0 };
      this.conns.set(key, c);
    }
    c.playerId = playerId;
    const s = sanitize(claimed);
    const ref = c.state ? { s: c.state, at: c.lastAt } : playerId ? this.known(playerId) : null;
    if (offlineFrames >= 0) {
      // Offline time since the last confirmed state, as ticks (+ slack); the log can't hold more than that
      const away = ref ? Math.floor((Math.max(0, now - ref.at) * FLIGHT_HZ) / 1000) + SLACK_TICKS : MAX_UNVERIFIED_TICKS;
      c.credit = Math.min(offlineFrames, away, MAX_OFFLINE_TICKS);
      c.t0 = now;
      c.used = 0;
    }
    const ok =
      !ref || // first state ever seen for this player: accepted as a spawn
      this.nearWorld(s, now) ||
      dist(s, ref.s) <= (HONEST_SPEED * Math.max(0, now - ref.at)) / 1000 + RESET_SLACK;
    c.nextSeq = nextSeq;
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

  /** Last confirmed state: memory first, then the store (after a restart). */
  private known(playerId: string): { s: FlightSimState; at: number } | null {
    const m = this.lastKnown.get(playerId);
    if (m) return m;
    const row = this.store.load(playerId);
    if (!row) return null;
    this.remember(playerId, row.s, row.at);
    this.dirty.delete(playerId);
    return this.lastKnown.get(playerId) ?? null;
  }

  private remember(playerId: string, s: FlightSimState, at: number): void {
    this.dirty.add(playerId);
    const prev = this.lastKnown.get(playerId);
    if (prev) {
      Object.assign(prev.s, s);
      prev.at = at;
      return;
    }
    if (this.lastKnown.size >= LAST_KNOWN_MAX) {
      const oldest = this.lastKnown.keys().next().value;
      if (oldest !== undefined) {
        if (this.dirty.has(oldest)) this.flush();
        this.lastKnown.delete(oldest);
      }
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

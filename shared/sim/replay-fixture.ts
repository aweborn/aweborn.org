/**
 * A fixed replay for determinism checks (Phase 09, 9A).
 *
 * The same input log + world must give the same `stateHash` in every
 * engine. `flight.test.ts` pins the hash in Node; the cross-engine harness
 * (`scripts/sim-determinism/run.mjs`) bundles this file and runs it in
 * other engines (Chromium, JavaScriptCore, …) against the same golden.
 *
 * No test-runner or Node imports here: it must bundle for a bare JS engine.
 */
import { stepFlight, initialFlightState, stateHash, quantizeAxis, IN, type InputFrame } from "./flight.js";
import { buildBodies, type BodySource, type SimWorld } from "./gravity.js";
import { dsin, dcos, datan, dacos } from "./dmath.js";

export const FIXTURE_NOW = Date.UTC(2026, 9, 28);

export const FIXTURE_WORLDS: BodySource[] = [
  { id: "w-near", resolvedPosition: { x: 8, y: 1, z: 40 }, playerCount: 2, createdAt: FIXTURE_NOW - 3 * 86400000 },
  { id: "w-young", resolvedPosition: { x: -30, y: -5, z: 70 }, playerCount: 0, createdAt: FIXTURE_NOW - 3600000 },
  { id: "w-child", parentWorldId: "w-near", resolvedPosition: { x: 9, y: 1, z: 41 }, playerCount: 0, createdAt: FIXTURE_NOW },
  { id: "w-far", resolvedPosition: { x: 400, y: 0, z: 0 }, playerCount: 5, createdAt: FIXTURE_NOW - 86400000 },
];

export const FIXTURE_WORLD: SimWorld = { bodies: buildBodies(FIXTURE_WORLDS, FIXTURE_NOW), leashRadius: null };

/** Small deterministic PRNG (mulberry32): integer ops only. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Human-ish input log: held inputs that change every 10–60 ticks. */
export function inputLog(seed: number, ticks: number, neutral: boolean, opts: { axes?: boolean; autoOrient?: boolean } = {}): InputFrame[] {
  const r = rng(seed);
  const out: InputFrame[] = [];
  let cur: InputFrame = { bits: neutral ? IN.neutral : 0, yaw: 0, pitch: 0 };
  let hold = 0;
  const pool: number[] = [IN.thrust, IN.thrust, IN.thrust, IN.brake, IN.reverse, IN.strafe, IN.moveUp, IN.moveDown,
    IN.pitchUp, IN.pitchDown, IN.yawLeft, IN.yawRight, IN.rollLeft, IN.rollRight];
  if (opts.autoOrient) pool.push(IN.autoOrient);
  for (let i = 0; i < ticks; i++) {
    if (hold-- <= 0) {
      hold = 10 + Math.floor(r() * 50);
      let bits: number = neutral ? IN.neutral : 0;
      const n = Math.floor(r() * 3);
      for (let k = 0; k < n; k++) bits |= pool[Math.floor(r() * pool.length)];
      cur = {
        bits,
        yaw: opts.axes && r() < 0.4 ? quantizeAxis(r() * 2 - 1) : 0,
        pitch: opts.axes && r() < 0.4 ? quantizeAxis(r() * 2 - 1) : 0,
      };
    }
    out.push(cur);
  }
  return out;
}

/**
 * goldenReplay() as recorded on V8 (Node, 2026-10-28). Changing the sim's
 * math on purpose changes this: re-record it, and say so in phases/09.
 */
export const GOLDEN_REPLAY = "8cbbb229";

/** 80 s of mixed NEUTRAL + DRIVE flight → state hash. */
export function goldenReplay(): string {
  const s = initialFlightState();
  for (const f of inputLog(2026, 3600, true, { axes: true, autoOrient: true })) stepFlight(s, f, FIXTURE_WORLD);
  for (const f of inputLog(2027, 1200, false, { axes: true })) stepFlight(s, f, FIXTURE_WORLD);
  return stateHash(s);
}

/** Every dmath kernel over a sweep, as one string of exact doubles. */
export function mathSweep(): string {
  const parts: string[] = [];
  for (let i = -300; i <= 300; i++) {
    const x = i * 0.0731;
    parts.push(String(dsin(x)), String(dcos(x)), String(datan(x)));
    if (x >= -1 && x <= 1) parts.push(String(dacos(x)));
  }
  return parts.join(",");
}

/** What the harness compares across engines. */
export function determinismReport(): { replay: string; sweepLength: number; sweepHash: string } {
  const sweep = mathSweep();
  let h = 0x811c9dc5;
  for (let i = 0; i < sweep.length; i++) {
    h ^= sweep.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { replay: goldenReplay(), sweepLength: sweep.length, sweepHash: h.toString(16).padStart(8, "0") };
}

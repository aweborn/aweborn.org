/**
 * Online flight authority (9B): honest clients are never corrected; speed
 * hacks, bent physics and teleports are.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimHost } from "./sim-host.js";
import { stepFlight, initialFlightState, IN, type FlightSimState, type InputFrame } from "../../../shared/sim/flight.js";
import { buildBodies, type BodySource } from "../../../shared/sim/gravity.js";
import { encodeInputBundle, encodeReset, decodeCorrection } from "../../../shared/sim/wire.js";

const T0 = Date.UTC(2026, 9, 28, 12);
const WORLDS: BodySource[] = [
  { id: "w1", resolvedPosition: { x: 8, y: 1, z: 40 }, playerCount: 1, createdAt: T0 - 86400000 },
  { id: "w2", resolvedPosition: { x: 900, y: 0, z: 0 }, playerCount: 0, createdAt: T0 - 86400000 },
];

function setup() {
  let now = T0;
  const host = new SimHost(() => WORLDS, () => now);
  const key = {};
  return { host, key, advance: (ms: number) => (now += ms), at: () => now };
}

/** A client predicting with the shared sim, like FlightController + simLink. */
function client(start: FlightSimState) {
  const s: FlightSimState = { ...start };
  const world = { bodies: buildBodies(WORLDS, Math.floor(T0 / 60_000) * 60_000), leashRadius: null };
  let seq = 0;
  return {
    s,
    reset: () => encodeReset({ nextSeq: seq, state: s }),
    bundle(frames: InputFrame[], epoch = 0, tamper?: (s: FlightSimState) => void) {
      const firstSeq = seq;
      for (const f of frames) { stepFlight(s, f, world); seq++; }
      tamper?.(s);
      return encodeInputBundle({ firstSeq, epoch, leashRadius: null, state: s, frames });
    },
  };
}

const thrust: InputFrame = { bits: IN.neutral | IN.thrust | IN.yawLeft, yaw: 0, pitch: 0 };

test("honest client in real time: never corrected, server agrees", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  assert.equal(host.reset(key, "p1", c.reset()), null);
  for (let i = 0; i < 200; i++) {
    advance(50);
    assert.equal(host.input(key, "p1", c.bundle([thrust, thrust, thrust])), null, `bundle ${i}`);
  }
  const s = host.stateOf(key)!;
  assert.equal(s.px, c.s.px);
  assert.equal(s.pz, c.s.pz);
  assert.equal(host.stats().corrections, 0);
});

test("speed hack (ticks faster than real time) is cut and corrected", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  host.reset(key, "p1", c.reset());
  let corrected = false;
  for (let i = 0; i < 40 && !corrected; i++) {
    advance(50); // 3 ticks of real time, 12 claimed
    corrected = host.input(key, "p1", c.bundle(Array(12).fill(thrust))) !== null;
  }
  assert.ok(corrected);
  assert.ok(host.stats().droppedFrames > 0);
});

test("bent physics (moving further than the sim allows) is corrected back", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  host.reset(key, "p1", c.reset());
  advance(50);
  const out = host.input(key, "p1", c.bundle([thrust, thrust, thrust], 0, (s) => { s.pz -= 1; }));
  assert.ok(out);
  const corr = decodeCorrection(out!)!;
  assert.equal(corr.ackSeq, 2);
  assert.equal(corr.epoch, 1);
  assert.notEqual(corr.state.pz, c.s.pz);
  // bundles still in flight from before the correction (old epoch) are stepped, not judged
  advance(50);
  assert.equal(host.input(key, "p1", c.bundle([thrust, thrust, thrust], 0)), null);
});

test("teleport resets: far from any world and beyond the honest-flier bound → refused", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  host.reset(key, "p1", c.reset());
  advance(1000);
  c.s.px = 5000; // 1 s later, 5,000 u away, nothing there
  const out = host.reset(key, "p1", c.reset());
  assert.ok(out);
  assert.equal(decodeCorrection(out!)!.state.px, 0);
  assert.equal(host.stats().rejectedResets, 1);
});

test("resets that land near a world (warp, card tap, world exit) or within reach are accepted", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  host.reset(key, "p1", c.reset());
  advance(1000);
  c.s.px = 905; c.s.py = 0; c.s.pz = 10; // beside w2, 900 u away: a warp
  assert.equal(host.reset(key, "p1", c.reset()), null);
  advance(2000);
  c.s.px = 905 + 150; // 150 u in 2 s: an honest flier could (80 u/s)
  assert.equal(host.reset(key, "p1", c.reset()), null);
});

test("reconnect: the new socket's resume is bounded by the last confirmed state", () => {
  const { host, advance } = setup();
  const a = {}, b = {};
  const c = client(initialFlightState());
  host.reset(a, "p1", c.reset());
  host.drop(a);
  advance(1000);
  c.s.px = 3000;
  assert.ok(host.reset(b, "p1", c.reset()), "jumped 3,000 u across a reconnect");
});

test("inputs before any reset, malformed bundles: ignored", () => {
  const { host, key } = setup();
  const c = client(initialFlightState());
  assert.equal(host.input(key, "p1", c.bundle([thrust])), null);
  assert.equal(host.input(key, "p1", new Uint8Array([1, 2, 3])), null);
  assert.equal(host.stateOf(key), null);
});

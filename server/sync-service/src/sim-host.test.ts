/**
 * Online flight authority (9B): honest clients are never corrected; speed
 * hacks, bent physics and teleports are. Offline logs (9C) replay within the
 * time away and no further.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimHost } from "./sim-host.js";
import { stepFlight, initialFlightState, IN, type FlightSimState, type InputFrame } from "../../../shared/sim/flight.js";
import { buildBodies, type BodySource } from "../../../shared/sim/gravity.js";
import { encodeInputBundle, encodeReset, encodeResume, decodeReset, decodeCorrection } from "../../../shared/sim/wire.js";

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

// ── 9C: offline replay ──

function resumeMsg(c: ReturnType<typeof client>, frames: number) {
  // The client's start state = where the log began (the client's current state before the log)
  const r = decodeReset(c.reset())!;
  return encodeResume({ nextSeq: r.nextSeq, frames, state: r.state });
}

test("offline log within the time away replays without corrections", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  assert.equal(host.reset(key, "p1", c.reset()), null);
  host.drop(key);
  advance(10_000); // 10 s offline = 600 ticks
  const k2 = {};
  assert.equal(host.resume(k2, "p1", resumeMsg(c, 600)), null);
  for (let i = 0; i < 10; i++) assert.equal(host.input(k2, "p1", c.bundle(Array(60).fill(thrust))), null, `chunk ${i}`);
  assert.equal(host.stateOf(k2)!.px, c.s.px);
  assert.equal(host.stats().offlineTicks, 600);
  assert.equal(host.stats().corrections, 0);
});

test("offline log claiming more flight than the time away is cut and corrected", () => {
  const { host, key, advance } = setup();
  const c = client(initialFlightState());
  assert.equal(host.reset(key, "p1", c.reset()), null);
  host.drop(key);
  advance(2_000); // 2 s away, but the log claims 30 s of flight
  const k2 = {};
  host.resume(k2, "p1", resumeMsg(c, 1800));
  let fixes = 0;
  for (let i = 0; i < 30; i++) if (host.input(k2, "p1", c.bundle(Array(60).fill(thrust)))) fixes++;
  assert.ok(fixes >= 1);
  assert.ok(host.stats().droppedFrames > 1000);
});

test("last confirmed state survives a restart through the store", () => {
  const rows = new Map<string, { s: FlightSimState; at: number }>();
  const store = { load: (id: string) => rows.get(id) ?? null, save: (rs: Array<{ playerId: string; s: FlightSimState; at: number }>) => { for (const r of rs) rows.set(r.playerId, { s: { ...r.s }, at: r.at }); } };
  let now = T0;
  const a = new SimHost(() => WORLDS, () => now, store);
  const c = client(initialFlightState());
  a.reset({}, "p1", c.reset());
  a.flush();
  assert.ok(rows.has("p1"));
  // After a "deploy": a far-away resume is refused (it isn't a fresh spawn any more)
  now += 1000;
  const b = new SimHost(() => WORLDS, () => now, store);
  const far = encodeResume({ nextSeq: 0, frames: 0, state: { ...initialFlightState(), px: 5000 } });
  assert.ok(b.resume({}, "p1", far));
  assert.equal(b.stats().rejectedResets, 1);
});

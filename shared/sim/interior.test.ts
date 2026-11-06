/**
 * Tests for the deterministic interior movement step.
 * Run: node --import tsx --test shared/sim/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PHYSICS } from "../crdt-schema.js";
import {
  stepInterior, spawnInterior, collidersFor, NO_INPUT, INTERIOR_HALF_EXTENT, kickVelocity, kickedPosition, kickTarget, kickTrajectory, trajectoryAt, KICK_SETTLE_SEC,
  type InteriorInput, type InteriorState, type Box,
} from "./interior.js";

function run(s: InteriorState, input: InteriorInput, steps: number, boxes: Box[] = [], physics = DEFAULT_PHYSICS) {
  for (let i = 0; i < steps; i++) s = stepInterior(s, input, physics, boxes);
  return s;
}

const fwd: InteriorInput = { ...NO_INPUT, move: 1 };

test("idle player stays put on the ground", () => {
  const s = run(spawnInterior(), NO_INPUT, 120);
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
  assert.equal(s.z, 8);
  assert.ok(s.grounded);
});

test("W walks toward -Z at about walk speed", () => {
  const s = run(spawnInterior(), fwd, 60);
  assert.ok(s.z < 8 - 3 && s.z > 8 - 4.2, `z=${s.z}`);
  assert.ok(Math.abs(s.x) < 1e-9);
});

test("sprint is faster than walk", () => {
  const walk = run(spawnInterior(), fwd, 60);
  const sprint = run(spawnInterior(), { ...fwd, sprint: true }, 60);
  assert.ok(sprint.z < walk.z - 2);
});

test("turning keeps facing a unit vector; R turns right (toward +X)", () => {
  const s = run(spawnInterior(), { ...NO_INPUT, turn: 1 }, 30);
  assert.ok(Math.abs(s.fx * s.fx + s.fz * s.fz - 1) < 1e-12);
  assert.ok(s.fx > 0.5, `fx=${s.fx}`);
});

test("strafe right (F) moves +X when facing -Z", () => {
  const s = run(spawnInterior(), { ...NO_INPUT, strafe: 1 }, 30);
  assert.ok(s.x > 0.5);
});

test("jump leaves the ground and lands again", () => {
  let s = stepInterior(spawnInterior(), { ...NO_INPUT, jump: true }, DEFAULT_PHYSICS, []);
  assert.ok(!s.grounded && s.y > 0);
  s = run(s, NO_INPUT, 120);
  assert.equal(s.y, 0);
  assert.ok(s.grounded);
});

test("holding jump uses the jetpack, which runs out", () => {
  const tap = run(stepInterior(spawnInterior(), { ...NO_INPUT, jump: true }, DEFAULT_PHYSICS, []), NO_INPUT, 30);
  const held = run(spawnInterior(), { ...NO_INPUT, jump: true }, 30);
  assert.ok(held.y > tap.y);
  const long = run(spawnInterior(), { ...NO_INPUT, jump: true }, 100);
  assert.equal(long.fuel, 0);
});

test("a box blocks walking and can be stood on", () => {
  const boxes = collidersFor([{ id: "a", type: "cube", x: 0, y: 0.5, z: 5, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "", placedBy: "", placedAt: 0 }]);
  const blocked = run(spawnInterior(), fwd, 120, boxes);
  assert.ok(blocked.z >= 5.5 + 0.3 - 1e-9, `z=${blocked.z}`);

  const above: InteriorState = { ...spawnInterior(), z: 5, y: 3, grounded: false };
  const landed = run(above, NO_INPUT, 120, boxes);
  assert.equal(landed.y, 1);
  assert.ok(landed.grounded);
});

test("the edge of the interior stops the player", () => {
  const s = run(spawnInterior(), fwd, 60 * 20);
  assert.equal(s.z, -INTERIOR_HALF_EXTENT);
});

test("low gravity jumps higher", () => {
  const moon = { ...DEFAULT_PHYSICS, gravityY: -1.6 };
  let peakEarth = 0, peakMoon = 0;
  let e = stepInterior(spawnInterior(), { ...NO_INPUT, jump: true }, DEFAULT_PHYSICS, []);
  let m = stepInterior(spawnInterior(), { ...NO_INPUT, jump: true }, moon, []);
  for (let i = 0; i < 300; i++) {
    e = stepInterior(e, NO_INPUT, DEFAULT_PHYSICS, []); peakEarth = Math.max(peakEarth, e.y);
    m = stepInterior(m, NO_INPUT, moon, []); peakMoon = Math.max(peakMoon, m.y);
  }
  assert.ok(peakMoon > peakEarth * 3);
});

test("deterministic: the same inputs give bit-identical states", () => {
  const script = (i: number): InteriorInput => ({
    move: (i % 7) / 7, strafe: ((i % 5) - 2) / 2, turn: ((i % 11) - 5) / 5,
    look: 0, jump: i % 40 < 10, sprint: i % 3 === 0,
  });
  const go = () => { let s = spawnInterior(); for (let i = 0; i < 2000; i++) s = stepInterior(s, script(i), DEFAULT_PHYSICS, []); return s; };
  assert.deepEqual(go(), go());
});

test("a kicked object flies forward and settles on the ground, deterministically", () => {
  const o = { id: "k", type: "cube", x: 0, y: 0.5, z: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "", placedBy: "", placedAt: 0, kick: { ...kickVelocity(0, -1), t: 0 } };
  const end = kickedPosition(o, DEFAULT_PHYSICS, 10);
  assert.ok(end.z < -2, `z=${end.z}`);
  assert.equal(end.y, 0.5);
  assert.deepEqual(end, kickedPosition(o, DEFAULT_PHYSICS, 4));
});

// ── Kicks on real ground (2026-11-06: kicked things fell through voxel hills) ──
const cube = (over: Record<string, unknown> = {}) => ({ id: "k", type: "cube", x: 0, y: 0.5, z: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "", placedBy: "", placedAt: 0, ...over });
/** A plateau: ground 3 m high everywhere (cells j = 0, 1, 2 solid). */
const plateau = (x: number, y: number) => (void x, y < 3);

test("a kick on raised ground lands on the ground, never inside it", () => {
  const o = cube({ y: 3.5, kick: { ...kickVelocity(0, -1), t: 0 } });
  const tr = kickTrajectory(o, DEFAULT_PHYSICS, { solid: plateau });
  for (let i = 0; i <= tr.steps; i++) assert.ok(tr.points[i * 3 + 1] >= 3.5 - 1e-9, `step ${i} y=${tr.points[i * 3 + 1]}`);
  const end = kickedPosition(o, DEFAULT_PHYSICS, KICK_SETTLE_SEC, { solid: plateau });
  assert.equal(end.y, 3.5);
  assert.ok(end.z < -2, `z=${end.z}`);
});

test("a wall of terrain bounces a kick back instead of letting it through", () => {
  // Flat floor, and a 4 m wall filling every cell with z < -3
  const wall = (_x: number, y: number, z: number) => z < -3 && y < 4;
  const o = cube({ kick: { ...kickVelocity(0, -1), t: 0 } });
  const tr = kickTrajectory(o, DEFAULT_PHYSICS, { solid: wall });
  for (let i = 0; i <= tr.steps; i++) assert.ok(tr.points[i * 3 + 2] - 0.5 >= -3 - 0.011, `step ${i} z=${tr.points[i * 3 + 2]}`);
  const end = trajectoryAt(tr, KICK_SETTLE_SEC);
  assert.equal(end.y, 0.5);
});

test("a kick hops up a one-step ledge only if it is low, and rests on top", () => {
  // A 0.25 m lip is climbed (hop), but the ground here is whole cells, so use a box for it
  const o = cube({ kick: { ...kickVelocity(0, -1), t: 0 } });
  const lip = { minX: -5, maxX: 5, minY: 0, maxY: 0.25, minZ: -40, maxZ: -1 };
  const end = kickedPosition(o, DEFAULT_PHYSICS, KICK_SETTLE_SEC, { boxes: [lip] });
  assert.ok(end.z < -1.5, `z=${end.z}`);
  assert.ok(Math.abs(end.y - 0.75) < 1e-9, `y=${end.y}`);
});

test("kicked things stay inside a big world's own edge, not the old 40 m room", () => {
  const o = cube({ z: -18, kick: { ...kickVelocity(0, -1), t: 0 } });
  const small = kickedPosition(o, DEFAULT_PHYSICS, KICK_SETTLE_SEC);
  const big = kickedPosition(o, DEFAULT_PHYSICS, KICK_SETTLE_SEC, { halfExtent: 63.5 });
  assert.ok(small.z >= -19.5 + 0.5 - 1e-9, `z=${small.z}`);
  assert.ok(big.z < -20, `z=${big.z}`);
});

test("a trajectory is the same every time and smooth between steps", () => {
  const o = cube({ y: 3.5, kick: { vx: 3, vy: 4, vz: -6, t: 0 } });
  const a = kickTrajectory(o, DEFAULT_PHYSICS, { solid: plateau, halfExtent: 30 });
  const b = kickTrajectory(o, DEFAULT_PHYSICS, { solid: plateau, halfExtent: 30 });
  assert.deepEqual([...a.points], [...b.points]);
  const mid = trajectoryAt(a, 0.5 + 1 / 120);
  const lo = trajectoryAt(a, 0.5), hi = trajectoryAt(a, 0.5 + 1 / 60);
  assert.ok(mid.x > Math.min(lo.x, hi.x) - 1e-9 && mid.x < Math.max(lo.x, hi.x) + 1e-9);
});

test("kickTarget can aim at where a roaming thing is now, not its home", () => {
  const s = spawnInterior(); // z = 8, facing -Z
  const roamer = cube({ id: "r", z: 0 }); // home far away
  assert.equal(kickTarget(s, [roamer]), null);
  assert.equal(kickTarget(s, [roamer], () => ({ x: 0, y: 0.5, z: 7 }))?.id, "r");
});

test("kickTarget picks the object in front, not behind", () => {
  const mk = (id: string, z: number) => ({ id, type: "cube", x: 0, y: 0.5, z, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "", placedBy: "", placedAt: 0 });
  const s = spawnInterior(); // z = 8, facing -Z
  assert.equal(kickTarget(s, [mk("front", 7), mk("behind", 9)])?.id, "front");
  assert.equal(kickTarget(s, [mk("far", 2)]), null);
});

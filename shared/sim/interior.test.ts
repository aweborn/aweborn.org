/**
 * Tests for the deterministic interior movement step.
 * Run: node --import tsx --test shared/sim/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PHYSICS } from "../crdt-schema.js";
import {
  stepInterior, spawnInterior, collidersFor, NO_INPUT, INTERIOR_HALF_EXTENT,
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

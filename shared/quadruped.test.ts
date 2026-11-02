import { test } from "node:test";
import assert from "node:assert/strict";
import { findBodyPlan, partOf, trot, PART } from "./quadruped.ts";

/** A box-ish animal: a body block on four leg columns, head block up front (+z), points on a lattice. */
function animal(opts: { stagger?: number; legs?: number; belly?: boolean } = {}): number[] {
  const pts: number[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, step = 0.012) => {
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) for (let z = z0; z <= z1; z += step) pts.push(x, y, z);
  };
  const s = opts.stagger ?? 0;
  const legs: [number, number][] = [[0.15, 0.3 + s], [-0.15, 0.3 - s], [0.15, -0.3 - s], [-0.15, -0.3 + s]];
  for (const [x, z] of legs.slice(0, opts.legs ?? 4)) box(x - 0.04, x + 0.04, 0, 0.35, z - 0.04, z + 0.04);
  box(-0.2, 0.2, 0.35, 0.6, -0.4, 0.4); // body
  if (opts.belly) box(-0.12, 0.12, 0.22, 0.35, -0.15, 0.15); // a belly hanging below the hip line, between the legs
  box(-0.08, 0.08, 0.55, 0.85, 0.35, 0.55); // neck + head, front = +z
  return pts;
}

test("finds four legs, the hip line, the front and the neck of a standing animal", () => {
  const plan = findBodyPlan(animal())!;
  assert.ok(plan, "a plan");
  assert.equal(plan.axis, "z");
  assert.equal(plan.front, 1, "the head end rises higher");
  assert.ok(plan.legTop > 0.25 && plan.legTop < 0.45, `hip line ${plan.legTop}`);
  // FL/FR are the +z feet, BL/BR the -z ones
  assert.ok(plan.feet[0][0] > 0 && plan.feet[1][0] > 0 && plan.feet[2][0] < 0 && plan.feet[3][0] < 0);
  assert.equal(partOf(plan, 0.15, 0.05, 0.3), partOf(plan, 0.15, 0.1, 0.31), "one leg, one part");
  assert.notEqual(partOf(plan, 0.15, 0.05, 0.3), partOf(plan, -0.15, 0.05, 0.3), "left and right differ");
  assert.equal(partOf(plan, 0, 0.8, 0.5), PART.head);
  assert.equal(partOf(plan, 0, 0.45, -0.2), PART.body);
});

test("works mid-stride (staggered feet) and refuses things without four feet", () => {
  assert.ok(findBodyPlan(animal({ stagger: 0.08 })), "staggered stance");
  assert.equal(findBodyPlan(animal({ legs: 2 })), null, "two legs");
  assert.equal(findBodyPlan([0, 0, 0, 1, 1, 1]), null, "too few points");
});

test("a trot moves diagonal pairs together", () => {
  const [fl, fr, bl, br] = trot(Math.PI / 2, 0.5);
  assert.equal(fl, br);
  assert.equal(fr, bl);
  assert.equal(fl, -fr);
  assert.deepEqual(trot(1, 0), [0, -0, -0, 0]);
});

test("a belly hanging below the hip line stays body (it mustn't swing with the legs)", () => {
  const plan = findBodyPlan(animal({ belly: true }))!;
  assert.ok(plan);
  assert.equal(partOf(plan, 0, 0.25, 0), PART.body, "belly centre");
  assert.equal(partOf(plan, 0.1, 0.25, 0.1), PART.body, "belly edge");
  assert.notEqual(partOf(plan, 0.15, 0.1, 0.3), PART.body, "the leg itself still swings");
});

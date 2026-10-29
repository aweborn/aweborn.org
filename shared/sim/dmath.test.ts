/**
 * Tests for the deterministic math kernels.
 * Run: node --import tsx --test shared/sim/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dsin, dcos, datan, datan2, dacos,
  NEUTRAL_DRAG_PER_STEP, AUTO_ORIENT_PER_STEP, LEASH_EASE_PER_STEP,
} from "./dmath.js";

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1e-300, Math.abs(b), 1e-16);
}

test("dsin/dcos agree with Math.sin/cos to a few ulp over a wide range", () => {
  let worst = 0;
  for (let i = -20000; i <= 20000; i++) {
    const x = i * 0.0137 + (i % 7) * 1e-9;
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
  }
  assert.ok(worst < 5e-16, `worst abs error ${worst}`);
  // the sim's real range: half of (≤ 2.8 rad/s × 1/60 s)
  for (let i = 0; i <= 1000; i++) {
    const x = (i / 1000) * 0.03;
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) <= 2 ** -53 * 2, `sin ${x}`);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) <= 2 ** -53 * 2, `cos ${x}`);
  }
});

test("dsin keeps the sign of zero, NaN for non-finite", () => {
  assert.ok(Object.is(dsin(-0), -0));
  assert.ok(Object.is(dsin(0), 0));
  assert.equal(dcos(0), 1);
  assert.ok(Number.isNaN(dsin(Infinity)));
  assert.ok(Number.isNaN(dcos(NaN)));
});

test("datan / datan2 / dacos agree with Math to a few ulp", () => {
  let worst = 0;
  for (let i = -5000; i <= 5000; i++) {
    const v = i * 0.0021;
    worst = Math.max(worst, rel(datan(v), Math.atan(v)));
  }
  for (const v of [1e-12, 0.4375, 0.6875, 1.1875, 2.4375, 10, 1e6, 1e20]) worst = Math.max(worst, rel(datan(v), Math.atan(v)));
  assert.ok(worst < 1e-15, `atan worst rel ${worst}`);
  for (const [y, x] of [[1, 1], [1, -1], [-1, -1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0], [0.3, 0.9995]]) {
    assert.ok(Math.abs(datan2(y, x) - Math.atan2(y, x)) < 1e-15, `atan2(${y},${x})`);
  }
  for (let i = 0; i <= 2000; i++) {
    const d = -1 + i / 1000;
    assert.ok(Math.abs(dacos(d) - Math.acos(d)) < 1e-14, `acos ${d}`);
  }
});

test("frozen per-step constants match what they stand for", () => {
  assert.ok(Math.abs(NEUTRAL_DRAG_PER_STEP - Math.pow(1 - 0.15, 1 / 60)) < 1e-16);
  assert.ok(Math.abs(AUTO_ORIENT_PER_STEP - (1 - Math.pow(0.05, 1 / 60))) < 1e-16);
  assert.ok(Math.abs(LEASH_EASE_PER_STEP - Math.exp(-2.5 / 60)) < 1e-16);
});

test("golden values (must be identical in every engine)", () => {
  // Recorded on V8 (Node 2026-10-28). Pure + - * / sqrt, so any engine that
  // gets a different bit here is broken; scripts/sim-determinism checks browsers.
  const xs = [0.0125, 0.3, 1, 2.5, -4, 100.5];
  assert.deepEqual(xs.map((x) => [dsin(x), dcos(x), datan(x)]), [
    [0.012499674481709789, 0.9999218760172472, 0.012499349019361679],
    [0.29552020666133955, 0.955336489125606, 0.2914567944778671],
    [0.8414709848078965, 0.5403023058681398, 0.7853981633974483],
    [0.5984721441039564, -0.8011436155469337, 1.1902899496825317],
    [0.7568024953079282, -0.6536436208636119, -1.3258176636680326],
    [-0.030959966783271346, 0.9995206253283514, 1.5608464064020915],
  ]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { poolLevel, poolBand, LEVEL_DRAW_FLOOR } from "./mana-level.ts";

test("poolLevel: creative over 30-day draw, floored and clamped", () => {
  assert.equal(poolLevel(0, 1000), 0);
  assert.equal(poolLevel(-5, 1000), 0);
  assert.equal(poolLevel(LEVEL_DRAW_FLOOR / 2, 0), 0.5, "floor applies when spending is tiny");
  assert.equal(poolLevel(5000, 10_000), 0.5);
  assert.equal(poolLevel(50_000, 10_000), 1, "clamped");
  assert.equal(poolLevel(1500, Number.NaN), 0.5);
});

test("poolBand follows the ROADMAP thresholds", () => {
  assert.equal(poolBand(0), "critical");
  assert.equal(poolBand(0.049), "critical");
  assert.equal(poolBand(0.05), "low");
  assert.equal(poolBand(0.29), "low");
  assert.equal(poolBand(0.3), "medium");
  assert.equal(poolBand(0.79), "medium");
  assert.equal(poolBand(0.8), "high");
  assert.equal(poolBand(1), "high");
});

/**
 * Kick rules a non-owner's change must pass (the sync-service reverts the rest).
 * Run: node --import tsx --test shared/world-policy.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isKickChange, KICK_LIMITS } from "./world-policy.js";

const base = { id: "a1", type: "model", x: 0, y: 1, z: 0, placedBy: "alice" };
const kick = { vx: 7, vy: 3, vz: 0, t: 1 };

test("a kick may start from where a roaming creature really is (within a kick's reach)", () => {
  assert.equal(isKickChange(base, { ...base, x: 6, z: -4, kick }), true);
  assert.equal(isKickChange(base, { ...base, x: KICK_LIMITS.maxSettleDistance + 1, kick }), false);
});

test("moving something without kicking it is still refused", () => {
  assert.equal(isKickChange(base, { ...base, x: 3 }), false);
  assert.equal(isKickChange(base, { ...base, x: 3, kick: { vx: 400, vy: 0, vz: 0, t: 1 } }), false);
});

test("settling stays within reach of where the kick started", () => {
  const flying = { ...base, kick };
  assert.equal(isKickChange(flying, { ...base, x: 10 }), true);
  assert.equal(isKickChange(flying, { ...base, x: 500 }), false);
});

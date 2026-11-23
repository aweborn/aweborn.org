/**
 * Kick rules a non-owner's change must pass (the sync-service reverts the rest),
 * account-wide edit rights, and who may change a world's builders.
 * Run: node --import tsx --test shared/world-policy.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isKickChange, KICK_LIMITS, canEditObject, planBuilderChange, MAX_CO_CREATORS, judgeObjectChange, judgeMapChange, breaksStage } from "./world-policy.js";
import { stageOf } from "./game.js";

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

// ── Account-wide rights and builders (2026-11-07) ──

test("what one character placed, every character on the account may edit", () => {
  const obj = { ...base, placedBy: "alice-2" };
  assert.equal(canEditObject({ id: "alice-1", owner: false }, obj), false);
  assert.equal(canEditObject({ id: "alice-1", owner: false, mine: ["alice-1", "alice-2"] }, obj), true);
  assert.equal(canEditObject({ id: "bob", owner: false, mine: ["bob"] }, obj), false);
  assert.equal(canEditObject({ id: "alice-1", owner: false, mine: ["alice-1", ""] }, { ...base, placedBy: "" }), false);
});

const roles = { creator: "cara", coCreators: ["ben"] };

test("the creator and builders may add builders; others may not", () => {
  assert.deepEqual(planBuilderChange(roles, ["cara"], { add: "dee" }), { ok: true, next: ["ben", "dee"], changed: true });
  assert.deepEqual(planBuilderChange(roles, ["ben"], { add: "dee" }), { ok: true, next: ["ben", "dee"], changed: true });
  // A second character on the creator's account counts as the creator
  assert.equal(planBuilderChange(roles, ["cara-alt", "cara"], { add: "dee" }).ok, true);
  const no = planBuilderChange(roles, ["dee"], { add: "dee" });
  assert.equal(no.ok === false && no.error, "not_owner");
});

test("adding is idempotent, guests and the creator are never added, the list is capped", () => {
  assert.deepEqual(planBuilderChange(roles, ["cara"], { add: "ben" }), { ok: true, next: ["ben"], changed: false });
  assert.deepEqual(planBuilderChange(roles, ["cara"], { add: "cara" }), { ok: true, next: ["ben"], changed: false });
  assert.deepEqual(planBuilderChange(roles, ["cara", "cara-alt"], { add: "cara-alt" }), { ok: true, next: ["ben"], changed: false });
  const g = planBuilderChange(roles, ["cara"], { add: "guest-123" });
  assert.equal(g.ok === false && g.error, "bad_player");
  const full = { creator: "cara", coCreators: Array.from({ length: MAX_CO_CREATORS }, (_, i) => `p${i}`) };
  const f = planBuilderChange(full, ["cara"], { add: "dee" });
  assert.equal(f.ok === false && f.error, "full");
});

test("only the creator removes builders; a builder may step down", () => {
  const two = { creator: "cara", coCreators: ["ben", "dee"] };
  assert.deepEqual(planBuilderChange(two, ["cara"], { remove: "ben" }), { ok: true, next: ["dee"], changed: true });
  const r = planBuilderChange(two, ["ben"], { remove: "dee" });
  assert.equal(r.ok === false && r.error, "not_yours");
  assert.deepEqual(planBuilderChange(two, ["ben"], { remove: "ben" }), { ok: true, next: ["dee"], changed: true });
  assert.deepEqual(planBuilderChange(two, ["cara"], { remove: "zed" }), { ok: true, next: ["ben", "dee"], changed: false });
});

// ── The stage (Phase 10, Q5b) ──

const STAGE = stageOf({ arena: { at: [0, 0, 0], size: [20, 10, 20] } })!;
const thing = (x: number, extra: Record<string, unknown> = {}) => ({ id: "o", type: "block", x, y: 1, z: 0, scaleX: 1, scaleY: 1, scaleZ: 1, placedBy: "ben", ...extra });

test("on the stage, only the creator and builders place, edit, kick or remove", () => {
  const owner = { id: "cara", owner: true };
  const ben = { id: "ben", owner: false };
  const guest = { id: null, owner: false };
  // Placing
  assert.equal(judgeObjectChange(ben, undefined, thing(0), STAGE), "revert");
  assert.equal(judgeObjectChange(guest, undefined, thing(0, { placedBy: "guest-1" }), STAGE), "revert");
  assert.equal(judgeObjectChange(ben, undefined, thing(50), STAGE), "ok");
  assert.equal(judgeObjectChange(owner, undefined, thing(0, { placedBy: "cara" }), STAGE), "ok");
  // Editing or removing even your own thing there, or kicking anything there
  assert.equal(judgeObjectChange(ben, thing(0), thing(0, { material: "gold" }), STAGE), "revert");
  assert.equal(judgeObjectChange(ben, thing(0), undefined, STAGE), "revert");
  assert.equal(judgeObjectChange(ben, thing(0), thing(0, { kick: { vx: 1, vy: 1, vz: 0, t: 1 } }), STAGE), "revert");
  assert.equal(canEditObject(ben, thing(0), STAGE), false);
  assert.equal(canEditObject(ben, thing(50), STAGE), true);
  assert.equal(canEditObject(owner, thing(0), STAGE), true);
  // Carrying your own thing onto the stage
  assert.equal(judgeObjectChange(ben, thing(50), thing(0), STAGE), "revert");
  // Above the arena's ceiling is not the stage
  assert.equal(judgeObjectChange(ben, undefined, thing(0, { y: 30 }), STAGE), "ok");
  // No game, no stage
  assert.equal(judgeObjectChange(ben, undefined, thing(0), null), "ok");
  assert.equal(judgeObjectChange(ben, undefined, thing(0)), "ok");
});

test("a thing already in the air from a kick may land on the stage", () => {
  const flying = thing(-12, { kick: { vx: 5, vy: 3, vz: 0, t: 1 } });
  assert.equal(breaksStage(STAGE, flying, thing(-8)), false);
  assert.equal(judgeObjectChange({ id: "dee", owner: false }, flying, thing(-8), STAGE), "ok");
});

test("meta.game is server-written: not even the creator sets it through the world doc", () => {
  assert.equal(judgeMapChange({ id: "cara", owner: true }, "meta", "game", undefined, { template: "race" }), "revert");
  assert.equal(judgeMapChange({ id: "cara", owner: true }, "meta", "color", "#fff", "#000"), "ok");
});

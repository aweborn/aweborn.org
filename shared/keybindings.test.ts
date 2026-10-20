import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BINDING_DEFS, DEFAULT_BINDINGS, conflictsFor, rebind, resetBinding, resolveBindings,
  sanitizeOverrides, isBindable, actionsForCode, codeLabel,
} from "./keybindings.js";

test("defaults have no collisions within any context", () => {
  for (const d of BINDING_DEFS) {
    const code = DEFAULT_BINDINGS[d.id];
    assert.ok(code, `${d.id} has a default`);
    assert.deepEqual(conflictsFor(DEFAULT_BINDINGS, d.id, code!), [], `${d.id} on ${code}`);
  }
});

test("the same key may serve different contexts", () => {
  assert.equal(DEFAULT_BINDINGS.lockBehind, "KeyZ");
  assert.equal(DEFAULT_BINDINGS.heldRotateLeft, "KeyZ");
  assert.deepEqual(actionsForCode(DEFAULT_BINDINGS, "KeyZ", "world"), ["heldRotateLeft"]);
  assert.deepEqual(actionsForCode(DEFAULT_BINDINGS, "KeyZ", "universe"), ["lockBehind"]);
});

test("rebinding to a free key just moves it", () => {
  const r = rebind({}, "thrust", "ArrowUp");
  assert.equal(resolveBindings(r.overrides).thrust, "ArrowUp");
  assert.deepEqual(r.swapped, []);
  assert.deepEqual(r.overrides, { thrust: "ArrowUp" });
});

test("rebinding onto a used key swaps the two", () => {
  const r = rebind({}, "thrust", "KeyS"); // S is reverse
  const m = resolveBindings(r.overrides);
  assert.equal(m.thrust, "KeyS");
  assert.equal(m.reverse, "KeyW");
  assert.deepEqual(r.swapped, ["reverse"]);
});

test("a key used only in another context is not a clash", () => {
  const r = rebind({}, "carry", "KeyN"); // N is interact (both): clashes in world
  // interact would take G, but G is gravityToggle in the universe, so it ends up unbound
  assert.deepEqual(r.unbound, ["interact"]);
  assert.equal(resolveBindings(r.overrides).interact, null);
  const r2 = rebind({}, "carry", "KeyL"); // L is scan (universe only): no clash
  assert.deepEqual(r2.swapped, []);
  assert.equal(resolveBindings(r2.overrides).scan, "KeyL");
});

test("a displaced action that cannot take the old key is unbound, and reported", () => {
  // modTrail (universe) onto M (worldIndex, both). worldIndex would take U, which is free.
  const ok = rebind({}, "modTrail", "KeyM");
  assert.deepEqual(ok.swapped, ["worldIndex"]);
  // An action with no key has nothing to hand over.
  const none = rebind({ modTrail: null }, "modTrail", "KeyM");
  assert.deepEqual(none.unbound, ["worldIndex"]);
  assert.equal(resolveBindings(none.overrides).worldIndex, null);
});

test("unbinding and resetting", () => {
  const cleared = rebind({}, "scan", null);
  assert.equal(resolveBindings(cleared.overrides).scan, null);
  const back = resetBinding(cleared.overrides, "scan");
  assert.deepEqual(back.overrides, {});
});

test("overrides equal to the default are not stored", () => {
  assert.deepEqual(rebind({ thrust: "ArrowUp" }, "thrust", "KeyW").overrides, {});
});

test("reserved and browser keys cannot be bound", () => {
  for (const c of ["Escape", "Backquote", "Tab", "MetaLeft", "F5", "F12", "Unidentified", ""]) {
    assert.equal(isBindable(c), false, c);
  }
  assert.equal(isBindable("ShiftLeft"), true);
  assert.deepEqual(rebind({}, "thrust", "Escape").overrides, {});
});

test("sanitize drops junk and repairs collisions from old or hand-edited storage", () => {
  const s = sanitizeOverrides({ nope: "KeyA", thrust: 42, scan: "F5", reverse: "KeyW", warp: "KeyJ" });
  const m = resolveBindings(s);
  assert.equal(m.scan, "KeyL");
  // thrust and reverse both on W: exactly one keeps it
  assert.equal([m.thrust, m.reverse].filter((c) => c === "KeyW").length, 1);
  for (const d of BINDING_DEFS) if (m[d.id]) assert.deepEqual(conflictsFor({ ...m, [d.id]: null }, d.id, m[d.id]!), []);
  assert.deepEqual(sanitizeOverrides("garbage"), {});
});

test("labels", () => {
  assert.equal(codeLabel("KeyW"), "W");
  assert.equal(codeLabel("Digit3"), "3");
  assert.equal(codeLabel("ArrowLeft"), "←");
  assert.equal(codeLabel(null), "Unbound");
});

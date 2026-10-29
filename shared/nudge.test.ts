import { test } from "node:test";
import assert from "node:assert/strict";
import { findNudge, NUDGE_LIMITS } from "./nudge.js";

const obj = (x: number, y: number, z: number, placedBy: string, scale = 1) => ({ x, y, z, placedBy, scaleX: scale, scaleY: scale, scaleZ: scale });

test("another player's object on the same spot: moved to a free spot one spacing away", () => {
  const n = findNudge(obj(2, 1, 3, "b"), [obj(2.1, 1, 3, "a")]);
  assert.ok(n);
  assert.equal(Math.round(Math.hypot(n.x - 2, n.z - 3) * 100) / 100, 1);
});

test("own objects and neighbours are never nudged", () => {
  assert.equal(findNudge(obj(0, 0, 0, "a"), [obj(0, 0, 0, "a")]), null); // same player
  assert.equal(findNudge(obj(1, 0, 0, "b"), [obj(0, 0, 0, "a")]), null); // block next to it
  assert.equal(findNudge(obj(0, 1, 0, "b"), [obj(0, 0, 0, "a")]), null); // block on top of it
});

test("skips taken candidate spots and respects bigger footprints", () => {
  const others = [obj(0, 0, 0, "a", 2), obj(2, 0, 0, "a", 2)]; // spacing 2: the +x spot is taken
  const n = findNudge(obj(0, 0, 0, "b"), others);
  assert.ok(n);
  assert.ok(Math.hypot(n.x - 2, n.z) > 1.2, "not on the taken spot");
  assert.equal(Math.round(Math.hypot(n.x, n.z) * 100) / 100, 2);
});

test("crowded all round or a huge world: left where it was placed", () => {
  const ring: ReturnType<typeof obj>[] = [obj(0, 0, 0, "a")];
  for (let r = 1; r <= NUDGE_LIMITS.rings; r++)
    for (let i = 0; i < 8; i++) ring.push(obj(Math.cos((i / 8) * Math.PI * 2) * r, 0, Math.sin((i / 8) * Math.PI * 2) * r, "a"));
  assert.equal(findNudge(obj(0, 0, 0, "b"), ring), null);
  const many = Array.from({ length: NUDGE_LIMITS.maxScan + 1 }, () => obj(0, 0, 0, "a"));
  assert.equal(findNudge(obj(0, 0, 0, "b"), many), null);
});

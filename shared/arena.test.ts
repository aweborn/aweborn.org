import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGame, stageOf, type Game } from "./game.js";
import { ARENA_OBJECTS_MAX, arenaView, cellLocked, snapshotArena, terrainCellMiddle, terrainLock, type ArenaObject } from "./arena.js";

function game(): Game {
  const p = parseGame({ template: "race", version: 3, arena: { at: [0, 0, -8], size: [20, 10, 20] }, zones: [] });
  assert.ok(p.ok);
  return p.value;
}
const obj = (id: string, x: number, y: number, z: number, extra: Record<string, unknown> = {}) => ({ id, type: "block", x, y, z, rotX: 0, rotY: 0.5, rotZ: 0, scaleX: 2, scaleY: 1, scaleZ: 1, material: "stone", color: "#ff0000", placedBy: "char-a", placedAt: 5, prompt: "a red block", ...extra });

test("the arena copy holds what is on the stage, with ids and looks, and nothing personal", () => {
  const g = game();
  const copy = snapshotArena([
    obj("in", 1, 1, -8),
    obj("out", 40, 1, -8),
    obj("npc", 2, 1, -8, { mind: { name: "Sage", persona: "secret" }, life: { mode: "alive", pace: 1, roam: 3 } }),
    obj("fly", 3, 1, -8, { kick: { vx: 1, vy: 1, vz: 1, t: 1, by: "char-b" }, carry: { by: "char-b", t: 1 } }),
    obj("sign", 4, 1, -8, { type: "sign", text: "Welcome" }),
    { id: "bad", type: "block", x: "1", y: 1, z: 1 },
  ], g);
  assert.deepEqual(copy.objects.map((o) => o.id), ["in", "npc", "fly", "sign"]);
  assert.equal(copy.cut, undefined);
  const first = copy.objects[0];
  assert.deepEqual(first, { id: "in", type: "block", x: 1, y: 1, z: -8, rotX: 0, rotY: 0.5, rotZ: 0, scaleX: 2, scaleY: 1, scaleZ: 1, material: "stone", color: "#ff0000" });
  const npc = copy.objects[1];
  assert.equal(npc.mind, undefined);
  assert.deepEqual(npc.life, { mode: "alive", pace: 1, roam: 3 });
  assert.equal(copy.objects[2].kick, undefined);
  assert.equal(copy.objects[2].carry, undefined);
  assert.equal(copy.objects[3].text, "Welcome");
  assert.ok(!JSON.stringify(copy).includes("char-a") && !JSON.stringify(copy).includes("secret") && !JSON.stringify(copy).includes("a red block"));
});

test("past the cap the objects farthest from the arena's middle are left out and counted", () => {
  const g = game();
  const many = Array.from({ length: ARENA_OBJECTS_MAX + 7 }, (_, i) => obj(`o${i}`, (i % 19) - 9, 1, -8 + ((i * 7) % 19) - 9));
  many.push(obj("middle", 0, 0.5, -8));
  const copy = snapshotArena(many, g);
  assert.equal(copy.objects.length, ARENA_OBJECTS_MAX);
  assert.equal(copy.cut, 8);
  assert.equal(copy.objects[0].id, "middle");
  // The same stage listed in another order gives the same copy
  assert.deepEqual(snapshotArena([...many].reverse(), g), copy);
  assert.deepEqual(snapshotArena(many, { ...g, arena: null }), { objects: [] });
});

test("the view: the copy on the stage, the live world everywhere else", () => {
  const g = game();
  const stage = stageOf(g)!;
  const at = (id: string, x: number, z: number, color = "red") => ({ id, x, y: 1, z, color });
  const copy: ArenaObject[] = [{ id: "wall", type: "block", x: 1, y: 1, z: -8, color: "red" }, { id: "gone", type: "block", x: 2, y: 1, z: -8, color: "red" }, { id: "moved-off", type: "block", x: 3, y: 1, z: -8, color: "red" }];
  const live = new Map([
    ["wall", at("wall", 5, -8, "blue")], // moved and recoloured since the start
    ["moved-off", at("moved-off", 50, 0)], // carried off the stage since
    ["added", at("added", 0, -8)], // put on the stage since
    ["lobby-thing", at("lobby-thing", 0, 14)], // outside the stage: live
  ]);
  const view = arenaView(live, stage, copy, (o) => ({ id: o.id, x: o.x, y: o.y, z: o.z, color: String(o.color) }));
  assert.deepEqual([...view.keys()].sort(), ["gone", "lobby-thing", "moved-off", "wall"]);
  assert.deepEqual(view.get("wall"), { id: "wall", x: 1, y: 1, z: -8, color: "red" });
  assert.equal(view.get("moved-off")!.x, 3);
  assert.equal(view.get("lobby-thing"), live.get("lobby-thing"));
});

test("the terrain lock covers the arena's columns, from the bottom up to its top", () => {
  const g = game(); // x -10..10, y 0..10, z -18..2
  const lock = terrainLock(g)!;
  const size: [number, number, number] = [64, 32, 64];
  assert.deepEqual(terrainCellMiddle(size, 32, 3, 32), [0.5, 3.5, 0.5]);
  assert.equal(cellLocked(lock, size, 32, 3, 30), true); // inside
  assert.equal(cellLocked(lock, size, 32, 1, 30), true); // under the floor
  assert.equal(cellLocked(lock, size, 32, 14, 30), false); // above the top
  assert.equal(cellLocked(lock, size, 42, 3, 30), true); // the margin
  assert.equal(cellLocked(lock, size, 44, 3, 30), false); // beside it
  assert.equal(cellLocked(lock, size, 32, 3, 40), false); // the lobby side
  assert.equal(cellLocked(null, size, 32, 3, 30), false);
  assert.equal(terrainLock({ ...g, arena: null }), null);
});

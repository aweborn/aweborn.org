/**
 * One growing plan per world (2026-11-08): plans only add; undo is the only way out;
 * someone else's additions are never lost; the planner's view is anonymous.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlueprintAsset, BlueprintDraft, BlueprintFeature } from "./blueprint.js";
import { editableLayer, featureKey, mergeWorldPlan, othersPlanned, worldContextText, WORLD_PLAN_LIMITS, type Owner, type WorldNow } from "./world-plan.js";

const P = "plan-1";
const grass = { id: "grass", name: "Grass", color: "#55aa55", surface: "smooth" as const };
const stone = { id: "stone", name: "Stone", color: "#888888" };
const hill: BlueprintFeature = { type: "hill", at: [100, 0, 100], radius: 20, height: 6, block: "grass" };
const pond: BlueprintFeature = { type: "pond", at: [200, 0, 200], radius: 10, height: 2, block: "stone" };
const isle: BlueprintFeature = { type: "floating-island", at: [160, 10, 160], radius: 8, block: "stone" };
const asset = (key: string, prompt = `a ${key}`): BlueprintAsset => ({ key, kind: "model", prompt, quality: "quick", at: [1, 0, 1] });
const music: BlueprintAsset = { key: "world-music", kind: "music", prompt: "slow piano", quality: "quick" };

function plan(assets: BlueprintAsset[], features: BlueprintFeature[] = [hill], blocks = [grass, stone], size: [number, number, number] = [320, 16, 320]): BlueprintDraft {
  return {
    name: "The Drift",
    style: { artDirection: "misty", palette: [], lighting: "dusk" },
    terrain: { kind: "voxel", size, seed: 7, blocks, features },
    assets: [...assets, music],
  };
}
const world = (placed: string[] = [], terrain: BlueprintDraft["terrain"] | null = null): WorldNow =>
  ({ terrain, placedKeys: new Set(placed.map((k) => `${P}:${k}`)) });
const keys = (d: BlueprintDraft) => d.assets.map((a) => a.key);
/** Who added what: keys/features listed as theirs are "other"; anything else in `mine` is "me"; the rest is new. */
function owners(mine: string[] = [], theirs: string[] = [], myF: BlueprintFeature[] = [], theirF: BlueprintFeature[] = []) {
  return {
    asset: (k: string): Owner => (theirs.includes(k) ? "other" : mine.includes(k) ? "me" : null),
    feature: (fk: string): Owner => (theirF.map(featureKey).includes(fk) ? "other" : myF.map(featureKey).includes(fk) ? "me" : null),
  };
}
const merge = (a: Parameters<typeof mergeWorldPlan>[0]) => mergeWorldPlan(a).plan;

test("the planner only edits what isn't made yet", () => {
  const now = plan([asset("shrine"), asset("roots")], [hill, pond]);
  const w = world(["roots"], now.terrain && { ...now.terrain, features: [hill] });
  const layer = editableLayer(now, P, w);
  assert.deepEqual(keys(layer), ["shrine", "world-music"]);
  assert.deepEqual(layer.terrain.features, [pond]);
});

test("a turn adds; made things and the ground's features stay even if the planner leaves them out", () => {
  const now = plan([asset("shrine"), asset("roots")]);
  const w = world(["roots"], now.terrain);
  const seen = editableLayer(now, P, w);
  const next = { ...plan([asset("shrine"), asset("lantern")], [isle]) }; // forgot hill (in the ground) and roots (made)
  const out = merge({ now, seen, next, planId: P, world: w, owner: owners(["shrine", "roots"]) });
  assert.deepEqual(keys(out).sort(), ["lantern", "roots", "shrine", "world-music"]);
  assert.equal(out.assets[0].key, "roots"); // made things first, as they were
  assert.deepEqual(out.terrain.features, [hill, isle]);
});

test("a planned (not made) item can be dropped or reworded by the planner", () => {
  const now = plan([asset("shrine"), asset("stones")]);
  const w = world([], null);
  const seen = editableLayer(now, P, w);
  const out = merge({ now, seen, next: plan([asset("shrine", "a taller shrine")]), planId: P, world: w, owner: owners(["shrine", "stones"]) });
  assert.deepEqual(keys(out), ["shrine", "world-music"]);
  assert.equal(out.assets[0].prompt, "a taller shrine");
});

test("someone else's addition made meanwhile is never lost", () => {
  const before = plan([asset("shrine")]);
  const w = world([], before.terrain);
  const seenByMe = editableLayer(before, P, w);
  // Another player's turn landed first: added a bridge and an island
  const now = { ...plan([asset("shrine"), asset("bridge")], [hill, isle]) };
  const out = merge({ now, seen: seenByMe, next: plan([asset("shrine"), asset("lantern")], [hill]), planId: P, world: w, owner: owners(["shrine"], ["bridge"], [hill], [isle]) });
  assert.deepEqual(keys(out).sort(), ["bridge", "lantern", "shrine", "world-music"]);
  assert.ok(out.terrain.features.some((f) => f.type === "floating-island"));
});

test("a new item reusing a made item's key is renamed; an echo of it is dropped", () => {
  const now = plan([asset("shrine")]);
  const w = world(["shrine"], now.terrain);
  const seen = editableLayer(now, P, w);
  const out = merge({ now, seen, next: plan([asset("shrine"), asset("shrine-x")].map((a, i) => (i === 1 ? { ...a, key: "shrine", prompt: "a second shrine" } : a))), planId: P, world: w, owner: owners(["shrine"]) });
  assert.deepEqual(keys(out).sort(), ["shrine", "shrine-2", "world-music"]);
  assert.equal(out.assets.find((a) => a.key === "shrine-2")!.prompt, "a second shrine");
});

test("undo takes out only your own additions, even after you've seen others' (made things stay)", () => {
  const v1 = plan([asset("shrine")], [hill]);
  const now = plan([asset("shrine"), asset("lantern"), asset("bridge")], [hill, pond, isle]); // + someone's bridge and island
  const w = world(["shrine"], { ...now.terrain, features: [hill, pond] });
  const out = merge({ now, seen: now, next: v1, planId: P, world: w, undo: true, owner: owners(["shrine", "lantern"], ["bridge"], [hill, pond], [isle]) });
  assert.deepEqual(keys(out).sort(), ["bridge", "shrine", "world-music"]);
  assert.deepEqual(out.terrain.features.map((f) => f.type).sort(), ["floating-island", "hill"]); // pond undone even though it's in the ground
});

test("the ground's size and seed are fixed once it's in the world; materials only grow", () => {
  const now = plan([], [hill], [grass, stone]);
  const next = plan([], [hill], [{ ...grass, color: "#000000" }, { id: "sand", name: "Sand", color: "#eedd99" }], [64, 8, 64]);
  const before = merge({ now, seen: now, next, planId: P, world: world([], null), owner: owners() });
  assert.deepEqual(before.terrain.size, [64, 8, 64]); // not in the world yet: still changeable
  const after = merge({ now, seen: now, next, planId: P, world: world([], now.terrain), owner: owners() });
  assert.deepEqual(after.terrain.size, [320, 16, 320]);
  assert.deepEqual(after.terrain.blocks.map((b) => b.id), ["grass", "stone", "sand"]);
  assert.equal(after.terrain.blocks[0].color, "#55aa55"); // the ground's material wins
});

test("caps hold: features and assets", () => {
  const many = Array.from({ length: WORLD_PLAN_LIMITS.features + 10 }, (_, i): BlueprintFeature => ({ ...hill, at: [i, 0, i] }));
  const out = merge({ now: null, seen: null, next: plan([], many), planId: P, world: world(), owner: owners() });
  assert.equal(out.terrain.features.length, WORLD_PLAN_LIMITS.features);
  assert.equal(out.assets.filter((a) => a.kind === "music").length, 1);
});

test("the planner's view of the world names no one", () => {
  const text = worldContextText({
    ground: plan([], [hill]).terrain,
    objects: [{ type: "model", words: "a mossy shrine", at: [10, 20] }, { type: "block", at: [1, 1] }, { type: "block", at: [2, 2] }],
    history: [{ who: "player", text: "add a shrine" }, { who: "planner", text: "A shrine on the hill?" }],
  });
  assert.match(text, /model at \(10, 20\): a mossy shrine/);
  assert.match(text, /2 blocks/);
  assert.match(text, /player: add a shrine/);
  assert.doesNotMatch(text, /placedBy|playerId|research/i);
});

test("others' planned items can't be reworked or dropped by your planner; they're shown read-only", () => {
  const now = plan([asset("shrine"), asset("bridge")]);
  const w = world([], now.terrain);
  const own = owners(["shrine"], ["bridge"]);
  const seen = editableLayer(now, P, w, own);
  assert.deepEqual(keys(seen), ["shrine", "world-music"]);
  assert.deepEqual(othersPlanned(now, P, w, own).assets.map((a) => a.key), ["bridge"]);
  // The planner leaves the bridge out and rewrites a "bridge" of its own: theirs stays, yours is new
  const out = merge({ now, seen, next: plan([asset("shrine"), asset("bridge", "a rope bridge")]), planId: P, world: w, owner: own });
  assert.deepEqual(keys(out).sort(), ["bridge", "bridge-2", "shrine", "world-music"]);
  assert.equal(out.assets.find((a) => a.key === "bridge")!.prompt, "a bridge");
});

test("an undo never brings back what someone else added and later removed", () => {
  const restored = plan([asset("shrine"), asset("old-bridge")], [hill, isle]);
  const now = plan([asset("shrine")], [hill]);
  const out = merge({ now, seen: now, next: restored, planId: P, world: world([], now.terrain), undo: true, owner: owners(["shrine"], ["old-bridge"], [hill], [isle]) });
  assert.deepEqual(keys(out), ["shrine", "world-music"]);
  assert.deepEqual(out.terrain.features, [hill]);
});

test("what a change added is reported, so it's recorded as yours", () => {
  const r = mergeWorldPlan({ now: null, seen: null, next: plan([asset("shrine")], [hill]), planId: P, world: world(), owner: owners() });
  assert.deepEqual(r.added.assets, ["shrine", "world-music"]);
  assert.deepEqual(r.added.features, [featureKey(hill)]);
});

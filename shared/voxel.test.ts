import { test } from "node:test";
import assert from "node:assert/strict";
import { generateVoxels, voxelColliders, visibleCells, cellAt } from "./voxel.js";
import { parseDraft, type BlueprintDraft } from "./blueprint.js";
import { stepInterior, spawnInterior, NO_INPUT, type InteriorState } from "./sim/interior.js";

const raw = {
  name: "Test",
  style: { artDirection: "soft low-poly dusk", palette: ["#223344"], lighting: "dusk" },
  terrain: {
    kind: "voxel", size: [24, 12, 24], seed: 42,
    blocks: [{ id: "grass", name: "Grass", color: "#4a7" }, { id: "stone", name: "Stone", color: "#888888" }, { id: "water", name: "Water", color: "#3366aa" }],
    features: [
      { type: "hill", at: [6, 0, 6], radius: 5, height: 4, block: "grass" },
      { type: "pond", at: [16, 0, 16], radius: 4, height: 2, block: "water" },
      { type: "floating-island", at: [12, 9, 12], radius: 3, height: 2, block: "stone" },
    ],
  },
  assets: [],
};
const draft = (): BlueprintDraft => {
  const p = parseDraft(raw);
  assert.ok(p.ok);
  return p.value;
};
const physics = { gravityX: 0, gravityY: -20, gravityZ: 0, friction: 0.3, airResistance: 0.01, waterLevel: -1 } as never;

test("same blueprint → identical grid", () => {
  const a = generateVoxels(draft().terrain);
  const b = generateVoxels(draft().terrain);
  assert.deepEqual(a.cells, b.cells);
  assert.ok(a.cells.some((v) => v !== 0));
});

test("seed changes the grid", () => {
  const d = draft();
  const a = generateVoxels(d.terrain);
  const b = generateVoxels({ ...d.terrain, seed: 7 });
  assert.notDeepEqual(a.cells, b.cells);
});

test("hill rises, pond holds water, island floats", () => {
  const g = generateVoxels(draft().terrain);
  assert.ok(cellAt(g, 6, 3, 6) !== 0, "hill top");
  const water = g.blocks.findIndex((b) => b.id === "water") + 1;
  assert.ok(g.cells.includes(water), "pond water");
  assert.ok(cellAt(g, 12, 9, 12) !== 0 && cellAt(g, 12, 5, 12) === 0, "floating island with air under it");
});

test("colliders cover every solid cell and skip water", () => {
  const g = generateVoxels(draft().terrain);
  const boxes = voxelColliders(g);
  const [sx, sy, sz] = g.size;
  let solid = 0;
  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
    const v = cellAt(g, i, j, k);
    if (v && !g.liquid[v - 1]) solid++;
  }
  const vol = boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ), 0);
  assert.equal(vol, solid);
  assert.ok(boxes.length < solid, "runs are merged");
  assert.ok(visibleCells(g).length < solid + 200);
});

test("player walks up one-voxel steps instead of stopping", () => {
  const box = { minX: -1, maxX: 1, minY: 0, maxY: 1, minZ: -3, maxZ: -1, step: true };
  let s: InteriorState = { ...spawnInterior(), x: 0, z: 0, fx: 0, fz: -1 };
  for (let n = 0; n < 60; n++) s = stepInterior(s, { ...NO_INPUT, move: 1 }, physics, [box]);
  assert.ok(s.z < -1.2, `moved onto the step (z=${s.z.toFixed(2)})`);
  assert.ok(Math.abs(s.y - 1) < 0.05, `standing on it (y=${s.y.toFixed(2)})`);
  // Non-terrain boxes still block
  let t: InteriorState = { ...spawnInterior(), x: 0, z: 0, fx: 0, fz: -1 };
  for (let n = 0; n < 60; n++) t = stepInterior(t, { ...NO_INPUT, move: 1 }, physics, [{ ...box, step: false }]);
  assert.ok(t.z > -1, "blocked");
});

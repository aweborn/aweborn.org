import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEditKey, editKey, validEditValue, chunkCell, withEdits, edgeNeighbours, terrainShapeKey } from "./terrain-edits.ts";
import { generateVoxels, cellAt, CHUNK } from "./voxel.ts";
import type { BlueprintDraft } from "./blueprint.ts";

const terrain: BlueprintDraft["terrain"] = { kind: "voxel", size: [70, 16, 40], seed: 3, blocks: [{ id: "grass", name: "grass", color: "#33aa33" }, { id: "stone", name: "stone", color: "#888888" }], features: [] };

test("edit keys: round trip, floor and bounds refused", () => {
  assert.deepEqual(parseEditKey(editKey(5, 2, 9)), [5, 2, 9]);
  assert.equal(parseEditKey("5,0,9"), null); // the floor never changes
  assert.equal(parseEditKey("5,40,9"), null);
  assert.equal(parseEditKey("320,2,9"), null);
  assert.equal(parseEditKey("-1,2,9"), null);
  assert.equal(parseEditKey("a,b,c"), null);
  assert.ok(validEditValue(0) && validEditValue(12));
  assert.ok(!validEditValue(13) && !validEditValue(1.5) && !validEditValue("1"));
});

test("chunkCell indexes match the generator's chunk grids, including the narrow last chunk", () => {
  for (const [gi, j, gk] of [[3, 1, 4], [33, 2, 5], [69, 2, 39], [64, 1, 32]] as const) {
    const c = chunkCell(gi, j, gk, terrain.size);
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    const g = generateVoxels(terrain, { x0, z0, w: Math.min(CHUNK, 70 - x0), d: Math.min(CHUNK, 40 - z0) });
    assert.equal(g.cells[c.idx], cellAt(g, gi - x0, j, gk - z0), `${gi},${j},${gk}`);
    const dug = withEdits(g, new Map([[c.idx, 0]]));
    assert.equal(cellAt(dug, gi - x0, j, gk - z0), 0);
    assert.notEqual(g.cells, dug.cells); // the cached base grid is never touched
  }
});

test("withEdits turns values past the blueprint's blocks into air", () => {
  const g = generateVoxels(terrain, { x0: 0, z0: 0, w: 32, d: 32 });
  const c = chunkCell(1, 5, 1, terrain.size);
  assert.equal(withEdits(g, new Map([[c.idx, 9]])).cells[c.idx], 0);
  assert.equal(withEdits(g, new Map([[c.idx, 2]])).cells[c.idx], 2);
});

test("edgeNeighbours: edge cells touch the next chunk, the last chunk's edge uses its own width", () => {
  assert.deepEqual(edgeNeighbours(0, 5, terrain.size), [[-1, 0]]);
  assert.deepEqual(edgeNeighbours(31, 31, terrain.size), [[1, 0], [0, 1]]);
  assert.deepEqual(edgeNeighbours(69, 39, terrain.size), [[1, 0], [0, 1]]);
  assert.deepEqual(edgeNeighbours(10, 10, terrain.size), []);
});

test("edgeNeighbours with a smooth reach: two cells in, and the diagonal chunk at a corner", () => {
  assert.deepEqual(edgeNeighbours(1, 10, terrain.size, 2), [[-1, 0]]);
  assert.deepEqual(edgeNeighbours(2, 10, terrain.size, 2), []);
  assert.deepEqual(edgeNeighbours(30, 1, terrain.size, 2), [[1, 0], [0, -1], [1, -1]]);
  assert.deepEqual(edgeNeighbours(64, 10, terrain.size, 2), [[-1, 0]]); // last chunk: 6 wide
  assert.deepEqual(edgeNeighbours(68, 10, terrain.size, 2), [[1, 0]]);
});

test("terrainShapeKey ignores only how blocks are drawn", () => {
  const smooth = { ...terrain, blocks: terrain.blocks.map((b, n) => (n === 0 ? { ...b, surface: "smooth" as const } : b)) };
  assert.equal(terrainShapeKey(smooth), terrainShapeKey(terrain));
  assert.notEqual(terrainShapeKey({ ...terrain, seed: 4 }), terrainShapeKey(terrain));
  assert.notEqual(terrainShapeKey({ ...terrain, blocks: [...terrain.blocks].reverse() }), terrainShapeKey(terrain));
});

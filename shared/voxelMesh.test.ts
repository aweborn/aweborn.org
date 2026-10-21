import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChunkMesh, AIR, SOLID, LIQUID_HEIGHT, type CellKind } from "./voxelMesh.js";
import { generateVoxels, visibleCells, type VoxelGrid } from "./voxel.js";
import { parseDraft } from "./blueprint.js";

const grey = () => [0.5, 0.5, 0.5] as [number, number, number];
const air = (): CellKind => AIR;

function grid(size: [number, number, number], fill: (i: number, j: number, k: number) => number): VoxelGrid {
  const [sx, sy, sz] = size;
  const cells = new Uint8Array(sx * sy * sz);
  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) cells[i + sx * (k + sz * j)] = fill(i, j, k);
  return {
    size, origin: [0, 0], world: [sx, sz], cells,
    blocks: [{ id: "stone", name: "Stone", color: "#888888" }, { id: "water", name: "Water", color: "#3366aa" }],
    liquid: [false, true],
  };
}

test("a lone block on the floor shows 5 faces (never its underside)", () => {
  const m = buildChunkMesh(grid([3, 3, 3], (i, j, k) => (i === 1 && j === 0 && k === 1 ? 1 : 0)), false, air, grey);
  assert.equal(m.faces, 5);
  assert.equal(m.indices.length, 30);
});

test("two touching blocks hide the faces between them", () => {
  const m = buildChunkMesh(grid([3, 3, 3], (i, j, k) => (j === 1 && k === 1 && i < 2 ? 1 : 0)), false, air, grey);
  assert.equal(m.faces, 10); // 2 × 6 − 2 shared
});

test("winding matches the normal (back-face culling keeps the outside)", () => {
  const m = buildChunkMesh(grid([3, 3, 3], (i, j, k) => (i === 1 && j === 1 && k === 1 ? 1 : 0)), false, air, grey);
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = (n: number) => [0, 1, 2].map((a) => m.positions[m.indices[t + n] * 3 + a]);
    const [a, b, c] = [p(0), p(1), p(2)];
    const u = b.map((x, q) => x - a[q]), v = c.map((x, q) => x - a[q]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = [0, 1, 2].map((q) => m.normals[m.indices[t] * 3 + q]);
    assert.ok(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0, `triangle ${t / 3} faces inward`);
  }
});

test("a neighbouring chunk's block hides the seam face", () => {
  const g = grid([2, 2, 2], (i, j, k) => (i === 1 && j === 0 && k === 0 ? 1 : 0));
  const open = buildChunkMesh(g, false, air, grey).faces;
  const sealed = buildChunkMesh(g, false, (i) => (i === 2 ? SOLID : AIR), grey).faces;
  assert.equal(open - sealed, 1);
});

test("solid shows through water; water shows only toward air, at liquid height", () => {
  // stone at i=0, water at i=1, both on the floor
  const g = grid([2, 1, 1], (i) => (i === 0 ? 1 : 2));
  const solid = buildChunkMesh(g, false, air, grey);
  assert.equal(solid.faces, 5); // +x face toward water is kept
  const water = buildChunkMesh(g, true, air, grey);
  assert.equal(water.faces, 4); // not toward the stone, not the underside
  const top = Math.max(...water.positions.filter((_, n) => n % 3 === 1));
  assert.equal(Math.fround(top), Math.fround(LIQUID_HEIGHT));
});

test("real terrain: far fewer triangles than full instanced cubes", () => {
  const p = parseDraft({
    name: "T", style: { artDirection: "x", palette: ["#223344"], lighting: "dusk" },
    terrain: {
      kind: "voxel", size: [32, 16, 32], seed: 3,
      blocks: [{ id: "grass", name: "Grass", color: "#44aa77" }, { id: "water", name: "Water", color: "#3366aa" }],
      features: [{ type: "hill", at: [16, 0, 16], radius: 12, height: 10, block: "grass" }, { type: "pond", at: [4, 0, 4], radius: 3, height: 2, block: "water" }],
    },
    assets: [],
  });
  assert.ok(p.ok);
  const g = generateVoxels(p.value.terrain);
  const cubes = visibleCells(g).length;
  const faces = buildChunkMesh(g, false, air, grey).faces + buildChunkMesh(g, true, air, grey).faces;
  assert.ok(faces * 2 < (cubes * 12) / 3, `faces ${faces} vs cubes ${cubes}`);
});

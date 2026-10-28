import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSmoothMesh, hasSmoothBlocks } from "./surfaceNets.js";
import { buildChunkMesh, kindOf, AIR, SMOOTH, SOLID, type CellKind } from "./voxelMesh.js";
import type { VoxelGrid } from "./voxel.js";

const grey = () => [0.5, 0.5, 0.5] as [number, number, number];
const none = () => 0;
const air = (): CellKind => AIR;

/** blocks: 1 = smooth grass, 2 = block stone, 3 = water */
function grid(size: [number, number, number], fill: (i: number, j: number, k: number) => number): VoxelGrid {
  const [sx, sy, sz] = size;
  const cells = new Uint8Array(sx * sy * sz);
  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) cells[i + sx * (k + sz * j)] = fill(i, j, k);
  return {
    size, origin: [0, 0], world: [sx, sz], cells,
    blocks: [
      { id: "grass", name: "Grass", color: "#44aa77", surface: "smooth" },
      { id: "stone", name: "Stone", color: "#888888" },
      { id: "water", name: "Water", color: "#3366aa", surface: "smooth" },
    ],
    liquid: [false, false, true],
  };
}

function eachTriangle(m: ReturnType<typeof buildSmoothMesh>, fn: (a: number[], b: number[], c: number[], n: number[]) => void) {
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = (q: number) => [0, 1, 2].map((a) => m.positions[m.indices[t + q] * 3 + a]);
    const n = [0, 1, 2].map((a) => (m.normals[m.indices[t] * 3 + a] + m.normals[m.indices[t + 1] * 3 + a] + m.normals[m.indices[t + 2] * 3 + a]) / 3);
    fn(p(0), p(1), p(2), n);
  }
}

test("only blocks marked smooth (and never liquids) count", () => {
  const g = grid([2, 2, 2], () => 0);
  assert.equal(hasSmoothBlocks(g), true);
  assert.equal(kindOf(g, 1), SMOOTH);
  assert.equal(kindOf(g, 2), SOLID);
  g.blocks = [g.blocks[1], g.blocks[2]];
  g.liquid = [false, true];
  assert.equal(hasSmoothBlocks(g), false);
  assert.equal(buildSmoothMesh(g, none, grey).faces, 0);
});

test("flat smooth ground keeps its top at the block top", () => {
  const T = 3; // cells j = 0…3 are ground → top at y = 4
  const g = grid([8, 8, 8], (_i, j) => (j <= T ? 1 : 0));
  const m = buildSmoothMesh(g, (_i, j) => (j <= T ? 1 : 0), grey); // the ground continues past the chunk
  assert.ok(m.faces > 0);
  const ys = new Set<number>();
  eachTriangle(m, (a, b, c) => { ys.add(Math.fround(a[1])); ys.add(Math.fround(b[1])); ys.add(Math.fround(c[1])); });
  assert.deepEqual([...ys], [T + 1]);
  // one quad per top cell, nothing else (no walls at the chunk edge, no floor underside)
  assert.equal(m.faces, 8 * 8);
});

test("a single filled cell on smooth ground still shows (a bump), a dug cell still shows (a dip)", () => {
  const flat = (_i: number, j: number) => (j <= 1 ? 1 : 0);
  const bump = grid([7, 6, 7], (i, j, k) => (flat(i, j) || (i === 3 && j === 2 && k === 3) ? 1 : 0));
  const mb = buildSmoothMesh(bump, flat, grey);
  const maxY = Math.max(...mb.positions.filter((_, n) => n % 3 === 1));
  assert.ok(maxY > 2.2 && maxY <= 3, `bump top ${maxY}`);

  const dip = grid([7, 6, 7], (i, j, k) => (flat(i, j) && !(i === 3 && j === 1 && k === 3) ? 1 : 0));
  const md = buildSmoothMesh(dip, flat, grey);
  const minY = Math.min(...md.positions.filter((_, n) => n % 3 === 1));
  assert.ok(minY < 1.8 && minY >= 1, `dip bottom ${minY}`);
});

test("winding faces outward (back-face culling keeps the outside) and normals agree", () => {
  // a smooth hill: stepped mound in the middle of flat ground
  const h = (i: number, k: number) => 2 + Math.max(0, 3 - Math.max(Math.abs(i - 6), Math.abs(k - 6)));
  const g = grid([13, 8, 13], (i, j, k) => (j < h(i, k) ? 1 : 0));
  const m = buildSmoothMesh(g, (i, j, k) => (j < h(i, k) ? 1 : 0), grey);
  assert.ok(m.faces > 100);
  let bad = 0;
  eachTriangle(m, (a, b, c, n) => {
    const u = b.map((x, q) => x - a[q]), v = c.map((x, q) => x - a[q]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] <= 0) bad++;
  });
  assert.equal(bad, 0);
  // and the hill really is smooth: some normals lean (not just axis-aligned)
  let leaning = 0;
  for (let n = 0; n < m.normals.length; n += 3) if (Math.abs(m.normals[n + 1]) > 0.2 && Math.abs(m.normals[n + 1]) < 0.95) leaning++;
  assert.ok(leaning > 20, `leaning normals ${leaning}`);
});

test("chunks join: each shared edge is drawn by exactly one side", () => {
  // the same ground split into two 4-wide chunks vs one 8-wide grid
  const fill = (gi: number, j: number) => (j <= 1 + (gi > 3 ? 1 : 0) ? 1 : 0);
  const whole = grid([8, 6, 4], (i, j) => fill(i, j));
  whole.world = [8, 4];
  const one = buildSmoothMesh(whole, (i, j) => (i >= 0 && i < 8 ? fill(i, j) : 0), grey).faces;
  const left = grid([4, 6, 4], (i, j) => fill(i, j));
  left.world = [8, 4];
  const right = grid([4, 6, 4], (i, j) => fill(i + 4, j));
  right.origin = [4, 0];
  right.world = [8, 4];
  const look = (off: number) => (i: number, j: number) => (i + off >= 0 && i + off < 8 ? fill(i + off, j) : 0);
  const two = buildSmoothMesh(left, look(0), grey).faces + buildSmoothMesh(right, look(4), grey).faces;
  assert.equal(two, one);
});

test("smooth and block ground are solid to each other: no faces or skin between them", () => {
  // stone at i=0, grass at i=1, on the floor
  const g = grid([2, 1, 1], (i) => (i === 0 ? 2 : 1));
  const blocks = buildChunkMesh(g, false, air, grey);
  assert.equal(blocks.faces, 4); // the stone only, not its +x face toward the grass
  const xs = blocks.positions.filter((_, n) => n % 3 === 0);
  assert.ok(Math.max(...xs) <= 0, "no grass cube drawn"); // stone fills x ∈ [-1, 0]

  // smooth grass top on block stone: only the grass/air skin, nothing at y = T (the grass/stone interface)
  const T = 2;
  const fill = (_i: number, j: number) => (j < T ? 2 : j === T ? 1 : 0);
  const layered = buildSmoothMesh(grid([6, 6, 6], fill), fill, grey);
  assert.equal(layered.faces, 6 * 6);
  const ys = new Set([...layered.positions].filter((_, n) => n % 3 === 1).map((y) => Math.fround(y)));
  assert.ok(![...ys].some((y) => y < T + 0.5), `skin dips to ${Math.min(...ys)}`);
});

/**
 * Voxel chunk → one mesh of only the faces you can see (2026-10-21).
 *
 * Terrain used to draw every visible voxel as a full instanced cube: ~86% of
 * those triangles were faces pressed against a neighbour (never visible), and
 * phones paid for them on every frame (millions of triangles + overdraw when
 * facing a volcano). This emits a face only where it borders air (or, for
 * solid blocks, a liquid you can see through). Faces on a chunk's edge ask the
 * neighbouring chunk, so seams between chunks don't draw hidden walls either.
 *
 * Pure (no three.js): typed arrays out, so it is testable and the same on
 * every machine.
 */
import { cellAt, type VoxelGrid } from "./voxel.js";

/** What occupies a cell, for face culling. */
export const AIR = 0, SOLID = 1, LIQUID = 2;
export type CellKind = typeof AIR | typeof SOLID | typeof LIQUID;

/** Liquids sit a little below the block top, like a water surface. */
export const LIQUID_HEIGHT = 0.85;

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  faces: number;
}

/**
 * Kind of a cell just outside this grid in x or z (local coordinates, so i or k
 * is -1 or size). Return AIR at the world's edge.
 */
export type OutsideLookup = (i: number, j: number, k: number) => CellKind;

/** Linear RGB for a cell (block index v ≥ 1, global x/z, height j). */
export type CellColor = (v: number, gi: number, j: number, gk: number) => [number, number, number];

// Each face: outward normal, neighbour offset, 4 corners (unit cube), CCW seen from outside.
const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

export function kindOf(g: VoxelGrid, v: number): CellKind {
  return v === 0 ? AIR : g.liquid[v - 1] ? LIQUID : SOLID;
}

/**
 * Build the visible faces of one layer (solid or liquid) of a chunk.
 * Positions are in world meters, matching the old instanced cubes exactly.
 */
export function buildChunkMesh(g: VoxelGrid, liquid: boolean, outside: OutsideLookup, colorOf: CellColor): ChunkMesh {
  const [sx, sy, sz] = g.size;
  const ox = g.origin[0] - g.world[0] / 2, oz = g.origin[1] - g.world[1] / 2;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];

  const neighbour = (i: number, j: number, k: number): CellKind => {
    if (j >= sy) return AIR;
    if (j < 0) return SOLID; // the floor's underside is never seen
    if (i < 0 || k < 0 || i >= sx || k >= sz) return outside(i, j, k);
    return kindOf(g, cellAt(g, i, j, k));
  };

  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
    const v = cellAt(g, i, j, k);
    if (v === 0 || g.liquid[v - 1] !== liquid) continue;
    const h = liquid ? LIQUID_HEIGHT : 1;
    let rgb: [number, number, number] | null = null;
    for (const f of FACES) {
      const nk = neighbour(i + f.n[0], j + f.n[1], k + f.n[2]);
      // Solid: show faces toward air or see-through liquid. Liquid: only toward air.
      if (liquid ? nk !== AIR : nk === SOLID) continue;
      rgb ??= colorOf(v, g.origin[0] + i, j, g.origin[1] + k);
      const base = pos.length / 3;
      for (const [cx, cy, cz] of f.c) {
        pos.push(ox + i + cx, j + cy * h, oz + k + cz);
        nor.push(f.n[0], f.n[1], f.n[2]);
        col.push(rgb[0], rgb[1], rgb[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    indices: new Uint32Array(idx),
    faces: idx.length / 6,
  };
}

/**
 * Terrain editing (Rough Draft M5d): dig and fill on top of the generated grid.
 *
 * The terrain itself stays parameters (shared/voxel.ts regenerates it the same
 * everywhere); edits are a sparse overlay in the World CRDT,
 * `Y.Map("terrainEdits")`: key "gi,j,gk" (global cell) → cell value (0 = air,
 * n = blocks[n - 1]). A cell set back to what the generator made is deleted,
 * so the map only holds real differences. Who may edit: the same rule as the
 * terrain (creator + co-creators), enforced by the server's world authority.
 * Reshaping the terrain clears every edit (they belong to the old ground);
 * changing only how a block is drawn (smooth ↔ blocks, M5e) keeps them.
 */
import { LIMITS, type BlueprintDraft } from "./blueprint.js";
import { CHUNK, type VoxelGrid } from "./voxel.js";

/**
 * The terrain's shape, ignoring how its blocks are drawn (`surface`, M5e): flipping a block
 * between smooth and blocks keeps the same cells, so it keeps the world's dig/fill edits too.
 */
export function terrainShapeKey(t: BlueprintDraft["terrain"]): string {
  return JSON.stringify({ ...t, blocks: t.blocks.map(({ surface: _surface, ...b }) => b) });
}

export const TERRAIN_EDITS_MAP = "terrainEdits";

export const TERRAIN_EDIT_LIMITS = {
  /** Most edited cells a world keeps (~1 MB of CRDT at the cap). */
  maxEdits: 20_000,
  /** Most cells one update may change (a dig is 1; reshape clears are server-side or owner bulk deletes). */
  maxPerUpdate: 64,
} as const;

export const editKey = (gi: number, j: number, gk: number): string => `${gi},${j},${gk}`;

const KEY = /^(\d{1,4}),(\d{1,3}),(\d{1,4})$/;

/** Parse "gi,j,gk"; null unless it's a cell a player may edit (j = 0 is the floor and never changes). */
export function parseEditKey(key: string): [number, number, number] | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const gi = +m[1], j = +m[2], gk = +m[3];
  if (gi >= LIMITS.world || gk >= LIMITS.world || j < 1 || j >= LIMITS.grid) return null;
  return [gi, j, gk];
}

/** A legal stored value: air or a block index the blueprint can have. */
export const validEditValue = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= LIMITS.blocks;

/** Which chunk a global cell is in, and its index inside that chunk's grid. */
export function chunkCell(gi: number, j: number, gk: number, world: [number, number, number]): { chunk: string; idx: number; cx: number; cz: number } {
  const cx = Math.floor(gi / CHUNK), cz = Math.floor(gk / CHUNK);
  const sx = Math.min(CHUNK, world[0] - cx * CHUNK), sz = Math.min(CHUNK, world[2] - cz * CHUNK);
  const i = gi - cx * CHUNK, k = gk - cz * CHUNK;
  return { chunk: `${cx},${cz}`, idx: i + sx * (k + sz * j), cx, cz };
}

/** Copy of `g` with edits applied (index → value, as from `chunkCell`). Values past the blueprint's blocks become air. */
export function withEdits(g: VoxelGrid, edits: Map<number, number>): VoxelGrid {
  const cells = g.cells.slice();
  const max = g.blocks.length;
  for (const [idx, v] of edits) if (idx >= 0 && idx < cells.length) cells[idx] = v <= max ? v : 0;
  return { ...g, cells };
}

/**
 * Is a cell near its chunk's edge (so the neighbour chunk's mesh changes too)? Returns neighbour
 * chunk offsets. `reach` = how many cells past its edge a chunk's mesh reads: 1 for block faces,
 * more for smooth surfaces (M5e), which also reach the diagonal chunk at a corner.
 */
export function edgeNeighbours(gi: number, gk: number, world: [number, number, number], reach = 1): [number, number][] {
  const out: [number, number][] = [];
  const i = gi % CHUNK, k = gk % CHUNK;
  const cx = Math.floor(gi / CHUNK), cz = Math.floor(gk / CHUNK);
  const sx = Math.min(CHUNK, world[0] - cx * CHUNK), sz = Math.min(CHUNK, world[2] - cz * CHUNK);
  const xs = [...(i < reach ? [-1] : []), ...(i >= sx - reach ? [1] : [])];
  const zs = [...(k < reach ? [-1] : []), ...(k >= sz - reach ? [1] : [])];
  for (const dx of xs) out.push([dx, 0]);
  for (const dz of zs) out.push([0, dz]);
  if (reach > 1) for (const dx of xs) for (const dz of zs) out.push([dx, dz]);
  return out;
}

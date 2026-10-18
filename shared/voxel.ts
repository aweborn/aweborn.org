/**
 * Voxel terrain (Phase 07): blueprint.terrain → a block grid.
 *
 * Deterministic and free: the same blueprint gives the same grid on every
 * machine (integer hashing, no trig, no Math.random), so the Ghost preview,
 * the manifested world and a research replay all match.
 *
 * Grid → world: cell (i, j, k) fills [i - sx/2, i - sx/2 + 1] × [j, j + 1] ×
 * [k - sz/2, k - sz/2 + 1]. One cell = one meter; y = 0 is the interior floor.
 */
import type { BlueprintDraft, BlueprintBlock } from "./blueprint.js";
import type { Box } from "./sim/interior.js";

export interface VoxelGrid {
  size: [number, number, number];
  /** 0 = empty, n = blocks[n - 1]; index (i, j, k) = i + sx * (k + sz * j) */
  cells: Uint8Array;
  blocks: BlueprintBlock[];
  /** Per block index (0-based): liquids don't collide and render translucent. */
  liquid: boolean[];
}

/** Base ground thickness (cells); ponds dig into it. */
export const GROUND = 3;

const LIQUID = /water|lava|pond|lake|sea|river/;

// ── Deterministic noise ───────────────────────────────────────────────
function hash(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Value noise in [0, 1), cell size `scale`. */
function noise(seed: number, x: number, z: number, scale: number): number {
  const fx = x / scale, fz = z / scale;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = smooth(fx - x0), tz = smooth(fz - z0);
  const a = hash(seed, x0, z0), b = hash(seed, x0 + 1, z0);
  const c = hash(seed, x0, z0 + 1), d = hash(seed, x0 + 1, z0 + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

export function generateVoxels(t: BlueprintDraft["terrain"]): VoxelGrid {
  const [sx, sy, sz] = t.size;
  const seed = t.seed | 0;
  const blocks = t.blocks;
  const liquid = blocks.map((b) => LIQUID.test(b.id) || LIQUID.test(b.name.toLowerCase()));
  const idx = (id: string) => Math.max(0, blocks.findIndex((b) => b.id === id)) + 1;
  const solidIds = blocks.map((_, i) => i + 1).filter((n) => !liquid[n - 1]);
  const ground = solidIds[0] ?? 1;
  const filler = idx(blocks.find((b) => /stone|rock|dirt|earth|soil/.test(b.id))?.id ?? blocks[0].id);

  const N = sx * sz;
  const height = new Int16Array(N);   // solid column top (cells)
  const top = new Uint8Array(N);      // block at the surface
  const water = new Int16Array(N);    // liquid surface (0 = none)
  const waterBlock = new Uint8Array(N);
  const extras: { i: number; k: number; from: number; to: number; block: number }[] = []; // floating islands

  for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
    const c = i + sx * k;
    height[c] = GROUND + (noise(seed, i, k, 7) > 0.72 ? 1 : 0); // gentle base, deep enough to dig ponds into
    top[c] = ground;
  }

  for (const f of t.features) {
    const [cx, cy, cz] = f.at;
    const r = f.radius;
    const block = idx(f.block);
    const h = Math.round(f.height ?? 3);
    for (let k = Math.max(0, Math.floor(cz - r)); k <= Math.min(sz - 1, Math.ceil(cz + r)); k++) {
      for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(sx - 1, Math.ceil(cx + r)); i++) {
        const dx = i + 0.5 - cx, dz = k + 0.5 - cz;
        const n = noise(seed + 101, i, k, 3);
        const d = Math.sqrt(dx * dx + dz * dz) / r; // 0 center … 1 edge
        const c = i + sx * k;
        // at.y: lift above the ground for ground features, altitude for floating islands
        const base = f.type === "floating-island" ? Math.round(cy) : GROUND + Math.round(cy);
        switch (f.type) {
          case "plateau":
          case "cliff": {
            const edge = f.type === "cliff" ? 0.8 + 0.35 * n : 1;
            if (d <= edge) { height[c] = Math.max(height[c], base + h); top[c] = block; }
            break;
          }
          case "hill": {
            if (d >= 1) break;
            const falloff = (1 - d * d) * (1 - d * d);
            const hh = base + Math.round(h * falloff + n - 0.3);
            if (hh > height[c]) { height[c] = hh; top[c] = block; }
            break;
          }
          case "path":
            if (d <= 1) top[c] = block;
            break;
          case "pond": {
            if (d > 1) break;
            const depth = Math.max(1, Math.round((f.height ?? 2) * (1 - d * d) + 0.4));
            const surface = height[c];
            if (liquid[block - 1]) {
              height[c] = Math.max(1, surface - depth);
              water[c] = surface;
              waterBlock[c] = block;
            } else {
              height[c] = Math.max(1, surface - depth);
            }
            break;
          }
          case "floating-island": {
            if (d >= 1) break;
            const thick = 1 + Math.round(h * (1 - d * d) * (0.7 + 0.5 * n));
            extras.push({ i, k, from: Math.max(0, base - thick + 1), to: base, block });
            break;
          }
        }
      }
    }
  }

  const cells = new Uint8Array(sx * sy * sz);
  const set = (i: number, j: number, k: number, v: number) => { if (j >= 0 && j < sy) cells[i + sx * (k + sz * j)] = v; };
  for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
    const c = i + sx * k;
    const hgt = Math.min(sy, height[c]);
    for (let j = 0; j < hgt; j++) set(i, j, k, j === hgt - 1 ? top[c] : filler);
    for (let j = hgt; j < Math.min(sy, water[c]); j++) set(i, j, k, waterBlock[c]);
  }
  for (const e of extras) for (let j = e.from; j <= e.to; j++) set(e.i, j, e.k, j === e.to ? e.block : filler);

  return { size: [sx, sy, sz], cells, blocks, liquid };
}

export const cellAt = (g: VoxelGrid, i: number, j: number, k: number): number => {
  const [sx, sy, sz] = g.size;
  if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) return 0;
  return g.cells[i + sx * (k + sz * j)];
};
const solid = (g: VoxelGrid, v: number) => v !== 0 && !g.liquid[v - 1];

/**
 * Colliders: each column's solid runs as boxes, merged along x when the
 * neighbor has the same run. Flagged `step` so they can be walked up.
 */
export function voxelColliders(g: VoxelGrid): Box[] {
  const [sx, sy, sz] = g.size;
  const ox = -sx / 2, oz = -sz / 2;
  const boxes: Box[] = [];
  for (let k = 0; k < sz; k++) {
    let open = new Map<string, Box>();
    for (let i = 0; i < sx; i++) {
      const next = new Map<string, Box>();
      let j = 0;
      while (j < sy) {
        if (!solid(g, cellAt(g, i, j, k))) { j++; continue; }
        const from = j;
        while (j < sy && solid(g, cellAt(g, i, j, k))) j++;
        const key = `${from}:${j}`;
        const prev = open.get(key);
        if (prev) { prev.maxX = ox + i + 1; next.set(key, prev); }
        else {
          const b: Box = { minX: ox + i, maxX: ox + i + 1, minY: from, maxY: j, minZ: oz + k, maxZ: oz + k + 1, step: true };
          boxes.push(b);
          next.set(key, b);
        }
      }
      open = next;
    }
  }
  return boxes;
}

/** Cells with at least one open face (what's worth drawing). */
export function visibleCells(g: VoxelGrid): { i: number; j: number; k: number; v: number }[] {
  const [sx, sy, sz] = g.size;
  const out: { i: number; j: number; k: number; v: number }[] = [];
  for (let j = 0; j < sy; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
    const v = cellAt(g, i, j, k);
    if (!v) continue;
    const isLiquid = g.liquid[v - 1];
    const open = (n: number) => n === 0 || (!isLiquid && g.liquid[n - 1]);
    if (isLiquid ? cellAt(g, i, j + 1, k) === 0 :
      open(cellAt(g, i + 1, j, k)) || open(cellAt(g, i - 1, j, k)) || open(cellAt(g, i, j + 1, k)) ||
      (j > 0 && open(cellAt(g, i, j - 1, k))) || open(cellAt(g, i, j, k + 1)) || open(cellAt(g, i, j, k - 1))) {
      out.push({ i, j, k, v });
    }
  }
  return out;
}

/** Grid cell (as the planner places things) → world position at the cell's surface. */
export function cellToWorld(g: VoxelGrid, at: [number, number, number]): { x: number; y: number; z: number } {
  const [sx, sy, sz] = g.size;
  const i = Math.min(sx - 1, Math.max(0, Math.floor(at[0])));
  const k = Math.min(sz - 1, Math.max(0, Math.floor(at[2])));
  let y = 0;
  for (let j = sy - 1; j >= 0; j--) if (cellAt(g, i, j, k)) { y = j + 1; break; }
  return { x: i - sx / 2 + 0.5, y, z: k - sz / 2 + 0.5 };
}

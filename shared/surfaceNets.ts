/**
 * Smooth voxels (Rough Draft M5e, Phase 07): Surface Nets over the blocks a
 * blueprint marks `surface: "smooth"` (natural ground: grass, sand, snow…).
 *
 * The grid stays the truth (same cells, same edits, same colliders); only the
 * drawing changes. Per cell: 1 if it holds any solid block (smooth or not),
 * else 0. That field is blurred ([1, 6, 1] / 8 on each axis) and then clamped
 * so a solid cell is always ≥ 0.75 and anything else ≤ 0.25: the surface (0.5)
 * therefore separates exactly the same cells the block faces would (a single
 * dug or filled cell never vanishes), and the blur only decides *where*
 * between two cell centres it passes. Flat ground keeps its top at the block
 * top (j + 1). Only the part of that surface where a smooth cell meets air or
 * liquid is drawn here; block solids keep their own faces, and smooth grass
 * on block dirt has no seam between them.
 *
 * Dual contouring, naive flavour: one vertex per lattice cube (8 cell centres)
 * that the surface crosses, at the mean of its edge crossings; one quad per
 * crossed lattice edge, joining the 4 cubes around it. Each edge belongs to
 * the chunk of its lower cell, so chunks join without seams or double walls.
 *
 * Pure (no three.js), deterministic, testable. Physics keeps the block
 * colliders (the drawn surface is within half a cell of them).
 */
import type { VoxelGrid } from "./voxel.js";
import type { CellColor, ChunkMesh } from "./voxelMesh.js";

/**
 * Raw cell value (0 = air, n = blocks[n - 1]) at a chunk-local cell just outside
 * this chunk in x or z (i, k may be -2…size+1). Return 0 outside the world.
 */
export type RawLookup = (i: number, j: number, k: number) => number;

/** How far past its own cells a chunk's smooth mesh reads: edits this close to an edge change the neighbour too. */
export const SMOOTH_REACH = 2;

const PAD = SMOOTH_REACH;
const ISO = 0.5, SOLID_MIN = 0.75, AIR_MAX = 0.25;

/** Does this grid have any smooth solid blocks at all? (Otherwise there is nothing to build.) */
export const hasSmoothBlocks = (g: VoxelGrid): boolean =>
  g.blocks.some((b, n) => b.surface === "smooth" && !g.liquid[n]);

const EMPTY: ChunkMesh = {
  positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0),
  indices: new Uint32Array(0), faces: 0,
};

// Cube corner c = dx | dy << 1 | dz << 2; its 12 edges join corners one bit apart.
const CUBE_EDGES: [number, number][] = [];
for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) CUBE_EDGES.push([c, c | b]);

export function buildSmoothMesh(g: VoxelGrid, outside: RawLookup, colorOf: CellColor): ChunkMesh {
  if (!hasSmoothBlocks(g)) return EMPTY;
  const [sx, sy, sz] = g.size;
  const ox = g.origin[0] - g.world[0] / 2, oz = g.origin[1] - g.world[1] / 2;

  // ── Raw cells, padded by PAD on every side ──
  const px = sx + 2 * PAD, pz = sz + 2 * PAD, layer = px * pz;
  const P = (i: number, j: number, k: number) => i + PAD + px * (k + PAD + pz * (j + PAD));
  const smoothOf = new Uint8Array(256);
  g.blocks.forEach((b, n) => { if (b.surface === "smooth" && !g.liquid[n]) smoothOf[n + 1] = 1; });
  const raw = new Uint8Array(layer * (sy + 2 * PAD));
  let top = -1; // highest row holding a smooth cell (everything above is just sky to us)
  for (let j = -PAD; j < sy + PAD; j++) {
    const jj = j < 0 ? 0 : j; // below the floor looks like the floor (never a surface there)
    for (let k = -PAD; k < sz + PAD; k++) for (let i = -PAD; i < sx + PAD; i++) {
      let v = 0;
      if (jj < sy) {
        v = i >= 0 && k >= 0 && i < sx && k < sz ? g.cells[i + sx * (k + sz * jj)] : outside(i, jj, k);
      }
      raw[P(i, j, k)] = v;
      if (smoothOf[v] && jj > top) top = jj;
    }
  }
  if (top < 0) return EMPTY;
  // Rows above top + 1 can't hold a crossing: work on [0, H) only (j is the outer index, so raw's prefix is that slab).
  const H = Math.min(sy, top + 2);
  const py = H + 2 * PAD;
  const N = layer * py;

  // ── Field: occupancy, blurred per axis, clamped to keep each cell's side ──
  // Every solid counts as ground here (smooth or not), so the skin doesn't sag where smooth grass sits on block dirt
  const solidOf = new Uint8Array(256);
  g.blocks.forEach((_b, n) => { if (!g.liquid[n]) solidOf[n + 1] = 1; });
  let a = new Float32Array(N), b = new Float32Array(N);
  for (let n = 0; n < N; n++) a[n] = solidOf[raw[n]];
  // [1, 6, 1] / 8 along one axis (stride s, length d), repeating the end cell at the padded border
  const blur = (s: number, d: number, outer: number, inner: number, so: number, si: number) => {
    for (let o = 0; o < outer; o++) for (let q = 0; q < inner; q++) {
      const base = o * so + q * si;
      for (let c = 0; c < d; c++) {
        const n = base + c * s;
        const lo = c > 0 ? a[n - s] : a[n], hi = c < d - 1 ? a[n + s] : a[n];
        b[n] = (lo + 6 * a[n] + hi) / 8;
      }
    }
    [a, b] = [b, a];
  };
  blur(1, px, py, pz, layer, px);      // x
  blur(px, pz, py, px, layer, 1);      // z
  blur(layer, py, pz, px, px, 1);      // y
  const F = a;
  for (let n = 0; n < N; n++) F[n] = solidOf[raw[n]] ? Math.max(F[n], SOLID_MIN) : Math.min(F[n], AIR_MAX);
  const inside = (n: number) => solidOf[raw[n]] === 1;

  // ── One vertex per crossed cube; cube (ca, cb, cc) spans cells ca…ca+1 etc., ca ∈ [-1, sx-1] ──
  const cx = sx + 1, cy = H + 1, cz = sz + 1;
  const vid = new Int32Array(cx * cy * cz).fill(-1);
  const C = (ca: number, cb: number, cc: number) => ca + 1 + cx * (cc + 1 + cz * (cb + 1));
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const f = new Float64Array(8);
  const corner = new Int32Array(8);
  for (let cb = -1; cb < H; cb++) for (let cc = -1; cc < sz; cc++) for (let ca = -1; ca < sx; ca++) {
    let mask = 0, smoothMask = 0;
    for (let c = 0; c < 8; c++) {
      const n = P(ca + (c & 1), cb + ((c >> 1) & 1), cc + ((c >> 2) & 1));
      corner[c] = n;
      f[c] = F[n];
      if (inside(n)) mask |= 1 << c;
      if (smoothOf[raw[n]]) smoothMask |= 1 << c;
    }
    // Only cubes touching a smooth cell can carry the smooth skin (block solids draw their own faces)
    if (mask === 0 || mask === 255 || smoothMask === 0) continue;
    let vx = 0, vy = 0, vz = 0, crossings = 0;
    for (const [c0, c1] of CUBE_EDGES) {
      if (((mask >> c0) & 1) === ((mask >> c1) & 1)) continue;
      const t = (ISO - f[c0]) / (f[c1] - f[c0]);
      vx += (c0 & 1) + t * ((c1 & 1) - (c0 & 1));
      vy += ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1));
      vz += ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1));
      crossings++;
    }
    // Outward normal = -gradient (the field rises into the ground)
    const gx = f[1] - f[0] + f[3] - f[2] + f[5] - f[4] + f[7] - f[6];
    const gy = f[2] - f[0] + f[3] - f[1] + f[6] - f[4] + f[7] - f[5];
    const gz = f[4] - f[0] + f[5] - f[1] + f[6] - f[2] + f[7] - f[3];
    const len = Math.hypot(gx, gy, gz);
    // Colour: the highest smooth cell among the corners (grass over dirt on a slope's lip)
    let top = -1;
    for (const c of [2, 3, 6, 7, 0, 1, 4, 5]) if ((smoothMask >> c) & 1) { top = c; break; }
    const ti = ca + (top & 1), tj = Math.max(0, cb + ((top >> 1) & 1)), tk = cc + ((top >> 2) & 1);
    const rgb = colorOf(raw[corner[top]], g.origin[0] + ti, tj, g.origin[1] + tk);
    vid[C(ca, cb, cc)] = pos.length / 3;
    pos.push(ox + ca + 0.5 + vx / crossings, cb + 0.5 + vy / crossings, oz + cc + 0.5 + vz / crossings);
    if (len > 1e-6) nor.push(-gx / len, -gy / len, -gz / len);
    else nor.push(0, 1, 0);
    col.push(rgb[0], rgb[1], rgb[2]);
  }

  // ── One quad per crossed lattice edge owned by this chunk (from a cell here to its +x/+y/+z neighbour) ──
  // Around the edge on axis d, with u = d+1 and v = d+2 (cyclic), the cubes at (u, v) offsets
  // (-1,-1) (0,-1) (0,0) (-1,0) turn counter-clockwise seen from +d.
  const ring: [number, number][] = [[-1, -1], [0, -1], [0, 0], [-1, 0]];
  const q = [0, 0, 0, 0];
  const p = [0, 0, 0];
  for (let j = 0; j < H; j++) for (let k = 0; k < sz; k++) for (let i = 0; i < sx; i++) {
    const n0 = P(i, j, k);
    const here = inside(n0);
    for (let d = 0; d < 3; d++) {
      const n1 = P(i + (d === 0 ? 1 : 0), j + (d === 1 ? 1 : 0), k + (d === 2 ? 1 : 0));
      const there = inside(n1);
      if (here === there) continue;
      // Skin only where a smooth cell meets air or liquid (a block solid's face toward air is the block layer's)
      if (!smoothOf[raw[here ? n0 : n1]]) continue;
      const u = (d + 1) % 3, v = (d + 2) % 3;
      let ok = true;
      for (let r = 0; r < 4; r++) {
        p[0] = i; p[1] = j; p[2] = k;
        p[u] += ring[r][0];
        p[v] += ring[r][1];
        const id = vid[C(p[0], p[1], p[2])];
        if (id < 0) { ok = false; break; }
        q[r] = id;
      }
      if (!ok) continue;
      // Solid on the low side → the outside is +d → keep the ring's order; else reverse it
      if (here) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
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

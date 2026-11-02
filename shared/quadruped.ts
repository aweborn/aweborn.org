/**
 * Four-legged walking without a rig provider (Phase 07 Life & minds, 2026-11-01).
 *
 * Meshy's rigging API is humanoid-only (it rigs a goat's front legs as arms), and
 * the other quadruped riggers are another paid dependency. Generated animals have
 * clearly separated legs, though, so we find them in the mesh and animate them
 * procedurally (the Spore / Rain World idea: locomotion from the body plan, not
 * from keyframes):
 *
 *   1. Slice the model bottom-up. Near the ground, a four-legged body is several
 *      separate blobs (legs). Where the slices merge into one blob is the hip line.
 *   2. The lowest slice with exactly four blobs gives the four feet; each vertex
 *      below the hip line belongs to the nearest foot's leg (works for staggered,
 *      mid-stride stances). Each leg gets a hip pivot.
 *   3. The end of the body that rises higher (head, horns, ears) is the front; the
 *      upper front part pivots at the neck.
 *
 * The client then swings the legs in a trot (diagonal pairs) about their hips in
 * the vertex shader while the creature roams, and nods the head when it idles.
 * Pure + deterministic: positions in, a body plan out.
 */

export type Axis = "x" | "z";

export interface BodyPlan {
  /** The long axis of the body and which way along it the head is (+1 / -1). */
  axis: Axis;
  front: 1 | -1;
  /** Hip line height (legs are below it). */
  legTop: number;
  /** Ground (lowest point). */
  floor: number;
  /** Middle of the four feet (long-axis coordinate, lateral coordinate). */
  centre: [number, number];
  /** Feet [long, lateral]: front-left, front-right, back-left, back-right (a leg vertex belongs to the nearest foot). */
  feet: [number, number][];
  /** Hip pivots [long, lateral] per leg: front-left, front-right, back-left, back-right. */
  hips: [number, number][];
  /** Neck pivot: long-axis coordinate and height; the head is beyond it, above the hips. */
  neck: [number, number];
}

/** Part ids per vertex: 0 body, 1–4 legs (FL, FR, BL, BR), 5 head. */
export const PART = { body: 0, fl: 1, fr: 2, bl: 3, br: 4, head: 5 } as const;

const SLICES = 28;
const GRID = 20;

interface Blob { gx: number; gy: number; count: number; size: number }

/** Connected blobs (4-neighbour) of occupied cells in a GRID×GRID slice, ignoring specks. */
function blobsOf(cells: Uint16Array, minCells = 2, minCount = 3): Blob[] {
  const seen = new Uint8Array(cells.length);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i] || seen[i]) continue;
    let size = 0, count = 0, sx = 0, sy = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % GRID, y = (c / GRID) | 0;
      size++;
      count += cells[c];
      sx += x * cells[c];
      sy += y * cells[c];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const k = ny * GRID + nx;
        if (cells[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (size >= minCells && count >= minCount) out.push({ gx: sx / count, gy: sy / count, count, size });
  }
  return out;
}

/**
 * Find the four-legged body plan in a model's vertex positions (xyz triples, any
 * scale), or null if it doesn't look like four legs standing on the ground.
 */
export function findBodyPlan(pos: ArrayLike<number>): BodyPlan | null {
  const n = Math.floor(pos.length / 3);
  if (n < 50) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ;
  if (ey <= 0 || ex <= 0 || ez <= 0) return null;
  const axis: Axis = ex >= ez ? "x" : "z";
  const L = axis === "x" ? 0 : 2, T = axis === "x" ? 2 : 0;
  const minL = axis === "x" ? minX : minZ, extL = axis === "x" ? ex : ez;
  const minT = axis === "x" ? minZ : minX, extT = axis === "x" ? ez : ex;

  // Slice bottom-up: how many separate blobs at each height?
  const sliceH = ey / SLICES;
  const grids = Array.from({ length: SLICES }, () => new Uint16Array(GRID * GRID));
  for (let i = 0; i < n; i++) {
    const s = Math.min(SLICES - 1, Math.floor((pos[i * 3 + 1] - minY) / sliceH));
    const gx = Math.min(GRID - 1, Math.floor(((pos[i * 3 + L] - minL) / extL) * GRID));
    const gy = Math.min(GRID - 1, Math.floor(((pos[i * 3 + T] - minT) / extT) * GRID));
    grids[s][gy * GRID + gx]++;
  }
  const blobs = grids.map((g) => blobsOf(g));
  // Feet: the first low slice with exactly four separate blobs (a biped's two feet, or
  // feet + a dragging tail, don't qualify)
  let footSlice = -1;
  for (let s = 0; s < Math.min(5, SLICES); s++) {
    if (blobs[s].length === 4) {
      footSlice = s;
      break;
    }
  }
  if (footSlice < 0) return null;
  // Hip line: legs stay separate (3+ blobs) going up; where they merge into the body is the top
  let top = footSlice;
  for (let s = footSlice + 1; s < SLICES * 0.7; s++) {
    if (blobs[s].length >= 3) top = s;
    else break;
  }
  const legTop = minY + (top + 1) * sliceH;
  if ((legTop - minY) / ey < 0.12) return null; // stubby: not worth swinging

  // The four feet (long-axis, lateral coordinates)
  const feet = blobs[footSlice].map((f) => [minL + ((f.gx + 0.5) / GRID) * extL, minT + ((f.gy + 0.5) / GRID) * extT] as [number, number]);
  const cL = feet.reduce((m, f) => m + f[0], 0) / 4, cT = feet.reduce((m, f) => m + f[1], 0) / 4;

  // Front: the end that rises higher (head, ears, horns)
  let topPlus = -Infinity, topMinus = -Infinity;
  for (let i = 0; i < n; i++) {
    const l = pos[i * 3 + L] - cL, y = pos[i * 3 + 1];
    if (l > extL * 0.2 && y > topPlus) topPlus = y;
    if (l < -extL * 0.2 && y > topMinus) topMinus = y;
  }
  const front: 1 | -1 = topPlus >= topMinus ? 1 : -1;

  // Name the feet: the two most forward are front; within each pair, the higher lateral is "left"
  const byFront = [...feet].sort((p, q) => (q[0] - p[0]) * front);
  const [f1, f2] = byFront.slice(0, 2).sort((p, q) => q[1] - p[1]);
  const [b1, b2] = byFront.slice(2).sort((p, q) => q[1] - p[1]);
  const named = [f1, f2, b1, b2];
  // Hip pivots: the centroid of each leg's vertices (nearest foot) just below the hip line
  const sum = named.map(() => [0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1];
    if (y >= legTop || y < legTop - sliceH * 2) continue;
    const q = nearestFoot(named, pos[i * 3 + L], pos[i * 3 + T]);
    sum[q][0] += pos[i * 3 + L];
    sum[q][1] += pos[i * 3 + T];
    sum[q][2]++;
  }
  const hips = named.map((f, q) => (sum[q][2] ? [sum[q][0] / sum[q][2], sum[q][1] / sum[q][2]] : [f[0], f[1]]) as [number, number]);
  // The neck: at the front legs, a third of the way up the body above the hips
  const frontEnd = (hips[0][0] + hips[1][0]) / 2;
  const neck: [number, number] = [frontEnd, legTop + (maxY - legTop) * 0.35];
  return { axis, front, legTop, floor: minY, centre: [cL, cT], feet: named, hips, neck };
}

function nearestFoot(feet: [number, number][], l: number, t: number): number {
  let best = 0, bd = Infinity;
  feet.forEach((f, i) => {
    const d = (f[0] - l) ** 2 + (f[1] - t) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** The part of one vertex under a body plan (see PART). */
export function partOf(plan: BodyPlan, x: number, y: number, z: number): number {
  const l = plan.axis === "x" ? x : z, t = plan.axis === "x" ? z : x;
  if (y < plan.legTop) return 1 + nearestFoot(plan.feet, l, t);
  if ((l - plan.neck[0]) * plan.front > 0 && y > plan.neck[1]) return PART.head;
  return PART.body;
}

/**
 * Leg swing angles (radians, about the lateral axis) for a trot at `phase`:
 * diagonal pairs move together (FL with BR, FR with BL). `amp` 0 = standing.
 */
export function trot(phase: number, amp: number): [number, number, number, number] {
  const a = Math.sin(phase) * amp, b = -a;
  return [a, b, b, a];
}

import { generateVoxels, voxelColliders, cellToWorld, CHUNK, type VoxelGrid } from '@aweborn/shared/voxel'
import type { Box } from '@aweborn/shared/sim/interior'
import type { BlueprintDraft } from '@aweborn/shared/blueprint'

type Terrain = BlueprintDraft['terrain']

/**
 * Chunked terrain. A blueprint's terrain is parameters (seed, blocks, features),
 * so any chunk can be generated on its own, identically on every machine. We
 * generate lazily, keep a small cache per terrain, and only the chunks near the
 * player are drawn (VIEW_RADIUS) or collided with (COLLIDE_RADIUS).
 */
export interface Chunk {
  /** Stable React key: unique per terrain version and chunk. */
  id: string
  cx: number
  cz: number
  grid: VoxelGrid
  colliders: Box[]
}

/** Chunks whose colliders are active around the player. (How many are drawn comes from the quality tier.) */
export const COLLIDE_RADIUS = 1

interface Store { serial: number; chunks: Map<string, Chunk> }
const keyOf = new WeakMap<object, string>()
const stores = new Map<string, Store>()
let serial = 0
const MAX_TERRAINS = 4
const MAX_CHUNKS = 300

function storeFor(t: Terrain): Store {
  let k = keyOf.get(t)
  if (!k) { k = JSON.stringify(t); keyOf.set(t, k) }
  let s = stores.get(k)
  if (!s) {
    s = { serial: ++serial, chunks: new Map() }
    stores.set(k, s)
    if (stores.size > MAX_TERRAINS) stores.delete(stores.keys().next().value!)
  }
  return s
}

export const chunkCounts = (t: Terrain): [number, number] => [Math.ceil(t.size[0] / CHUNK), Math.ceil(t.size[2] / CHUNK)]

/** The chunk at (cx, cz), generated on first use; null outside the world's footprint. */
export function getChunk(t: Terrain, cx: number, cz: number): Chunk | null {
  const [nx, nz] = chunkCounts(t)
  if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) return null
  const s = storeFor(t)
  const id = `${cx},${cz}`
  let c = s.chunks.get(id)
  if (!c) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK
    const grid = generateVoxels(t, { x0, z0, w: Math.min(CHUNK, t.size[0] - x0), d: Math.min(CHUNK, t.size[2] - z0) })
    c = { id: `${s.serial}:${id}`, cx, cz, grid, colliders: voxelColliders(grid) }
    s.chunks.set(id, c)
    if (s.chunks.size > MAX_CHUNKS) for (const k of [...s.chunks.keys()].slice(0, MAX_CHUNKS / 3)) s.chunks.delete(k)
  }
  return c
}

/** Chunks within `r` chunks of (cx, cz), nearest first. */
export function chunksAround(t: Terrain, cx: number, cz: number, r: number): Chunk[] {
  const out: Chunk[] = []
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const c = getChunk(t, cx + dx, cz + dz)
    if (c) out.push(c)
  }
  return out.sort((a, b) => Math.hypot(a.cx - cx, a.cz - cz) - Math.hypot(b.cx - cx, b.cz - cz))
}

/** Which chunk a world position (meters, world centered on 0, 0) is in, clamped to the footprint. */
export function chunkOfWorld(t: Terrain, wx: number, wz: number): [number, number] {
  const [nx, nz] = chunkCounts(t)
  const cx = Math.floor((wx + t.size[0] / 2) / CHUNK)
  const cz = Math.floor((wz + t.size[2] / 2) / CHUNK)
  return [Math.min(nx - 1, Math.max(0, cx)), Math.min(nz - 1, Math.max(0, cz))]
}

/** Planner cell (global grid coordinates) → world position on the surface there. */
export function placeOnTerrain(t: Terrain, at: [number, number, number]): { x: number; y: number; z: number } {
  const [nx, nz] = chunkCounts(t)
  const cx = Math.min(nx - 1, Math.max(0, Math.floor(at[0] / CHUNK)))
  const cz = Math.min(nz - 1, Math.max(0, Math.floor(at[2] / CHUNK)))
  return cellToWorld(getChunk(t, cx, cz)!.grid, at)
}

/** How far from the center a player may walk (the old 19.5 m room, now the world's edge). */
export const halfExtentOf = (t: Terrain): number => Math.min(t.size[0], t.size[2]) / 2 - 0.5

export const sameTerrain = (a: unknown, b: unknown) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

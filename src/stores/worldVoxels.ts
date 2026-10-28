import { create } from 'zustand'
import { generateVoxels, voxelColliders, cellToWorld, cellAt, CHUNK, type VoxelGrid } from '@aweborn/shared/voxel'
import type { Box } from '@aweborn/shared/sim/interior'
import type { BlueprintDraft } from '@aweborn/shared/blueprint'
import { chunkCell, edgeNeighbours, parseEditKey, terrainShapeKey, validEditValue, withEdits } from '@aweborn/shared/terrain-edits'
import { SMOOTH_REACH } from '@aweborn/shared/surfaceNets'

type Terrain = BlueprintDraft['terrain']

/** Progress of terrain chunk streaming for the active world (used by WorldTransition's loading bar). */
export const useWorldLoadProgress = create<{
  chunksReady: number
  chunksTotal: number
  setChunkProgress: (chunksReady: number, chunksTotal: number) => void
}>((set) => ({
  chunksReady: 0,
  chunksTotal: 0,
  setChunkProgress: (chunksReady, chunksTotal) => set({ chunksReady, chunksTotal }),
}))

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

interface Store { key: string; serial: number; chunks: Map<string, Chunk>; edited: Map<string, Chunk> }
const keyOf = new WeakMap<object, string>()
const stores = new Map<string, Store>()
let serial = 0
const MAX_TERRAINS = 4
const MAX_CHUNKS = 300

function terrainKey(t: Terrain): string {
  let k = keyOf.get(t)
  if (!k) { k = JSON.stringify(t); keyOf.set(t, k) }
  return k
}

function storeFor(t: Terrain): Store {
  const k = terrainKey(t)
  let s = stores.get(k)
  if (!s) {
    s = { key: k, serial: ++serial, chunks: new Map(), edited: new Map() }
    stores.set(k, s)
    if (stores.size > MAX_TERRAINS) stores.delete(stores.keys().next().value!)
  }
  return s
}

// ── Terrain edits overlay (M5d) ──
// The world's dig/fill edits (World CRDT `terrainEdits`), indexed per chunk. Only the
// world's own terrain gets them (the ghost of a different blueprint never does).
interface EditIndex { terrainKey: string; world: Terrain['size']; byChunk: Map<string, Map<number, number>>; rev: Map<string, number> }
let editIndex: EditIndex | null = null

/** Bumped whenever any chunk's edits change, so terrain meshes and colliders re-read their chunks. */
export const useTerrainEditsRev = create<{ rev: number }>(() => ({ rev: 0 }))

function indexEdit(ix: EditIndex, key: string, value: unknown): void {
  const cell = parseEditKey(key)
  if (!cell) return
  const [gi, j, gk] = cell
  if (gi >= ix.world[0] || gk >= ix.world[2] || j >= ix.world[1]) return
  const c = chunkCell(gi, j, gk, ix.world)
  let m = ix.byChunk.get(c.chunk)
  if (validEditValue(value)) {
    if (!m) ix.byChunk.set(c.chunk, (m = new Map()))
    m.set(c.idx, value)
  } else if (m) {
    m.delete(c.idx)
    if (!m.size) ix.byChunk.delete(c.chunk)
  }
  const bump = (id: string) => ix.rev.set(id, (ix.rev.get(id) ?? 0) + 1)
  bump(c.chunk)
  // Smooth surfaces read SMOOTH_REACH cells into the next chunk, so an edit that close rebuilds it too
  for (const [dx, dz] of edgeNeighbours(gi, gk, ix.world, SMOOTH_REACH)) bump(`${c.cx + dx},${c.cz + dz}`)
}

/** (Re)build the overlay for the world's terrain from every stored edit (world load, terrain reshaped). */
export function resetTerrainEdits(t: Terrain | null, entries: Iterable<[string, unknown]> = []): void {
  editIndex = t ? { terrainKey: terrainKey(t), world: t.size, byChunk: new Map(), rev: new Map() } : null
  if (editIndex) for (const [k, v] of entries) indexEdit(editIndex, k, v)
  useTerrainEditsRev.setState((s) => ({ rev: s.rev + 1 }))
}

/** Apply changed keys only (value undefined = deleted). */
export function changeTerrainEdits(changes: Iterable<[string, unknown]>): void {
  if (!editIndex) return
  for (const [k, v] of changes) indexEdit(editIndex, k, v)
  useTerrainEditsRev.setState((s) => ({ rev: s.rev + 1 }))
}

export const chunkCounts = (t: Terrain): [number, number] => [Math.ceil(t.size[0] / CHUNK), Math.ceil(t.size[2] / CHUNK)]

function baseChunk(t: Terrain, s: Store, cx: number, cz: number, id: string): Chunk {
  let c = s.chunks.get(id)
  if (!c) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK
    const grid = generateVoxels(t, { x0, z0, w: Math.min(CHUNK, t.size[0] - x0), d: Math.min(CHUNK, t.size[2] - z0) })
    c = lazyChunk(`${s.serial}:${id}`, cx, cz, grid)
    s.chunks.set(id, c)
    if (s.chunks.size > MAX_CHUNKS) for (const k of [...s.chunks.keys()].slice(0, MAX_CHUNKS / 3)) s.chunks.delete(k)
  }
  return c
}

function lazyChunk(id: string, cx: number, cz: number, grid: VoxelGrid): Chunk {
  let lazyColliders: Box[] | null = null
  return {
    id,
    cx,
    cz,
    grid,
    get colliders() {
      return (lazyColliders ??= voxelColliders(grid))
    },
  }
}

/** The chunk at (cx, cz), generated on first use (with the world's edits on top); null outside the world's footprint. */
export function getChunk(t: Terrain, cx: number, cz: number): Chunk | null {
  const [nx, nz] = chunkCounts(t)
  if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) return null
  const s = storeFor(t)
  const id = `${cx},${cz}`
  const base = baseChunk(t, s, cx, cz, id)
  const ix = editIndex && editIndex.terrainKey === s.key ? editIndex : null
  const rev = ix?.rev.get(id)
  if (!ix || rev === undefined) return base
  const vid = `${base.id}:r${rev}`
  const hit = s.edited.get(id)
  if (hit?.id === vid) return hit
  const edits = ix.byChunk.get(id)
  const c = lazyChunk(vid, cx, cz, edits ? withEdits(base.grid, edits) : base.grid)
  s.edited.set(id, c)
  if (s.edited.size > MAX_CHUNKS) for (const k of [...s.edited.keys()].slice(0, MAX_CHUNKS / 3)) s.edited.delete(k)
  return c
}

/** Cell value at a global cell: `edited` = what the world shows now, otherwise what the generator made. */
export function terrainCellAt(t: Terrain, gi: number, j: number, gk: number, edited = true): number {
  const cx = Math.floor(gi / CHUNK), cz = Math.floor(gk / CHUNK)
  const c = edited ? getChunk(t, cx, cz) : (() => {
    const [nx, nz] = chunkCounts(t)
    return cx < 0 || cz < 0 || cx >= nx || cz >= nz ? null : baseChunk(t, storeFor(t), cx, cz, `${cx},${cz}`)
  })()
  return c ? cellAt(c.grid, gi - cx * CHUNK, j, gk - cz * CHUNK) : 0
}

/** Valid chunk coordinates within `r` chunks of (cx, cz), sorted nearest-first without generating chunks yet. */
export function chunkCoordsAround(t: Terrain, cx: number, cz: number, r: number): Array<[number, number]> {
  const [nx, nz] = chunkCounts(t)
  const out: Array<[number, number]> = []
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx
      const z = cz + dz
      if (x >= 0 && z >= 0 && x < nx && z < nz) out.push([x, z])
    }
  }
  return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz))
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

const shapeOf = new WeakMap<object, string>()
/** Same ground, maybe drawn differently (a block flipped smooth ↔ blocks, M5e): the planner's ghost is then not a different terrain. */
export function sameTerrainShape(a: Terrain | null | undefined, b: Terrain | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const key = (t: Terrain) => { let k = shapeOf.get(t); if (!k) { k = terrainShapeKey(t); shapeOf.set(t, k) } return k }
  return key(a) === key(b)
}

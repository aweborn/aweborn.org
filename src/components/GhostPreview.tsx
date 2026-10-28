import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { usePlannerStore } from '../stores/plannerStore'
import { useWorldStore } from '../stores/worldStore'
import { chunkCoordsAround, getChunk, placeOnTerrain, sameTerrainShape, useTerrainEditsRev, useWorldLoadProgress, type Chunk } from '../stores/worldVoxels'
import { useUniverseStore } from '../stores/universeStore'
import { usePlayerChunk } from '../hooks/usePlayerChunk'
import { useAtmosphere } from '../hooks/useAtmosphere'
import { cellAt, CHUNK } from '@aweborn/shared/voxel'
import { buildChunkMesh, kindOf, AIR, type ChunkMesh, type OutsideLookup } from '@aweborn/shared/voxelMesh'
import { buildSmoothMesh, type RawLookup } from '@aweborn/shared/surfaceNets'
import type { BlueprintAsset, BlueprintDraft } from '@aweborn/shared/blueprint'

/**
 * Ghost preview (Phase 07): the blueprint, standing in the world.
 * Voxel terrain is real (one face-culled mesh per chunk, walkable); planned
 * assets are wireframe "dreams" with their name, until manifested.
 */

const col = new THREE.Color()

// Shared by every chunk: one shader program each, no per-chunk material churn.
// Solid ground is Lambert (2026-10-21): it looked the same as rough PBR here and
// costs far less per pixel on phones.
const SOLID_MAT = new THREE.MeshLambertMaterial({ vertexColors: true })
const LIQUID_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.1 })
const GHOST_SOLID_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, roughness: 0.6, emissive: '#8f7bff', emissiveIntensity: 0.35 })
const GHOST_LIQUID_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.3, roughness: 0.6, emissive: '#8f7bff', emissiveIntensity: 0.35 })

/** Cache built chunk geometries so walking across chunk boundaries reuses GPU buffers instead of rebuilding meshes. */
const MAX_GEO_CACHE = 400
const chunkGeoCache = new Map<string, THREE.BufferGeometry | null>()

/** Which layer of a chunk: block faces, liquid, or smooth surfaces (M5e). */
export type ChunkLayerKind = 'solid' | 'liquid' | 'smooth'

function getChunkGeometry(chunk: Chunk, terrain: BlueprintDraft['terrain'], layer: ChunkLayerKind): THREE.BufferGeometry | null {
  const key = `${chunk.id}:${layer === 'liquid' ? 'L' : layer === 'smooth' ? 'M' : 'S'}`
  if (chunkGeoCache.has(key)) return chunkGeoCache.get(key) ?? null

  const g = chunk.grid
  const [sx, , sz] = g.size
  const color = (v: number, gi: number, j: number, gk: number) => cellColor(g.blocks[v - 1].color, gi, j, gk)
  let m: ChunkMesh
  if (layer === 'smooth') {
    // Smooth surfaces read 2 cells past the chunk (any neighbour, diagonals too): global lookup.
    const raw: RawLookup = (i, j, k) => {
      const gi = g.origin[0] + i, gk = g.origin[1] + k
      const n = getChunk(terrain, Math.floor(gi / CHUNK), Math.floor(gk / CHUNK))
      return n ? cellAt(n.grid, gi - n.grid.origin[0], j, gk - n.grid.origin[1]) : 0
    }
    m = buildSmoothMesh(g, raw, color)
  } else {
    // Faces on the chunk edge ask the neighbouring chunk (generated once, cached).
    const outside: OutsideLookup = (i, j, k) => {
      const dx = i < 0 ? -1 : i >= sx ? 1 : 0
      const dz = k < 0 ? -1 : k >= sz ? 1 : 0
      const n = getChunk(terrain, chunk.cx + dx, chunk.cz + dz)
      if (!n) return AIR // the world's edge
      const [nx, , nz] = n.grid.size
      return kindOf(n.grid, cellAt(n.grid, dx < 0 ? nx - 1 : dx > 0 ? 0 : i, j, dz < 0 ? nz - 1 : dz > 0 ? 0 : k))
    }
    m = buildChunkMesh(g, layer === 'liquid', outside, color)
  }
  let geo: THREE.BufferGeometry | null = null
  if (m.faces) {
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3))
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
    geo.computeBoundingSphere()
  }
  chunkGeoCache.set(key, geo)
  if (chunkGeoCache.size > MAX_GEO_CACHE) {
    const oldest = chunkGeoCache.keys().next().value
    if (oldest !== undefined) {
      chunkGeoCache.get(oldest)?.dispose()
      chunkGeoCache.delete(oldest)
    }
  }
  return geo
}

/** Linear RGB with a slight per-cell shade so flat areas still read as blocks. */
function cellColor(hex: string, gi: number, j: number, gk: number): [number, number, number] {
  const shade = 0.78 + 0.22 * (((gi * 7 + gk * 13 + j * 5) % 5) / 4) * (0.85 + 0.15 * ((gi + gk) % 2))
  col.set(hex).multiplyScalar(shade)
  return [col.r, col.g, col.b]
}

/**
 * One layer (solid, liquid or smooth) of a chunk: only the faces that border air (2026-10-21).
 * It used to be a full instanced cube per visible voxel: ~7× the triangles, ~86%
 * of them buried against a neighbour, which made phones drop frames when facing
 * big terrain (a volcano) or with the camera inside the ground.
 */
export function ChunkLayer({ chunk, terrain, layer, ghost }: { chunk: Chunk; terrain: BlueprintDraft['terrain']; layer: ChunkLayerKind; ghost?: boolean }) {
  const geometry = useMemo(() => getChunkGeometry(chunk, terrain, layer), [chunk, terrain, layer])

  if (!geometry) return null
  const liquid = layer === 'liquid'
  const material = ghost ? (liquid ? GHOST_LIQUID_MAT : GHOST_SOLID_MAT) : liquid ? LIQUID_MAT : SOLID_MAT
  return <mesh geometry={geometry} material={material} />
}

/**
 * The chunks around the player, drawn solid + liquid. Past this radius it's beyond the fog.
 * Builds the inner 3×3 chunks immediately so the player stands on solid ground on frame 1,
 * then streams outer ring chunks across animation frames so world entry never freezes input.
 */
function TerrainChunks({ terrain, ghost }: { terrain: BlueprintDraft['terrain']; ghost?: boolean }) {
  const atmosphere = useAtmosphere()
  const radius = atmosphere?.radius ?? 3
  const [cx, cz] = usePlayerChunk(terrain)
  const coords = useMemo(() => chunkCoordsAround(terrain, cx, cz, radius), [terrain, cx, cz, radius])
  const initialBatch = Math.min(9, coords.length)
  const [visibleCount, setVisibleCount] = useState(initialBatch)
  // Dig/fill edits (M5d): edited chunks come back with a new id, so only they rebuild.
  const editsRev = useTerrainEditsRev((s) => s.rev)

  useEffect(() => {
    setVisibleCount(Math.min(9, coords.length))
  }, [terrain, coords.length])

  useEffect(() => {
    if (!ghost) {
      useWorldLoadProgress.getState().setChunkProgress(Math.min(visibleCount, coords.length), coords.length)
    }
    if (visibleCount >= coords.length) return
    const raf = requestAnimationFrame(() => {
      setVisibleCount((n) => Math.min(coords.length, n + 3))
    })
    return () => cancelAnimationFrame(raf)
  }, [visibleCount, coords.length, ghost])

  const chunks = useMemo(() => {
    const slice = coords.slice(0, visibleCount)
    const out: Chunk[] = []
    for (const [x, z] of slice) {
      const c = getChunk(terrain, x, z)
      if (c) out.push(c)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editsRev: getChunk reads the edit overlay
  }, [terrain, coords, visibleCount, editsRev])

  return (
    <>
      {chunks.map((c) => (
        <group key={c.id}>
          <ChunkLayer chunk={c} terrain={terrain} layer="solid" ghost={ghost} />
          <ChunkLayer chunk={c} terrain={terrain} layer="smooth" ghost={ghost} />
          <ChunkLayer chunk={c} terrain={terrain} layer="liquid" ghost={ghost} />
        </group>
      ))}
    </>
  )
}

/** Materialize-in: terrain rises from the floor when a new version lands. */
function Rise({ version, children }: { version: number; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null!)
  const t = useRef(0)
  useEffect(() => {
    t.current = 0
  }, [version])
  useFrame((_, dt) => {
    if (t.current >= 1) return
    t.current = Math.min(1, t.current + dt * 1.6)
    const e = 1 - Math.pow(1 - t.current, 3)
    g.current.scale.y = Math.max(0.001, e)
  })
  return <group ref={g}>{children}</group>
}

function GhostAsset({ asset, terrain, color }: { asset: BlueprintAsset; terrain: BlueprintDraft['terrain']; color: string }) {
  const ref = useRef<THREE.Group>(null!)
  const pos = placeOnTerrain(terrain, asset.at ?? [terrain.size[0] / 2, 0, terrain.size[2] / 2])
  const [w, h, d] = asset.size ?? [1.5, 1.5, 1.5]
  const seed = useMemo(() => [...asset.key].reduce((a, c) => a + c.charCodeAt(0), 0), [asset.key])
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime + seed
    g.position.y = pos.y + h / 2 + Math.sin(t * 1.2) * 0.06
    g.rotation.y = (asset.rotationY ?? 0) + Math.sin(t * 0.4) * 0.05
  })
  return (
    <group ref={ref} position={[pos.x, pos.y + h / 2, pos.z]}>
      <mesh scale={[w, h, d]}>
        <boxGeometry args={[1, 1, 1, 2, 2, 2]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.55} />
      </mesh>
      <mesh scale={[w * 0.98, h * 0.98, d * 0.98]}>
        <boxGeometry />
        <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      <Html position={[0, h / 2 + 0.35, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
        <span className="ghost-label">{asset.key.replace(/-/g, ' ')}</span>
      </Html>
    </group>
  )
}

/** Manifested terrain from the World CRDT: solid for everyone in the world. (Light comes from WorldInterior's atmosphere.) */
export function WorldTerrain() {
  const terrain = useWorldStore((s) => s.voxelTerrain)
  if (!terrain) return null
  return <TerrainChunks terrain={terrain} />
}

export function GhostPreview() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const { worldId, blueprint, visible } = usePlannerStore()
  const worldTerrain = useWorldStore((s) => s.voxelTerrain)
  const objects = useWorldStore((s) => s.objects)
  const placed = useMemo(() => new Set([...objects.values()].map((o) => o.planKey).filter(Boolean)), [objects])
  const planTerrain = blueprint?.terrain
  // Real when only the drawing differs (a block flipped smooth ↔ blocks in the world, M5e)
  const terrainIsReal = useMemo(() => sameTerrainShape(worldTerrain, planTerrain), [worldTerrain, planTerrain])
  if (!blueprint || !visible || worldId !== activeWorldId) return null
  const accent = blueprint.style.palette[1] ?? blueprint.style.palette[0] ?? '#b8a8ff'
  return (
    <group>
      {!terrainIsReal && (
        <Rise version={blueprint.version}>
          <TerrainChunks terrain={blueprint.terrain} ghost />
        </Rise>
      )}
      {blueprint.assets
        .filter((a) => (a.kind === 'model' || a.kind === 'terrain-piece') && !placed.has(`${blueprint.id}:${a.key}`))
        .map((a) => (
          <GhostAsset key={a.key} asset={a} terrain={blueprint.terrain} color={accent} />
        ))}
    </group>
  )
}

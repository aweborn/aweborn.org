import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { usePlannerStore } from '../stores/plannerStore'
import { useWorldStore } from '../stores/worldStore'
import { chunksAround, getChunk, placeOnTerrain, sameTerrain, type Chunk } from '../stores/worldVoxels'
import { useUniverseStore } from '../stores/universeStore'
import { usePlayerChunk } from '../hooks/usePlayerChunk'
import { useAtmosphere } from '../hooks/useAtmosphere'
import { cellAt } from '@aweborn/shared/voxel'
import { buildChunkMesh, kindOf, AIR, type OutsideLookup } from '@aweborn/shared/voxelMesh'
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

/** Linear RGB with a slight per-cell shade so flat areas still read as blocks. */
function cellColor(hex: string, gi: number, j: number, gk: number): [number, number, number] {
  const shade = 0.78 + 0.22 * (((gi * 7 + gk * 13 + j * 5) % 5) / 4) * (0.85 + 0.15 * ((gi + gk) % 2))
  col.set(hex).multiplyScalar(shade)
  return [col.r, col.g, col.b]
}

/**
 * One layer (solid or liquid) of a chunk: only the faces that border air (2026-10-21).
 * It used to be a full instanced cube per visible voxel: ~7× the triangles, ~86%
 * of them buried against a neighbour, which made phones drop frames when facing
 * big terrain (a volcano) or with the camera inside the ground.
 */
export function ChunkLayer({ chunk, terrain, liquid, ghost }: { chunk: Chunk; terrain: BlueprintDraft['terrain']; liquid: boolean; ghost?: boolean }) {
  const geometry = useMemo(() => {
    const g = chunk.grid
    const [sx, , sz] = g.size
    // Faces on the chunk edge ask the neighbouring chunk (generated once, cached).
    const outside: OutsideLookup = (i, j, k) => {
      const dx = i < 0 ? -1 : i >= sx ? 1 : 0
      const dz = k < 0 ? -1 : k >= sz ? 1 : 0
      const n = getChunk(terrain, chunk.cx + dx, chunk.cz + dz)
      if (!n) return AIR // the world's edge
      const [nx, , nz] = n.grid.size
      return kindOf(n.grid, cellAt(n.grid, dx < 0 ? nx - 1 : dx > 0 ? 0 : i, j, dz < 0 ? nz - 1 : dz > 0 ? 0 : k))
    }
    const m = buildChunkMesh(g, liquid, outside, (v, gi, j, gk) => cellColor(g.blocks[v - 1].color, gi, j, gk))
    if (!m.faces) return null
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3))
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1))
    geo.computeBoundingSphere()
    return geo
  }, [chunk, terrain, liquid])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  const material = ghost ? (liquid ? GHOST_LIQUID_MAT : GHOST_SOLID_MAT) : liquid ? LIQUID_MAT : SOLID_MAT
  return <mesh geometry={geometry} material={material} />
}

/** The chunks around the player, drawn solid + liquid. Past this radius it's beyond the fog. */
function TerrainChunks({ terrain, ghost }: { terrain: BlueprintDraft['terrain']; ghost?: boolean }) {
  const atmosphere = useAtmosphere()
  const radius = atmosphere?.radius ?? 3
  const [cx, cz] = usePlayerChunk(terrain)
  const chunks = useMemo(() => chunksAround(terrain, cx, cz, radius), [terrain, cx, cz, radius])
  return (
    <>
      {chunks.map((c) => (
        <group key={c.id}>
          <ChunkLayer chunk={c} terrain={terrain} liquid={false} ghost={ghost} />
          <ChunkLayer chunk={c} terrain={terrain} liquid ghost={ghost} />
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
  if (!blueprint || !visible || worldId !== activeWorldId) return null
  const accent = blueprint.style.palette[1] ?? blueprint.style.palette[0] ?? '#b8a8ff'
  const terrainIsReal = sameTerrain(worldTerrain, blueprint.terrain)
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

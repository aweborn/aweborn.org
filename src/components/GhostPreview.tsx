import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { usePlannerStore } from '../stores/plannerStore'
import { useWorldStore } from '../stores/worldStore'
import { chunksAround, placeOnTerrain, sameTerrain } from '../stores/worldVoxels'
import { useUniverseStore } from '../stores/universeStore'
import { usePlayerChunk } from '../hooks/usePlayerChunk'
import { useAtmosphere } from '../hooks/useAtmosphere'
import { visibleCells, type VoxelGrid } from '@aweborn/shared/voxel'
import type { BlueprintAsset, BlueprintDraft } from '@aweborn/shared/blueprint'

/**
 * Ghost preview (Phase 07): the blueprint, standing in the world.
 * Voxel terrain is real (instanced cubes, walkable); planned assets are
 * wireframe "dreams" with their name, until manifested.
 */

const cube = new THREE.BoxGeometry(1, 1, 1)
const tmp = new THREE.Object3D()
const col = new THREE.Color()

export function VoxelLayer({ grid, liquid, ghost }: { grid: VoxelGrid; liquid: boolean; ghost?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const cells = useMemo(
    () => visibleCells(grid).filter((c) => grid.liquid[c.v - 1] === liquid),
    [grid, liquid],
  )
  const [ox, oz] = [grid.origin[0] - grid.world[0] / 2, grid.origin[1] - grid.world[1] / 2]

  useEffect(() => {
    const m = ref.current
    if (!m) return
    cells.forEach((c, n) => {
      const h = liquid ? 0.85 : 1
      tmp.position.set(ox + c.i + 0.5, c.j + h / 2, oz + c.k + 0.5)
      tmp.scale.set(1, h, 1)
      tmp.updateMatrix()
      m.setMatrixAt(n, tmp.matrix)
      // Slight per-cell shade so flat areas still read as blocks
      const gi = grid.origin[0] + c.i, gk = grid.origin[1] + c.k
      const shade = 0.78 + 0.22 * (((gi * 7 + gk * 13 + c.j * 5) % 5) / 4) * (0.85 + 0.15 * ((gi + gk) % 2))
      col.set(grid.blocks[c.v - 1].color).multiplyScalar(shade)
      m.setColorAt(n, col)
    })
    m.count = cells.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
      ; (m.material as THREE.Material).needsUpdate = true // shader must pick up instanceColor
    m.computeBoundingSphere()
  }, [cells, grid, liquid, ox, oz])

  if (!cells.length) return null
  return (
    <instancedMesh ref={ref} args={[cube, undefined, cells.length]}>
      {ghost ? (
        // A preview, not real ground yet: see-through with a faint violet glow
        <meshStandardMaterial transparent opacity={liquid ? 0.3 : 0.45} roughness={0.6} emissive="#8f7bff" emissiveIntensity={0.35} />
      ) : liquid ? (
        <meshStandardMaterial transparent opacity={0.6} roughness={0.1} metalness={0.1} />
      ) : (
        <meshStandardMaterial roughness={0.85} />
      )}
    </instancedMesh>
  )
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
          <VoxelLayer grid={c.grid} liquid={false} ghost={ghost} />
          <VoxelLayer grid={c.grid} liquid ghost={ghost} />
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

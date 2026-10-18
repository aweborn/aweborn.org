import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { usePlannerStore } from '../stores/plannerStore'
import { useWorldStore } from '../stores/worldStore'
import { worldVoxels, sameTerrain } from '../stores/worldVoxels'
import { useUniverseStore } from '../stores/universeStore'
import { visibleCells, cellToWorld, type VoxelGrid } from '@aweborn/shared/voxel'
import type { BlueprintAsset } from '@aweborn/shared/blueprint'

/**
 * Ghost preview (Phase 07): the blueprint, standing in the world.
 * Voxel terrain is real (instanced cubes, walkable); planned assets are
 * wireframe "dreams" with their name, until manifested.
 */

const cube = new THREE.BoxGeometry(1, 1, 1)
const tmp = new THREE.Object3D()
const col = new THREE.Color()

export function VoxelLayer({ grid, liquid }: { grid: VoxelGrid; liquid: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  const cells = useMemo(
    () => visibleCells(grid).filter((c) => grid.liquid[c.v - 1] === liquid),
    [grid, liquid],
  )
  const [sx, , sz] = grid.size

  useEffect(() => {
    const m = ref.current
    if (!m) return
    cells.forEach((c, n) => {
      const h = liquid ? 0.85 : 1
      tmp.position.set(c.i - sx / 2 + 0.5, c.j + h / 2, c.k - sz / 2 + 0.5)
      tmp.scale.set(1, h, 1)
      tmp.updateMatrix()
      m.setMatrixAt(n, tmp.matrix)
      // Slight per-cell shade so flat areas still read as blocks
      const shade = 0.9 + 0.1 * (((c.i * 7 + c.k * 13 + c.j * 5) % 5) / 4)
      col.set(grid.blocks[c.v - 1].color).multiplyScalar(shade)
      m.setColorAt(n, col)
    })
    m.count = cells.length
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    ;(m.material as THREE.Material).needsUpdate = true // shader must pick up instanceColor
    m.computeBoundingSphere()
  }, [cells, grid, liquid, sx, sz])

  if (!cells.length) return null
  return (
    <instancedMesh ref={ref} args={[cube, undefined, cells.length]} frustumCulled={false}>
      {liquid ? (
        <meshStandardMaterial transparent opacity={0.6} roughness={0.1} metalness={0.1} />
      ) : (
        <meshStandardMaterial roughness={0.85} />
      )}
    </instancedMesh>
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

function GhostAsset({ asset, grid, color }: { asset: BlueprintAsset; grid: VoxelGrid; color: string }) {
  const ref = useRef<THREE.Group>(null!)
  const pos = cellToWorld(grid, asset.at ?? [grid.size[0] / 2, 0, grid.size[2] / 2])
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

/** Manifested terrain from the World CRDT: solid for everyone in the world. */
export function WorldTerrain() {
  const terrain = useWorldStore((s) => s.voxelTerrain)
  const v = worldVoxels(terrain)
  if (!v) return null
  return (
    <group>
      <VoxelLayer grid={v.grid} liquid={false} />
      <VoxelLayer grid={v.grid} liquid />
    </group>
  )
}

export function GhostPreview() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const { worldId, blueprint, grid, visible } = usePlannerStore()
  const worldTerrain = useWorldStore((s) => s.voxelTerrain)
  const objects = useWorldStore((s) => s.objects)
  const placed = useMemo(() => new Set([...objects.values()].map((o) => o.planKey).filter(Boolean)), [objects])
  if (!blueprint || !grid || !visible || worldId !== activeWorldId) return null
  const accent = blueprint.style.palette[1] ?? blueprint.style.palette[0] ?? '#b8a8ff'
  const terrainIsReal = sameTerrain(worldTerrain, blueprint.terrain)
  return (
    <group>
      {!terrainIsReal && (
        <Rise version={blueprint.version}>
          <VoxelLayer grid={grid} liquid={false} />
          <VoxelLayer grid={grid} liquid />
        </Rise>
      )}
      {blueprint.assets
        .filter((a) => (a.kind === 'model' || a.kind === 'terrain-piece') && !placed.has(`${blueprint.id}:${a.key}`))
        .map((a) => (
          <GhostAsset key={a.key} asset={a} grid={grid} color={accent} />
        ))}
    </group>
  )
}

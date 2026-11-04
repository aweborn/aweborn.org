import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { placeOnTerrain } from '../stores/worldVoxels'
import { interiorController } from '../systems/InteriorController'
import { useMakingOf, loadMakingOf, openMakingOf } from '../stores/makingOfStore'
import { hasMakingOf } from '@aweborn/shared/making-of'
import './MakingOfPanel.css'

/**
 * The story stone (Alex, 2026-11-02): a standing stone a few steps ahead-left of the spawn
 * point in every world that was planned. Tap it (or its label) to read the whole planner
 * conversation that made the world (MakingOfPanel). It's part of the place, like a plaque
 * by a door: always there, outside the HUD.
 */

/** Ahead and a little left of the spawn point (0, 8, facing −z): in view on arrival even in portrait (60° vertical fov ≈ 30° across). */
const STORY_STONE_XZ = { x: -1.5, z: 2 } as const
/** The label appears within this distance; the stone itself is visible as far as the fog allows. */
const LABEL_M = 20

const STONE_GEO = new THREE.CylinderGeometry(0.36, 0.52, 1.7, 6, 1)
const CAP_GEO = new THREE.OctahedronGeometry(0.16, 0)
const RUNE_GEO = new THREE.TorusGeometry(0.47, 0.025, 6, 6)
const STONE_MAT = new THREE.MeshLambertMaterial({ color: '#4a4560', emissive: '#1a1030', emissiveIntensity: 0.6, flatShading: true })
const GLOW = new THREE.Color('#c9a6ff')

export function MakingOfStone() {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const loaded = useWorldStore((s) => s.loaded)
  const terrain = useWorldStore((s) => s.voxelTerrain)
  const data = useMakingOf((s) => (s.worldId === worldId ? s.data : null))
  const [near, setNear] = useState(false)
  const rune = useRef<THREE.Mesh>(null!)
  const cap = useRef<THREE.Mesh>(null!)
  const runeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.8 }), [])
  useEffect(() => () => runeMat.dispose(), [runeMat])

  useEffect(() => {
    if (worldId && loaded) void loadMakingOf(worldId)
  }, [worldId, loaded])

  const base = useMemo(() => {
    const { x, z } = STORY_STONE_XZ
    const y = terrain ? placeOnTerrain(terrain, [x + terrain.size[0] / 2, 0, z + terrain.size[2] / 2]).y : 0
    return { x, y, z }
  }, [terrain])

  const sessions = data?.sessions.length ?? 0
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (rune.current) {
      rune.current.rotation.z = t * 0.3
      runeMat.opacity = 0.55 + Math.sin(t * 1.3) * 0.25
    }
    if (cap.current) {
      cap.current.position.y = 2.05 + Math.sin(t * 1.1) * 0.06
      cap.current.rotation.y = t * 0.6
    }
    const s = interiorController.state
    const n = Math.hypot(s.x - base.x, s.z - base.z) < LABEL_M
    if (n !== near) setNear(n)
  })

  if (!worldId || !loaded || !hasMakingOf(data)) return null

  const open = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return // a drag to look around, not a tap
    e.stopPropagation()
    openMakingOf()
  }

  return (
    <group position={[base.x, base.y, base.z]} rotation={[0, 0.5, 0]}>
      <mesh geometry={STONE_GEO} material={STONE_MAT} position={[0, 0.85, 0]} onClick={open} />
      <mesh ref={rune} geometry={RUNE_GEO} material={runeMat} position={[0, 1.15, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh ref={cap} geometry={CAP_GEO} material={runeMat} position={[0, 2.05, 0]} onClick={open} />
      {near && (
        <Html position={[0, 2.5, 0]} center distanceFactor={9} zIndexRange={[12, 0]} style={{ userSelect: 'none', whiteSpace: 'nowrap' }}>
          <button type="button" className="story-stone-label" onClick={openMakingOf}>
            <span className="story-stone-label__name">📜 How this world was made</span>
            <span className="story-stone-label__hint">
              {sessions === 1 ? 'Read the conversation' : `Read ${sessions} conversations`}
            </span>
          </button>
        </Html>
      )}
    </group>
  )
}

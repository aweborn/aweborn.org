import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useUniverseStore } from '../stores/universeStore'
import type { WorldEntry } from '@aweborn/shared/crdt-schema'

/**
 * Renders all worlds from the Universe CRDT as glowing orbs in the 3D scene.
 *
 * Positions are normalized from CRDT space (hundreds of units) into the
 * scene's visible area (~15 unit radius). Phase 03 will replace this with
 * proper LOD-based rendering and data-driven visuals.
 */

const SCENE_RADIUS = 12 // Max distance from origin in the scene
const CRDT_SCALE = 500  // Approximate range of CRDT positions

/** Map a CRDT world position into the scene's coordinate space. */
function worldToScene(pos: { x: number; y: number; z: number }): [number, number, number] {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return [
    pos.x * scale,
    pos.y * scale + 1, // Lift worlds above the fog plane
    pos.z * scale - 8, // Push into the scene depth (camera is at z=10)
  ]
}

/** Single world orb — glowing sphere with pulsing animation. */
function WorldOrb({ world }: { world: WorldEntry }) {
  const groupRef = useRef<THREE.Group>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const outerRef = useRef<THREE.Mesh>(null!)

  const color = useMemo(() => new THREE.Color(world.color), [world.color])
  const scenePos = useMemo(() => worldToScene(world.resolvedPosition), [world.resolvedPosition])

  // Unique animation offset per world (deterministic from ID)
  const offset = useMemo(() => {
    let hash = 0
    for (let i = 0; i < world.id.length; i++) {
      hash = (hash << 5) - hash + world.id.charCodeAt(i)
    }
    return (hash & 0xffff) / 0xffff * Math.PI * 2
  }, [world.id])

  useFrame((state) => {
    const t = state.clock.elapsedTime + offset

    // Gentle bob
    if (groupRef.current) {
      groupRef.current.position.y = scenePos[1] + Math.sin(t * 0.8) * 0.15
    }

    // Pulsing inner glow
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 1.2 + Math.sin(t * 1.5) * 0.4
    }

    // Outer halo rotation
    if (outerRef.current) {
      outerRef.current.rotation.y = t * 0.3
      outerRef.current.rotation.z = t * 0.2
      const mat = outerRef.current.material as THREE.MeshStandardMaterial
      mat.opacity = 0.2 + Math.sin(t * 1.2) * 0.08
    }
  })

  const size = world.solidified ? 0.6 : 0.4 // Ghost worlds are slightly smaller

  return (
    <Float speed={0.6} rotationIntensity={0.1} floatIntensity={0.3}>
      <group ref={groupRef} position={scenePos}>
        {/* Inner glowing core */}
        <mesh ref={glowRef}>
          <sphereGeometry args={[size, 32, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={1.4}
            roughness={0.2}
            metalness={0.3}
            transparent
            opacity={world.solidified ? 0.95 : 0.7}
            toneMapped={false}
          />
        </mesh>

        {/* Outer halo */}
        <mesh ref={outerRef}>
          <sphereGeometry args={[size * 2.0, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.8}
            transparent
            opacity={0.2}
            depthWrite={false}
            toneMapped={false}
            side={THREE.BackSide}
          />
        </mesh>

        {/* Orbital ring */}
        <mesh rotation={[Math.PI * 0.4, 0, offset]}>
          <torusGeometry args={[size * 2.5, 0.02, 8, world.solidified ? 64 : 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={1.0}
            transparent
            opacity={0.4}
            toneMapped={false}
          />
        </mesh>

        {/* HTML label (always faces camera, no font loading issues) */}
        <Html
          position={[0, size + 0.3, 0]}
          center
          distanceFactor={8}
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{
            color: 'white',
            fontSize: '13px',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 600,
            textShadow: '0 0 8px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.6)',
            textAlign: 'center',
            lineHeight: 1.3,
          }}>
            <div>{world.name}</div>
            <div style={{
              fontSize: '10px',
              fontWeight: 400,
              color: world.solidified ? '#e8b94a' : '#888',
            }}>
              {world.solidified ? '✨ solid' : '👻 ghost'}
            </div>
          </div>
        </Html>

        {/* Point light emanating from the world */}
        <pointLight
          color={color}
          intensity={world.solidified ? 2.0 : 0.8}
          distance={6}
          decay={2}
        />
      </group>
    </Float>
  )
}

/** Renders all worlds from the universe store. */
export function UniverseWorlds() {
  const worlds = useUniverseStore((s) => s.worlds)
  const worldList = useMemo(() => Array.from(worlds.values()), [worlds])

  if (worldList.length === 0) return null

  return (
    <group>
      {worldList.map((w) => (
        <WorldOrb key={w.id} world={w} />
      ))}
    </group>
  )
}

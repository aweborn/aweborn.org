import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Float, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useUniverseStore } from '../stores/universeStore'
import type { WorldEntry } from '@aweborn/shared/crdt-schema'
import {
  createWorldGlowMaterial,
  createHaloMaterial,
} from '../shaders/worldGlow'
import {
  createGhostMaterial,
  createGhostWireframeMaterial,
} from '../shaders/ghostShader'

/**
 * Renders all worlds from the Universe CRDT as 3D objects with LOD.
 *
 * LOD tiers (distances relative to normalized scene coordinates):
 *  - Close (< 5 units):  Full mesh with glow shader, halo, ring, label, point light
 *  - Medium (5-12 units): Billboard sprite with color glow
 *  - Far (12+ units):    Batched THREE.Points — single draw call
 *
 * Ghost worlds use the ethereal wireframe shader instead of the solid glow.
 */

// ── Scale constants ──────────────────────────────────────────────────
const SCENE_RADIUS = 14       // Max distance from origin in the scene
const CRDT_SCALE = 500        // Approximate range of CRDT positions
const CLOSE_DIST = 5          // Full mesh LOD
const MEDIUM_DIST = 12        // Billboard LOD

/** Map a CRDT world position into the scene's coordinate space. */
function worldToScene(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return new THREE.Vector3(
    pos.x * scale,
    pos.y * scale + 1,       // Lift above fog plane
    pos.z * scale - 8,       // Push into scene depth
  )
}

/** Deterministic hash from string → [0, 1) */
function hashString(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i)
  }
  return ((hash & 0xffff) / 0xffff)
}

// ── Close LOD: Full World Orb ────────────────────────────────────────

function WorldOrbClose({ world }: { world: WorldEntry }) {
  const groupRef = useRef<THREE.Group>(null!)
  const glowMatRef = useRef<THREE.ShaderMaterial>(null!)
  const haloMatRef = useRef<THREE.ShaderMaterial>(null!)
  const ghostMatRef = useRef<THREE.ShaderMaterial>(null!)

  const color = useMemo(() => new THREE.Color(world.color), [world.color])
  const scenePos = useMemo(() => worldToScene(world.resolvedPosition), [world.resolvedPosition])
  const offset = useMemo(() => hashString(world.id) * Math.PI * 2, [world.id])
  const size = world.solidified ? 0.55 : 0.4

  // Create shader materials
  const glowMat = useMemo(() => createWorldGlowMaterial({
    color,
    intensity: world.solidified ? 1.6 : 0.8,
    ghost: !world.solidified,
  }), [color, world.solidified])

  const haloMat = useMemo(() => createHaloMaterial(
    color,
    world.solidified ? 0.35 : 0.15,
  ), [color, world.solidified])

  const ghostMat = useMemo(() => !world.solidified
    ? createGhostMaterial({ color })
    : null, [color, world.solidified])

  const wireframeMat = useMemo(() => !world.solidified
    ? createGhostWireframeMaterial(color)
    : null, [color, world.solidified])

  useEffect(() => {
    glowMatRef.current = glowMat
    haloMatRef.current = haloMat
    if (ghostMat) ghostMatRef.current = ghostMat
  }, [glowMat, haloMat, ghostMat])

  // Dispose materials on unmount
  useEffect(() => {
    return () => {
      glowMat.dispose()
      haloMat.dispose()
      ghostMat?.dispose()
      wireframeMat?.dispose()
    }
  }, [glowMat, haloMat, ghostMat, wireframeMat])

  useFrame((state) => {
    const t = state.clock.elapsedTime + offset

    // Bob animation
    if (groupRef.current) {
      groupRef.current.position.y = scenePos.y + Math.sin(t * 0.8) * 0.12
    }

    // Update shader time uniforms
    if (glowMatRef.current) glowMatRef.current.uniforms.uTime.value = t
    if (haloMatRef.current) haloMatRef.current.uniforms.uTime.value = t
    if (ghostMatRef.current) ghostMatRef.current.uniforms.uTime.value = t
  })

  return (
    <Float speed={0.5} rotationIntensity={0.08} floatIntensity={0.2}>
      <group ref={groupRef} position={[scenePos.x, scenePos.y, scenePos.z]}>
        {/* Inner core — solid or ghost */}
        {world.solidified ? (
          <mesh material={glowMat}>
            <sphereGeometry args={[size, 32, 32]} />
          </mesh>
        ) : (
          <>
            {/* Ghost base */}
            {ghostMat && (
              <mesh material={ghostMat}>
                <sphereGeometry args={[size, 24, 24]} />
              </mesh>
            )}
            {/* Wireframe overlay */}
            {wireframeMat && (
              <mesh material={wireframeMat}>
                <icosahedronGeometry args={[size * 1.02, 2]} />
              </mesh>
            )}
          </>
        )}

        {/* Outer halo */}
        <mesh material={haloMat}>
          <sphereGeometry args={[size * 2.2, 16, 16]} />
        </mesh>

        {/* Orbital ring */}
        <mesh rotation={[Math.PI * 0.4, 0, offset]}>
          <torusGeometry args={[size * 2.5, 0.015, 8, world.solidified ? 64 : 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={world.solidified ? 0.5 : 0.2}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Name label */}
        <Html
          position={[0, size + 0.35, 0]}
          center
          distanceFactor={8}
          style={{ pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }}
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
              {world.playerCount > 0 && ` · ${world.playerCount} 👤`}
            </div>
          </div>
        </Html>

        {/* Point light */}
        <pointLight
          color={color}
          intensity={world.solidified ? 2.5 : 0.6}
          distance={5}
          decay={2}
        />
      </group>
    </Float>
  )
}

// ── Medium LOD: Billboard Sprite ─────────────────────────────────────

/** Pre-generated billboard texture (canvas) */
const billboardCanvas = (() => {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Radial gradient — bright center, transparent edge
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)')
  grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)')
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)')
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return canvas
})()

const billboardTexture = new THREE.CanvasTexture(billboardCanvas)

function WorldBillboard({ world }: { world: WorldEntry }) {
  const ref = useRef<THREE.Sprite>(null!)
  const scenePos = useMemo(() => worldToScene(world.resolvedPosition), [world.resolvedPosition])
  const color = useMemo(() => new THREE.Color(world.color), [world.color])
  const offset = useMemo(() => hashString(world.id) * Math.PI * 2, [world.id])

  const mat = useMemo(() => new THREE.SpriteMaterial({
    map: billboardTexture,
    color,
    transparent: true,
    opacity: world.solidified ? 0.8 : 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), [color, world.solidified])

  useEffect(() => () => { mat.dispose() }, [mat])

  useFrame((state) => {
    if (ref.current) {
      const t = state.clock.elapsedTime + offset
      const pulse = 0.8 + 0.2 * Math.sin(t * 1.5)
      const baseSize = world.solidified ? 0.8 : 0.5
      ref.current.scale.setScalar(baseSize * pulse)
    }
  })

  return (
    <sprite ref={ref} material={mat} position={[scenePos.x, scenePos.y, scenePos.z]} />
  )
}

// ── Far LOD: Batched Points ──────────────────────────────────────────

function WorldPoints({ worlds }: { worlds: WorldEntry[] }) {
  const ref = useRef<THREE.Points>(null!)

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(worlds.length * 3)
    const col = new Float32Array(worlds.length * 3)
    const tmpColor = new THREE.Color()

    worlds.forEach((w, i) => {
      const sp = worldToScene(w.resolvedPosition)
      pos[i * 3] = sp.x
      pos[i * 3 + 1] = sp.y
      pos[i * 3 + 2] = sp.z

      tmpColor.set(w.color)
      col[i * 3] = tmpColor.r
      col[i * 3 + 1] = tmpColor.g
      col[i * 3 + 2] = tmpColor.b
    })

    return { positions: pos, colors: col }
  }, [worlds])

  useFrame((state) => {
    if (ref.current) {
      // Subtle twinkle via opacity
      const mat = ref.current.material as THREE.PointsMaterial
      mat.opacity = 0.6 + 0.2 * Math.sin(state.clock.elapsedTime * 0.8)
    }
  })

  if (worlds.length === 0) return null

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.7}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// ── Aweborn Portal (Origin Star) ─────────────────────────────────────

function AwebornPortal() {
  const groupRef = useRef<THREE.Group>(null!)
  const innerRef = useRef<THREE.Mesh>(null!)

  const portalColor = useMemo(() => new THREE.Color('#e8b94a'), [])
  const glowMat = useMemo(() => createWorldGlowMaterial({
    color: portalColor,
    intensity: 2.5,
  }), [portalColor])

  const haloMat = useMemo(() => createHaloMaterial(portalColor, 0.5), [portalColor])

  useEffect(() => () => { glowMat.dispose(); haloMat.dispose() }, [glowMat, haloMat])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    glowMat.uniforms.uTime.value = t
    haloMat.uniforms.uTime.value = t

    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.1
    }
  })

  return (
    <group ref={groupRef} position={[0, 1, -8]}>
      {/* Bright core */}
      <mesh ref={innerRef} material={glowMat}>
        <sphereGeometry args={[0.8, 48, 48]} />
      </mesh>

      {/* Large halo */}
      <mesh material={haloMat}>
        <sphereGeometry args={[2.5, 24, 24]} />
      </mesh>

      {/* Double rings */}
      <mesh rotation={[Math.PI * 0.35, 0, 0]}>
        <torusGeometry args={[3.0, 0.02, 8, 128]} />
        <meshBasicMaterial
          color={portalColor}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI * 0.55, Math.PI * 0.3, 0]}>
        <torusGeometry args={[2.2, 0.015, 8, 96]} />
        <meshBasicMaterial
          color="#6b3fa0"
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Label */}
      <Html
        position={[0, 1.3, 0]}
        center
        distanceFactor={8}
        style={{ pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        <div style={{
          color: '#e8b94a',
          fontSize: '15px',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 700,
          textShadow: '0 0 12px rgba(232,185,74,0.8), 0 0 30px rgba(0,0,0,0.8)',
          letterSpacing: '0.1em',
        }}>
          AWEBORN
        </div>
      </Html>

      {/* Bright point light */}
      <pointLight color={portalColor} intensity={4} distance={12} decay={2} />
    </group>
  )
}

// ── Landmark Worlds (converted FloatingIslands) ──────────────────────
//
// These are permanent "worlds" in the universe — the old decorative
// floating islands reborn as data-driven landmarks. They aren't in
// the CRDT; they're hardcoded fixtures that give the universe character.

interface LandmarkData {
  name: string
  position: [number, number, number]
  scale: number
  rockColor: string
  crystalColor: string
}

const LANDMARKS: LandmarkData[] = [
  { name: 'The Spire',     position: [-8, 2, -12], scale: 1.2, rockColor: '#1a1a4e', crystalColor: '#e8b94a' },
  { name: 'Drift Rock',    position: [6, -1, -10], scale: 0.8, rockColor: '#1a1a4e', crystalColor: '#6b3fa0' },
  { name: 'Deep Anchor',   position: [-4, -3, -18], scale: 1.5, rockColor: '#1a1a4e', crystalColor: '#2d5fa8' },
  { name: 'Far Beacon',    position: [10, 4, -20], scale: 0.6, rockColor: '#1a1a4e', crystalColor: '#e8b94a' },
  { name: 'Nebula\'s Eye', position: [-12, 5, -25], scale: 1.0, rockColor: '#1a1a4e', crystalColor: '#a84073' },
]

function LandmarkIsland({ data }: { data: LandmarkData }) {
  const ref = useRef<THREE.Group>(null!)
  const crystalColor = useMemo(() => new THREE.Color(data.crystalColor), [data.crystalColor])

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.05
      // Gentle bob
      ref.current.position.y = data.position[1] + Math.sin(state.clock.elapsedTime * 0.4) * 0.15
    }
  })

  return (
    <Float speed={1.0} rotationIntensity={0.2} floatIntensity={0.6}>
      <group ref={ref} position={data.position} scale={data.scale}>
        {/* Main rock body */}
        <mesh>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={data.rockColor}
            roughness={0.85}
            metalness={0.1}
            emissive="#1a0a30"
            emissiveIntensity={0.15}
          />
        </mesh>

        {/* Main crystal */}
        <mesh position={[0, 0.8, 0]} rotation={[0.3, 0, 0.2]}>
          <octahedronGeometry args={[0.35, 0]} />
          <meshStandardMaterial
            color={crystalColor}
            roughness={0.1}
            metalness={0.9}
            emissive={crystalColor}
            emissiveIntensity={0.5}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        </mesh>

        {/* Smaller crystal */}
        <mesh position={[0.5, 0.5, 0.3]} rotation={[0.5, 0.8, 0]}>
          <octahedronGeometry args={[0.15, 0]} />
          <meshStandardMaterial
            color={crystalColor}
            roughness={0.15}
            metalness={0.8}
            emissive={crystalColor}
            emissiveIntensity={0.6}
            transparent
            opacity={0.8}
            toneMapped={false}
          />
        </mesh>

        {/* Label */}
        <Html
          position={[0, 1.5, 0]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap' }}
        >
          <div style={{
            color: '#aaa',
            fontSize: '10px',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 500,
            textShadow: '0 0 8px rgba(0,0,0,0.9)',
            letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
          }}>
            {data.name}
          </div>
        </Html>

        {/* Soft point light from crystal */}
        <pointLight color={crystalColor} intensity={1.0} distance={4} decay={2} />
      </group>
    </Float>
  )
}

// ── Main Component ───────────────────────────────────────────────────

export function UniverseWorlds() {
  const worlds = useUniverseStore((s) => s.worlds)
  const { camera } = useThree()

  // Split worlds into LOD buckets based on distance from camera
  const { close, medium, far } = useMemo(() => {
    const c: WorldEntry[] = []
    const m: WorldEntry[] = []
    const f: WorldEntry[] = []

    for (const world of worlds.values()) {
      const sp = worldToScene(world.resolvedPosition)
      const dist = sp.distanceTo(camera.position)

      if (dist < CLOSE_DIST) {
        c.push(world)
      } else if (dist < MEDIUM_DIST) {
        m.push(world)
      } else {
        f.push(world)
      }
    }

    return { close: c, medium: m, far: f }
  }, [worlds, camera.position])

  return (
    <group>
      {/* Aweborn Portal — always at origin, always Close LOD */}
      <AwebornPortal />

      {/* Landmark islands — permanent universe fixtures */}
      {LANDMARKS.map((lm) => (
        <LandmarkIsland key={lm.name} data={lm} />
      ))}

      {/* Close LOD — full mesh per world */}
      {close.map((w) => (
        <WorldOrbClose key={w.id} world={w} />
      ))}

      {/* Medium LOD — billboard sprites */}
      {medium.map((w) => (
        <WorldBillboard key={w.id} world={w} />
      ))}

      {/* Far LOD — batched points */}
      <WorldPoints worlds={far} />
    </group>
  )
}


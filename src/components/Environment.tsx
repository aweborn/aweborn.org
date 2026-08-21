import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Stars, Cloud } from '@react-three/drei'
import * as THREE from 'three'

/**
 * Cosmic nebula environment — ambient backdrop for the universe view.
 *
 * Contains:
 *  - Dynamic starfield (background stars)
 *  - Volumetric nebula clouds
 *  - Orbital particle fields
 *  - Nebula rings
 *  - Ambient + accent lighting
 *
 * FloatingIslands have been promoted to landmark worlds in UniverseWorlds.tsx.
 */

/* ---- Orbiting Particles ---- */
function OrbitalParticles({ count = 200, radius = 15 }: { count?: number; radius?: number }) {
  const ref = useRef<THREE.Points>(null!)

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = radius * (0.4 + Math.random() * 0.6)

      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.5
      pos[i * 3 + 2] = r * Math.cos(phi)

      // Warm golden to cool purple
      const t = Math.random()
      if (t < 0.4) {
        colors[i * 3] = 0.91
        colors[i * 3 + 1] = 0.73
        colors[i * 3 + 2] = 0.29
      } else if (t < 0.7) {
        colors[i * 3] = 0.42
        colors[i * 3 + 1] = 0.25
        colors[i * 3 + 2] = 0.63
      } else {
        colors[i * 3] = 0.18
        colors[i * 3 + 1] = 0.37
        colors[i * 3 + 2] = 0.66
      }
    }
    return { positions: pos, colors }
  }, [count, radius])

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.02
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.01) * 0.1
    }
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions.positions, 3]}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[positions.colors, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.06}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

/* ---- Nebula Ring ---- */
function NebulaRing({ radius = 10, color = '#6b3fa0' }: { radius?: number; color?: string }) {
  const ref = useRef<THREE.Mesh>(null!)

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.z = state.clock.elapsedTime * 0.03
      ref.current.rotation.x = Math.PI * 0.35 + Math.sin(state.clock.elapsedTime * 0.05) * 0.05
    }
  })

  return (
    <mesh ref={ref}>
      <torusGeometry args={[radius, 0.03, 16, 100]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.5}
        transparent
        opacity={0.3}
        toneMapped={false}
      />
    </mesh>
  )
}

/* ---- Main Environment ---- */
export function Environment() {
  return (
    <group>
      {/* Starfield */}
      <Stars
        radius={80}
        depth={60}
        count={3000}
        factor={4}
        saturation={0.2}
        fade
        speed={0.5}
      />

      {/* Volumetric clouds / nebula */}
      <Cloud
        opacity={0.15}
        speed={0.1}
        color="#6b3fa0"
        position={[0, 5, -20]}
        scale={[30, 5, 5]}
      />
      <Cloud
        opacity={0.1}
        speed={0.08}
        color="#2d5fa8"
        position={[-10, -3, -15]}
        scale={[25, 4, 4]}
      />
      <Cloud
        opacity={0.08}
        speed={0.12}
        color="#a84073"
        position={[12, 8, -25]}
        scale={[20, 3, 3]}
      />

      {/* Orbital particle fields */}
      <OrbitalParticles count={300} radius={18} />
      <OrbitalParticles count={150} radius={25} />

      {/* Nebula rings */}
      <NebulaRing radius={12} color="#6b3fa0" />
      <NebulaRing radius={16} color="#2d5fa8" />

      {/* Ambient lights */}
      <ambientLight intensity={0.15} color="#4a3a8a" />
      <pointLight position={[0, 10, 0]} intensity={0.8} color="#e8b94a" distance={40} decay={2} />
      <pointLight position={[-10, -5, -10]} intensity={0.4} color="#6b3fa0" distance={30} decay={2} />
      <pointLight position={[10, 3, -15]} intensity={0.3} color="#2d5fa8" distance={25} decay={2} />

      {/* Directional fill */}
      <directionalLight position={[5, 8, 5]} intensity={0.2} color="#eef0f6" />

      {/* Ground fog effect - subtle plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial
          color="#0a0a2e"
          transparent
          opacity={0.5}
          emissive="#1a0a30"
          emissiveIntensity={0.3}
        />
      </mesh>
    </group>
  )
}

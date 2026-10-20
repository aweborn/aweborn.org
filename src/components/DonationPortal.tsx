import { useRef, useState, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Html, MeshDistortMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { ORIGIN_WORLD_ENTRY } from '@aweborn/shared/crdt-schema'

interface DonationPortalProps {
  onActivate: () => void
}

/**
 * A glowing, pulsing portal object that the user can discover and click
 * to trigger the donation modal. Floats at a prominent position with
 * proximity-based effects.
 */
export function DonationPortal({ onActivate }: DonationPortalProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const ringRef = useRef<THREE.Mesh>(null!)
  const [hovered, setHovered] = useState(false)

  useFrame((state) => {
    const t = state.clock.elapsedTime

    // Gentle rotation
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.15
    }

    // Pulsing glow
    if (glowRef.current) {
      const scale = 1 + Math.sin(t * 1.5) * 0.08
      glowRef.current.scale.setScalar(hovered ? scale * 1.3 : scale)
    }

    // Ring rotation
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.5
      ringRef.current.rotation.x = Math.sin(t * 0.3) * 0.2
    }
  })

  const handleClick = useCallback(() => {
    onActivate()
  }, [onActivate])

  return (
    <Float
      speed={1.5}
      rotationIntensity={0.2}
      floatIntensity={1.2}
      position={[0, 0, 0]}
    >
      <group
        ref={groupRef}
        onClick={handleClick}
        onPointerEnter={() => {
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerLeave={() => {
          setHovered(false)
          document.body.style.cursor = 'default'
        }}
      >
        {/* Core orb */}
        <mesh>
          <sphereGeometry args={[0.6, 64, 64]} />
          <MeshDistortMaterial
            color="#e8b94a"
            emissive="#e8b94a"
            emissiveIntensity={hovered ? 1.8 : 1.0}
            roughness={0.1}
            metalness={0.8}
            distort={hovered ? 0.35 : 0.2}
            speed={2}
            toneMapped={false}
          />
        </mesh>

        {/* Inner glow sphere */}
        <mesh ref={glowRef}>
          <sphereGeometry args={[0.8, 32, 32]} />
          <meshStandardMaterial
            color="#e8b94a"
            emissive="#e8b94a"
            emissiveIntensity={0.8}
            transparent
            opacity={hovered ? 0.25 : 0.12}
            side={THREE.BackSide}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Outer glow */}
        <mesh>
          <sphereGeometry args={[1.2, 32, 32]} />
          <meshStandardMaterial
            color="#e8b94a"
            emissive="#e8b94a"
            emissiveIntensity={0.4}
            transparent
            opacity={hovered ? 0.12 : 0.05}
            side={THREE.BackSide}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>

        {/* Orbital ring */}
        <mesh ref={ringRef}>
          <torusGeometry args={[1.0, 0.015, 16, 64]} />
          <meshStandardMaterial
            color="#e8b94a"
            emissive="#e8b94a"
            emissiveIntensity={2}
            transparent
            opacity={hovered ? 0.7 : 0.4}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Second ring at different angle */}
        <mesh rotation={[Math.PI / 3, Math.PI / 4, 0]}>
          <torusGeometry args={[1.1, 0.01, 16, 64]} />
          <meshStandardMaterial
            color="#6b3fa0"
            emissive="#6b3fa0"
            emissiveIntensity={1.5}
            transparent
            opacity={hovered ? 0.5 : 0.25}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Point light emanating from portal */}
        <pointLight
          color="#e8b94a"
          intensity={hovered ? 3 : 1.5}
          distance={10}
          decay={2}
        />

        {/* Name label — same style as every other world (UniverseWorlds) */}
        <Html
          position={[0, 1.9, 0]}
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
            <div>{ORIGIN_WORLD_ENTRY.name}</div>
            <div style={{ fontSize: '10px', fontWeight: 400, color: '#e8b94a' }}>
              ✨ solid
            </div>
          </div>
        </Html>
      </group>
    </Float>
  )
}

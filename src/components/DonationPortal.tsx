import { useRef, useState, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { Float, Text, MeshDistortMaterial } from '@react-three/drei'
import * as THREE from 'three'

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
      position={[0, 0.5, -6]}
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

        {/* Floating text label */}
        <Text
          position={[0, -1.6, 0]}
          fontSize={0.18}
          color="#e8b94a"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.005}
          outlineColor="#000000"
          fillOpacity={hovered ? 1 : 0.6}
        >
          {hovered ? '✦ Click to Donate ✦' : '✦ Donation Portal ✦'}
        </Text>
      </group>
    </Float>
  )
}

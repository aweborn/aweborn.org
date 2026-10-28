import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Stars, Cloud } from '@react-three/drei'
import * as THREE from 'three'
import type { PoolBand } from '@aweborn/shared/mana-level'
import { useQualityTier } from '../stores/qualityStore'
import { useSkyBand, useSkyStore } from '../stores/skyStore'

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

/* ---- Living sky (Rough Draft M4) ---- */

/** How rich the cosmos looks at each pool band (ROADMAP "Mana Visualization"). */
const BAND_LOOK: Record<PoolBand, { starFactor: number; saturation: number; starShare: number; cloud: number; particles: number; ring: number }> = {
  high: { starFactor: 5, saturation: 0.35, starShare: 1, cloud: 1.5, particles: 3, ring: 1.3 },
  medium: { starFactor: 4, saturation: 0.2, starShare: 1, cloud: 1, particles: 2, ring: 1 },
  low: { starFactor: 3, saturation: 0, starShare: 0.7, cloud: 0.45, particles: 1, ring: 0.5 },
  critical: { starFactor: 2.2, saturation: 0, starShare: 0.4, cloud: 0.15, particles: 0, ring: 0.2 },
}

const NIGHT_AMBIENT = new THREE.Color('#34306e')
const DAY_AMBIENT = new THREE.Color('#7a5a7e')
const NIGHT_KEY = new THREE.Color('#9aa6d8')
const DAY_KEY = new THREE.Color('#f2c88a')
const NIGHT_FOG = new THREE.Color('#050510')
const DAY_FOG = new THREE.Color('#0d0914')

/** Daylight: warmer, brighter fill by day; cooler, deeper by night. Updated in place (no re-render). */
function SolarLights() {
  const amb = useRef<THREE.AmbientLight>(null!)
  const key = useRef<THREE.DirectionalLight>(null!)
  const scene = useThree((s) => s.scene)
  useFrame(() => {
    const day = (useSkyStore.getState().sun + 1) / 2 // 0 night … 1 noon
    if (scene.fog) scene.fog.color.copy(NIGHT_FOG).lerp(DAY_FOG, day)
    if (amb.current) {
      amb.current.color.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, day)
      amb.current.intensity = 0.11 + 0.09 * day
    }
    if (key.current) {
      key.current.color.copy(NIGHT_KEY).lerp(DAY_KEY, day)
      key.current.intensity = 0.14 + 0.16 * day
    }
  })
  return (
    <>
      <ambientLight ref={amb} intensity={0.15} color="#4a3a8a" />
      <directionalLight ref={key} position={[5, 8, 5]} intensity={0.2} color="#eef0f6" />
    </>
  )
}

/** Near-dark universe: soft curtains of green and violet over the Portal (critical band). */
function PortalAurora() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.x += sin(p.y * 0.35 + uTime * 0.6) * 0.8;
            p.z += sin(p.x * 0.25 + uTime * 0.4) * 1.2;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float band = sin(vUv.x * 18.0 + uTime * 0.8) * 0.5 + 0.5;
            float fadeY = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
            float fadeX = smoothstep(0.0, 0.15, vUv.x) * (1.0 - smoothstep(0.85, 1.0, vUv.x));
            vec3 green = vec3(0.25, 0.95, 0.6);
            vec3 violet = vec3(0.6, 0.35, 1.0);
            vec3 col = mix(green, violet, vUv.y);
            gl_FragColor = vec4(col, (0.18 + 0.22 * band) * fadeY * fadeX);
          }`,
      }),
    [],
  )
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime
  })
  return (
    <group position={[0, 6, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[0, (i * Math.PI) / 3, 0]} position={[0, i * 1.5, 0]} material={mat}>
          <planeGeometry args={[34, 12, 48, 8]} />
        </mesh>
      ))}
    </group>
  )
}

/* ---- Main Environment ---- */
export function Environment() {
  const { stars } = useQualityTier()
  const band = useSkyBand()
  const look = BAND_LOOK[band]
  return (
    <group>
      {/* Starfield: richer when the pool is full, sparse and grey when it runs low */}
      <Stars
        key={band}
        radius={80}
        depth={60}
        count={Math.round(stars * look.starShare)}
        factor={look.starFactor}
        saturation={look.saturation}
        fade
        speed={0.5}
      />

      {/* Volumetric clouds / nebula */}
      {look.cloud > 0.2 && (
        <>
          <Cloud opacity={0.15 * look.cloud} speed={0.1} color="#6b3fa0" position={[0, 5, -20]} scale={[30, 5, 5]} />
          <Cloud opacity={0.1 * look.cloud} speed={0.08} color="#2d5fa8" position={[-10, -3, -15]} scale={[25, 4, 4]} />
          <Cloud opacity={0.08 * look.cloud} speed={0.12} color="#a84073" position={[12, 8, -25]} scale={[20, 3, 3]} />
        </>
      )}

      {/* Orbital particle fields */}
      {look.particles >= 1 && <OrbitalParticles count={300} radius={18} />}
      {look.particles >= 2 && <OrbitalParticles count={150} radius={25} />}
      {look.particles >= 3 && <OrbitalParticles count={220} radius={34} />}

      {/* Nebula rings */}
      {look.ring >= 0.5 && <NebulaRing radius={12} color="#6b3fa0" />}
      {look.ring >= 1 && <NebulaRing radius={16} color="#2d5fa8" />}

      {band === 'critical' && <PortalAurora />}

      {/* Ambient + key light follow the local sun */}
      <SolarLights />
      <pointLight position={[0, 10, 0]} intensity={0.8} color="#e8b94a" distance={40} decay={2} />
      <pointLight position={[-10, -5, -10]} intensity={0.4} color="#6b3fa0" distance={30} decay={2} />
      <pointLight position={[10, 3, -15]} intensity={0.3} color="#2d5fa8" distance={25} decay={2} />
    </group>
  )
}

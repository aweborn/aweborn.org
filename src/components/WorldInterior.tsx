import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useWorldStore } from '../stores/worldStore'
import { useUniverseStore } from '../stores/universeStore'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'

/**
 * World Interior View — renders the inside of a world when the player
 * has entered one.
 *
 * Objects from the World CRDT are rendered as Three.js primitives.
 * The scene includes a ground plane with grid, ambient lighting
 * colored by the world's palette, and a sky dome.
 */

// ── Object Geometries ────────────────────────────────────────────────

const GEOMETRIES: Record<string, THREE.BufferGeometry> = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 24, 24),
  cylinder: new THREE.CylinderGeometry(0.4, 0.4, 1, 16),
  cone: new THREE.ConeGeometry(0.5, 1, 16),
  torus: new THREE.TorusGeometry(0.4, 0.15, 12, 32),
}

function getGeometry(type: string): THREE.BufferGeometry {
  return GEOMETRIES[type] ?? GEOMETRIES.cube
}

// ── Placed Object Mesh ───────────────────────────────────────────────

function PlacedObjectMesh({ obj, worldColor }: { obj: PlacedObject; worldColor: string }) {
  const ref = useRef<THREE.Mesh>(null!)
  const geo = useMemo(() => getGeometry(obj.type), [obj.type])

  // Material color — derive from world color + object type
  const color = useMemo(() => {
    const base = new THREE.Color(worldColor)
    // Vary hue slightly by object type for visual diversity
    const hsl = { h: 0, s: 0, l: 0 }
    base.getHSL(hsl)

    const typeOffset: Record<string, number> = {
      cube: 0, sphere: 0.08, cylinder: 0.16, cone: -0.08, torus: -0.16,
    }
    hsl.h = (hsl.h + (typeOffset[obj.type] ?? 0) + 1) % 1
    hsl.s = Math.min(hsl.s + 0.1, 1)
    hsl.l = Math.min(hsl.l + 0.15, 0.85)
    return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l)
  }, [worldColor, obj.type])

  // Subtle float animation
  useFrame((state) => {
    if (ref.current) {
      ref.current.position.y = obj.y + Math.sin(state.clock.elapsedTime * 0.5 + obj.x * 0.1) * 0.05
      ref.current.rotation.y += 0.003
    }
  })

  return (
    <mesh
      ref={ref}
      geometry={geo}
      position={[obj.x, obj.y, obj.z]}
      rotation={[obj.rotX, obj.rotY, obj.rotZ]}
      scale={[obj.scaleX, obj.scaleY, obj.scaleZ]}
    >
      <meshStandardMaterial
        color={color}
        roughness={0.35}
        metalness={0.3}
        emissive={color}
        emissiveIntensity={0.2}
      />
    </mesh>
  )
}

// ── Ground Grid ──────────────────────────────────────────────────────

function GroundGrid({ worldColor }: { worldColor: string }) {
  const color = useMemo(() => new THREE.Color(worldColor).multiplyScalar(0.3), [worldColor])

  return (
    <group>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial
          color="#0a0a1a"
          roughness={0.95}
          metalness={0.05}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Grid */}
      <gridHelper
        args={[40, 40, color, color]}
        position={[0, 0, 0]}
      />
    </group>
  )
}

// ── Sky Dome ─────────────────────────────────────────────────────────

function SkyDome({ worldColor }: { worldColor: string }) {
  const ref = useRef<THREE.Mesh>(null!)

  const skyColor = useMemo(() => {
    const c = new THREE.Color(worldColor)
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl)
    // Dark, desaturated version of world color for sky
    return new THREE.Color().setHSL(hsl.h, hsl.s * 0.3, 0.03)
  }, [worldColor])

  const horizonColor = useMemo(() => {
    const c = new THREE.Color(worldColor)
    c.multiplyScalar(0.15)
    return c
  }, [worldColor])

  return (
    <mesh ref={ref} scale={[-1, 1, 1]}>
      <sphereGeometry args={[50, 32, 16]} />
      <shaderMaterial
        vertexShader={/* glsl */ `
          varying vec3 vWorldPosition;
          void main() {
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uSkyColor;
          uniform vec3 uHorizonColor;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y;
            float t = smoothstep(-0.1, 0.5, h);
            vec3 color = mix(uHorizonColor, uSkyColor, t);
            gl_FragColor = vec4(color, 1.0);
          }
        `}
        uniforms={{
          uSkyColor: { value: skyColor },
          uHorizonColor: { value: horizonColor },
        }}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// ── Main Component ───────────────────────────────────────────────────

export function WorldInterior() {
  const meta = useWorldStore((s) => s.meta)
  const objects = useWorldStore((s) => s.objects)
  const loaded = useWorldStore((s) => s.loaded)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)

  const worldColor = meta?.color ?? '#6b3fa0'
  const objectList = useMemo(() => Array.from(objects.values()), [objects])

  if (!activeWorldId || !loaded) return null

  return (
    <group>
      {/* Sky dome */}
      <SkyDome worldColor={worldColor} />

      {/* Ground grid */}
      <GroundGrid worldColor={worldColor} />

      {/* Placed objects from CRDT */}
      {objectList.map((obj) => (
        <PlacedObjectMesh key={obj.id} obj={obj} worldColor={worldColor} />
      ))}

      {/* Lighting — colored by world palette */}
      <ambientLight intensity={0.25} color={worldColor} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={0.6}
        color="#ffffff"
        castShadow={false}
      />
      <pointLight
        position={[0, 8, 0]}
        intensity={0.5}
        color={worldColor}
        distance={20}
        decay={2}
      />

      {/* Fog for depth */}
      <fog attach="fog" args={['#050510', 15, 45]} />
    </group>
  )
}

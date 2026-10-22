import { GhostPreview, WorldTerrain } from './GhostPreview'
import { useRef, useMemo, useEffect, Component, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useWorldStore } from '../stores/worldStore'
import { useUniverseStore } from '../stores/universeStore'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'
import { kickedPosition } from '@aweborn/shared/sim/interior'
import { Suspense } from 'react'
import { useGLTF } from '@react-three/drei'
import { AUTH_URL } from '../lib/player'
import { registerModelShape } from '../stores/modelShapes'
import { useAtmosphere } from '../hooks/useAtmosphere'
import type { BlueprintSky } from '@aweborn/shared/blueprint'
import { useHeldItemStore, computePlacementTarget } from '../stores/heldItemStore'
import { interiorController } from '../systems/InteriorController'

/** A model that fails to load must not take the whole scene down: show a wireframe stand-in instead. */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[model] failed to load, showing a placeholder:', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Generated GLB, fitted into a unit box centred on the object (matches its collider). */
function GeneratedModel({ asset }: { asset: string }) {
  const { scene } = useGLTF(`${AUTH_URL}/assets/${asset}?v=2`)
  const fitted = useMemo(() => {
    const root = scene.clone(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const s = 1 / Math.max(size.x, size.y, size.z, 1e-6)
    root.position.sub(centre).multiplyScalar(s)
    root.scale.setScalar(s)
    const g = new THREE.Group()
    g.add(root)
    registerModelShape(asset, g)
    return g
  }, [scene, asset])
  return <primitive object={fitted} />
}

/**
 * World Interior View — renders the inside of a world when the player
 * has entered one.
 *
 * Objects from the World CRDT are rendered as Three.js primitives.
 * The scene includes a ground plane with grid, ambient lighting
 * colored by the world's palette, and a sky dome.
 */

// ── Object Geometries ────────────────────────────────────────────────

const pyramid = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4) // base corners at radius 0.707 → a 1 x 1 square
pyramid.rotateY(Math.PI / 4)

const GEOMETRIES: Record<string, THREE.BufferGeometry> = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 24, 24),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: new THREE.ConeGeometry(0.5, 1, 24),
  pyramid,
  torus: new THREE.TorusGeometry(0.35, 0.15, 12, 32), // 1 m across, matching its unit collider
}

function getGeometry(type: string): THREE.BufferGeometry {
  return GEOMETRIES[type] ?? GEOMETRIES.cube
}

// ── Placed Object Mesh ───────────────────────────────────────────────

function PlacedObjectMesh({ obj, worldColor }: { obj: PlacedObject; worldColor: string }) {
  const ref = useRef<THREE.Mesh>(null!)
  const groupRef = useRef<THREE.Group>(null!)
  const geo = useMemo(() => getGeometry(obj.type), [obj.type])

  // Library items (blocks, shapes) keep the exact color they were placed with and stand still
  const placedLook = !!obj.color

  // Material color: derive from world color + object type (legacy objects)
  const color = useMemo(() => {
    if (obj.color) return new THREE.Color(obj.color)
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
  }, [worldColor, obj.type, obj.color])

  // Subtle float animation; a kicked object follows the shared flight sim
  useFrame((state) => {
    const target = (ref.current ?? groupRef.current) as THREE.Object3D | null
    if (target) {
      if (obj.kick) {
        const p = kickedPosition(obj, useWorldStore.getState().physics, (Date.now() - obj.kick.t) / 1000)
        target.position.set(p.x, p.y, p.z)
        target.rotation.x += 0.08
        return
      }
      if (obj.type === 'model') {
        // Generated models stand still where they were placed
        target.position.set(obj.x, obj.y, obj.z)
        target.rotation.set(0, obj.rotY, 0)
        return
      }
      if (placedLook) {
        target.position.set(obj.x, obj.y, obj.z)
        target.rotation.set(obj.rotX, obj.rotY, obj.rotZ)
        return
      }
      target.position.set(obj.x, obj.y + Math.sin(state.clock.elapsedTime * 0.5 + obj.x * 0.1) * 0.05, obj.z)
      target.rotation.y += 0.003
    }
  })

  if (obj.type === 'model' && obj.asset) {
    return (
      <group ref={groupRef as never} position={[obj.x, obj.y, obj.z]} scale={[obj.scaleX, obj.scaleY, obj.scaleZ]}>
        <ModelBoundary fallback={<mesh geometry={GEOMETRIES.cube}><meshBasicMaterial color="#ff6a5a" wireframe /></mesh>}>
          <Suspense fallback={<mesh geometry={GEOMETRIES.cube}><meshBasicMaterial color={color} wireframe /></mesh>}>
            <GeneratedModel asset={obj.asset} />
          </Suspense>
        </ModelBoundary>
      </group>
    )
  }

  return (
    <mesh
      ref={ref}
      geometry={geo}
      position={[obj.x, obj.y, obj.z]}
      rotation={[obj.rotX, obj.rotY, obj.rotZ]}
      scale={[obj.scaleX, obj.scaleY, obj.scaleZ]}
    >
      {placedLook ? (
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          metalness={obj.material === 'gold' ? 0.8 : 0.05}
          transparent={obj.material === 'glass'}
          opacity={obj.material === 'glass' ? 0.45 : 1}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          roughness={0.35}
          metalness={0.3}
          emissive={color}
          emissiveIntensity={0.2}
        />
      )}
    </mesh>
  )
}

// ── Held Item Ghost Preview (Minecraft-style placement spot) ─────────

function HeldItemPreview() {
  const item = useHeldItemStore((s) => s.item)
  const carryingId = useHeldItemStore((s) => s.carryingId)
  const groupRef = useRef<THREE.Group>(null!)

  const geo = useMemo(() => {
    if (!item) return GEOMETRIES.cube
    if (item.kind === 'block') return GEOMETRIES.cube
    if (item.kind === 'shape') return getGeometry(item.shape.id)
    return GEOMETRIES.cube
  }, [item])

  const color = useMemo(() => {
    if (!item) return new THREE.Color('#ffffff')
    if (item.kind === 'block') return new THREE.Color(item.block.color)
    if (item.kind === 'shape') return new THREE.Color(item.color)
    return new THREE.Color('#9fe8ff')
  }, [item])

  useFrame((state) => {
    if (!groupRef.current || !item || carryingId) return
    const target = computePlacementTarget(item, interiorController.state)
    groupRef.current.position.set(target.x, target.y, target.z)
    groupRef.current.rotation.set(0, target.rotY, 0)
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.015
    const s = target.scale * pulse
    groupRef.current.scale.set(s, s, s)
  })

  if (!item || carryingId) return null

  return (
    <group ref={groupRef}>
      {item.kind === 'model' ? (
        <ModelBoundary fallback={<mesh geometry={GEOMETRIES.cube}><meshBasicMaterial color="#9fe8ff" wireframe transparent opacity={0.6} /></mesh>}>
          <Suspense fallback={<mesh geometry={GEOMETRIES.cube}><meshBasicMaterial color="#9fe8ff" wireframe transparent opacity={0.6} /></mesh>}>
            <GeneratedModel asset={item.file} />
          </Suspense>
        </ModelBoundary>
      ) : (
        <mesh geometry={geo}>
          <meshStandardMaterial
            color={color}
            roughness={0.5}
            metalness={0.1}
            emissive={color}
            emissiveIntensity={0.25}
            transparent
            opacity={0.52}
            depthWrite={false}
          />
        </mesh>
      )}
      <mesh geometry={geo} scale={[1.02, 1.02, 1.02]}>
        <meshBasicMaterial color={color} wireframe transparent opacity={0.65} depthWrite={false} />
      </mesh>
    </group>
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

function SkyDome({ worldColor, sky }: { worldColor: string; sky: BlueprintSky | null }) {
  const ref = useRef<THREE.Mesh>(null!)
  // Created once and mutated: swapping the uniforms object after the first compile wouldn't reach the GPU
  const uniforms = useMemo(
    () => ({ uSkyColor: { value: new THREE.Color() }, uHorizonColor: { value: new THREE.Color() }, uSrgb: { value: 0 } }),
    [],
  )

  useEffect(() => {
    if (sky) {
      uniforms.uSkyColor.value.set(sky.zenith)
      uniforms.uHorizonColor.value.set(sky.horizon)
      uniforms.uSrgb.value = 1
    } else {
      // Old rooms: dark, desaturated version of the world color
      const hsl = { h: 0, s: 0, l: 0 }
      new THREE.Color(worldColor).getHSL(hsl)
      uniforms.uSkyColor.value.setHSL(hsl.h, hsl.s * 0.3, 0.03)
      uniforms.uHorizonColor.value.set(worldColor).multiplyScalar(0.15)
      uniforms.uSrgb.value = 0
    }
  }, [sky, worldColor, uniforms])

  return (
    <mesh ref={ref} scale={[-1, 1, 1]}>
      <sphereGeometry args={[300, 32, 16]} />
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
          uniform float uSrgb;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y;
            float t = smoothstep(-0.1, 0.5, h);
            vec3 color = mix(uHorizonColor, uSkyColor, t);
            gl_FragColor = vec4(color, 1.0);
            // Match what lit materials and fog show for the same color
            if (uSrgb > 0.5) gl_FragColor = linearToOutputTexel(gl_FragColor);
          }
        `}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
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
  const atmo = useAtmosphere()

  const worldColor = meta?.color ?? '#6b3fa0'
  // Worlds are small and the camera can fly far above them, so fog only touches the extreme distance (any nearer turned the terrain dark from altitude)
  const fogColor = useMemo(() => new THREE.Color(worldColor).multiplyScalar(0.15), [worldColor])
  const objectList = useMemo(() => Array.from(objects.values()), [objects])

  if (!activeWorldId || !loaded) return null

  return (
    <group>
      {/* Sky dome */}
      <SkyDome worldColor={worldColor} sky={atmo?.sky ?? null} />

      {/* Ground grid */}
      <GroundGrid worldColor={worldColor} />

      {/* Planner blueprint: walkable voxel terrain + wireframe assets */}
      <WorldTerrain />
      <GhostPreview />

      {/* Placed objects from CRDT */}
      {objectList.map((obj) => (
        <PlacedObjectMesh key={obj.id} obj={obj} worldColor={worldColor} />
      ))}

      {/* Live ghost preview of the item held in hand */}
      <HeldItemPreview />

      {/* Lighting: the blueprint's sun + ambient in voxel worlds, world-palette tint in the old rooms */}
      {atmo ? (
        <>
          <ambientLight color={atmo.sky.ambient.color} intensity={atmo.sky.ambient.intensity} />
          <directionalLight
            position={atmo.sky.sun.dir.map((v) => v * 40) as [number, number, number]}
            intensity={atmo.sky.sun.intensity}
            color={atmo.sky.sun.color}
            castShadow={false}
          />
        </>
      ) : (
        <>
          <ambientLight intensity={0.25} color={worldColor} />
          <directionalLight position={[5, 10, 5]} intensity={0.6} color="#ffffff" castShadow={false} />
          <pointLight position={[0, 8, 0]} intensity={0.5} color={worldColor} distance={20} decay={2} />
        </>
      )}

      {/* Voxel worlds' fog is set in Scene (horizon color, distance from the sky); the old rooms keep this one */}
      {!atmo && <fog attach="fog" args={[fogColor, 400, 1200]} />}
    </group>
  )
}

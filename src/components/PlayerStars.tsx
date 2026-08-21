import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { usePresence } from '../hooks/usePresence'

/**
 * Renders other players as glowing orbs drifting through the universe.
 *
 * Each player is a small emissive sphere with a comet trail
 * (fading particle trail behind moving players).
 *
 * Position data comes from BroadcastChannel-based presence (~20Hz).
 * Positions are interpolated (lerp) between broadcasts for smooth motion.
 */

const SCENE_RADIUS = 14
const CRDT_SCALE = 500
const TRAIL_LENGTH = 12      // Number of trail particles per player
const TRAIL_FADE_RATE = 0.08 // How fast older trail points fade

/** Map a CRDT position to scene coordinates (same as UniverseWorlds). */
function toScene(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return new THREE.Vector3(pos.x * scale, pos.y * scale + 1, pos.z * scale - 8)
}

// ── Single Player Star ───────────────────────────────────────────────

interface PlayerStarData {
  id: string
  color: string
  position: THREE.Vector3
  targetPosition: THREE.Vector3
  trail: THREE.Vector3[]
  trailAlphas: number[]
}

function PlayerStar({ data }: { data: PlayerStarData }) {
  const groupRef = useRef<THREE.Group>(null!)
  const trailRef = useRef<THREE.Points>(null!)

  const color = useMemo(() => new THREE.Color(data.color), [data.color])
  const trailGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(TRAIL_LENGTH * 3)
    const alphas = new Float32Array(TRAIL_LENGTH)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    return geo
  }, [])

  // Custom trail material with per-vertex alpha
  const trailMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(2.0, 6.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        // Circular point
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = 1.0 - d * 2.0;
        gl_FragColor = vec4(uColor * glow, vAlpha * glow);
      }
    `,
    uniforms: { uColor: { value: color } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [color])

  useEffect(() => () => { trailGeo.dispose(); trailMat.dispose() }, [trailGeo, trailMat])

  useFrame(() => {
    if (!groupRef.current) return

    // Lerp position toward target
    data.position.lerp(data.targetPosition, 0.12)
    groupRef.current.position.copy(data.position)

    // Update trail
    if (trailRef.current) {
      // Shift trail down
      for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
        data.trail[i].copy(data.trail[i - 1])
        data.trailAlphas[i] = data.trailAlphas[i - 1] * (1 - TRAIL_FADE_RATE)
      }
      data.trail[0].copy(data.position)
      data.trailAlphas[0] = 0.8

      // Write to buffer
      const posArr = trailGeo.attributes.position.array as Float32Array
      const alphaArr = trailGeo.attributes.alpha.array as Float32Array
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        posArr[i * 3] = data.trail[i].x
        posArr[i * 3 + 1] = data.trail[i].y
        posArr[i * 3 + 2] = data.trail[i].z
        alphaArr[i] = data.trailAlphas[i]
      }
      trailGeo.attributes.position.needsUpdate = true
      trailGeo.attributes.alpha.needsUpdate = true
    }
  })

  return (
    <>
      <group ref={groupRef}>
        {/* Player orb */}
        <mesh>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.9}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Outer glow */}
        <mesh>
          <sphereGeometry args={[0.25, 12, 12]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.25}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
          />
        </mesh>
        {/* Small point light */}
        <pointLight color={color} intensity={0.8} distance={3} decay={2} />
      </group>

      {/* Comet trail */}
      <points ref={trailRef} geometry={trailGeo} material={trailMat} />
    </>
  )
}

// ── Main Component ───────────────────────────────────────────────────

export function PlayerStars() {
  const { players } = usePresence()
  const starDataRef = useRef(new Map<string, PlayerStarData>())

  // Sync star data with presence updates
  const activeStars = useMemo(() => {
    const data = starDataRef.current
    const active: PlayerStarData[] = []

    for (const [id, presence] of players) {
      let star = data.get(id)
      if (!star) {
        const pos = toScene(presence.position)
        star = {
          id,
          color: presence.color,
          position: pos.clone(),
          targetPosition: pos.clone(),
          trail: Array.from({ length: TRAIL_LENGTH }, () => pos.clone()),
          trailAlphas: new Array(TRAIL_LENGTH).fill(0),
        }
        data.set(id, star)
      }

      // Update target position
      star.targetPosition.copy(toScene(presence.position))
      star.color = presence.color
      active.push(star)
    }

    // Clean up stale stars
    for (const [id] of data) {
      if (!players.has(id)) data.delete(id)
    }

    return active
  }, [players])

  return (
    <group>
      {activeStars.map((star) => (
        <PlayerStar key={star.id} data={star} />
      ))}
    </group>
  )
}

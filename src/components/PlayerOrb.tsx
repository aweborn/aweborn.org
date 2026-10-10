import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { flightController } from '../systems/FlightController'
import { starModSlots, type TrailStyle, type AuraStyle, type ShapeStyle } from '../systems/StarModSlots'

/**
 * Local player's visual representation in the universe.
 *
 * A glowing orb with customizable trail, aura, and shape
 * driven by the StarModSlots system. The camera follows this orb.
 *
 * Only visible in universe view (hidden when inside a world).
 */

const TRAIL_LENGTH = 32
const TRAIL_SPACING_FRAMES = 1
const SPEED_LINE_COUNT = 24
const SPEED_LINE_LIFETIME = 0.8 // seconds — long enough to actually see

interface PlayerOrbProps {
  color: string
}

// ── Shape Geometries ─────────────────────────────────────────────────

function useShapeGeometry(shape: ShapeStyle): THREE.BufferGeometry {
  return useMemo(() => {
    switch (shape) {
      case 'crystal':
        return new THREE.OctahedronGeometry(0.18, 0)
      case 'spiral': {
        // Torus knot — spiral-like shape
        return new THREE.TorusKnotGeometry(0.1, 0.04, 32, 8, 2, 3)
      }
      case 'spike':
        return new THREE.ConeGeometry(0.12, 0.3, 6)
      case 'jellyfish':
        // Half-sphere dome
        return new THREE.SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6)
      case 'sphere':
      default:
        return new THREE.SphereGeometry(0.15, 20, 20)
    }
  }, [shape])
}

// ── Trail Shader Variants ────────────────────────────────────────────

function getTrailFragmentShader(style: TrailStyle): string {
  switch (style) {
    case 'sparkle':
      return /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          // Sparkle: sharper falloff with bright center
          float glow = pow(1.0 - d * 2.0, 3.0);
          float sparkle = step(0.95, fract(sin(dot(gl_PointCoord, vec2(12.9898, 78.233))) * 43758.5453));
          gl_FragColor = vec4(uColor * (glow * 2.0 + sparkle * 3.0), vAlpha * (glow + sparkle));
        }
      `
    case 'ribbon':
      return /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          // Ribbon: elongated horizontally
          float dx = abs(gl_PointCoord.x - 0.5) * 1.5;
          float dy = abs(gl_PointCoord.y - 0.5) * 3.0;
          float d = sqrt(dx * dx + dy * dy);
          if (d > 0.5) discard;
          float glow = 1.0 - d * 2.0;
          gl_FragColor = vec4(uColor * glow * 1.8, vAlpha * glow);
        }
      `
    case 'helix':
      return /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          // Helix: ring-like with hollow center
          float ring = smoothstep(0.1, 0.2, d) * (1.0 - smoothstep(0.35, 0.5, d));
          float center = 1.0 - smoothstep(0.0, 0.15, d);
          float glow = ring + center * 0.5;
          gl_FragColor = vec4(uColor * glow * 2.0, vAlpha * glow);
        }
      `
    case 'none':
      return /* glsl */ `
        void main() { discard; }
      `
    case 'comet':
    default:
      return /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = 1.0 - d * 2.0;
          gl_FragColor = vec4(uColor * glow * 1.5, vAlpha * glow);
        }
      `
  }
}

const TRAIL_VERTEX = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float baseSize = max(15.0, 25.0 / -mvPos.z);
    gl_PointSize = baseSize * (0.5 + alpha * 1.5); // near player = up to 2x larger
    gl_Position = projectionMatrix * mvPos;
  }
`

export function PlayerOrb({ color }: PlayerOrbProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const trailRef = useRef<THREE.Points>(null!)
  const auraRef = useRef<THREE.Mesh>(null!)
  const speedLinesRef = useRef<THREE.Points>(null!)
  const frameCount = useRef(0)

  // ── Slingshot pulse state ──
  const slingshotPulse = useRef(0) // 1.0 = just triggered, decays to 0
  const speedLineTimer = useRef(0) // countdown timer for speed lines
  const speedLineOffsets = useRef<Float32Array | null>(null)

  // Expose pulse trigger to module scope
  useEffect(() => {
    _pulseRef = { slingshotPulse, speedLineTimer }
    return () => { _pulseRef = null }
  }, [])

  const orbColor = useMemo(() => new THREE.Color(color), [color])

  // ── Track current mod styles to rebuild materials on change ──
  const currentTrailStyle = useRef<TrailStyle>('comet')
  const currentAuraStyle = useRef<AuraStyle>('glow')
  const currentShapeStyle = useRef<ShapeStyle>('sphere')

  // ── Trail geometry ──
  const trailGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(TRAIL_LENGTH * 3)
    const alphas = new Float32Array(TRAIL_LENGTH)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    return geo
  }, [])

  // ── Speed line geometry ──
  const speedLineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(SPEED_LINE_COUNT * 3)
    const alphas = new Float32Array(SPEED_LINE_COUNT)
    const offsets = new Float32Array(SPEED_LINE_COUNT)
    for (let i = 0; i < SPEED_LINE_COUNT; i++) {
      offsets[i] = Math.random() * Math.PI * 2
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1))
    speedLineOffsets.current = offsets
    return geo
  }, [])

  const speedLineMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 1.5);
        gl_FragColor = vec4(uColor * glow * 4.0, vAlpha * glow);
      }
    `,
    uniforms: { uColor: { value: new THREE.Color(0.5, 0.9, 1.0) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [])

  // ── Trail shader material (rebuilt when trail style changes) ──
  const trailMatRef = useRef<THREE.ShaderMaterial>(null!)
  if (!trailMatRef.current) {
    trailMatRef.current = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERTEX,
      fragmentShader: getTrailFragmentShader('comet'),
      uniforms: { uColor: { value: orbColor } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }

  // ── Get current shape geometry ──
  const shapeGeo = useShapeGeometry(currentShapeStyle.current)

  // ── Trail state ──
  const trailPositions = useRef(
    Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector3()),
  )
  const trailAlphas = useRef(new Array<number>(TRAIL_LENGTH).fill(0))
  const trailSeeded = useRef(false)

  // HMR safety: extend arrays if TRAIL_LENGTH increased
  if (trailPositions.current.length < TRAIL_LENGTH) {
    while (trailPositions.current.length < TRAIL_LENGTH) {
      trailPositions.current.push(new THREE.Vector3())
      trailAlphas.current.push(0)
    }
  }

  useEffect(() => () => {
    trailGeo.dispose()
    speedLineGeo.dispose()
    speedLineMat.dispose()
    if (trailMatRef.current) trailMatRef.current.dispose()
  }, [trailGeo, speedLineGeo, speedLineMat])

  useFrame((state, delta) => {
    const flightState = flightController.getState()
    const modState = starModSlots.getState()
    const time = state.clock.elapsedTime

    // ── Check for mod style changes ──
    if (modState.trail !== currentTrailStyle.current) {
      currentTrailStyle.current = modState.trail
      trailMatRef.current.fragmentShader = getTrailFragmentShader(modState.trail)
      trailMatRef.current.needsUpdate = true
    }
    currentAuraStyle.current = modState.aura
    currentShapeStyle.current = modState.shape

    // ── Update orb position/rotation ──
    if (groupRef.current) {
      groupRef.current.position.copy(flightState.position)
      groupRef.current.quaternion.copy(flightState.quaternion)

      // ── Slingshot pulse: smooth scale burst + decay ──
      if (slingshotPulse.current > 0.01) {
        const pulseScale = 1.0 + slingshotPulse.current * 0.15 // up to 1.15× (subtle, no flicker)
        groupRef.current.scale.setScalar(pulseScale)
        slingshotPulse.current *= Math.pow(0.1, delta) // smooth decay (~0.5s)
      } else {
        groupRef.current.scale.setScalar(1.0)
        slingshotPulse.current = 0
      }
    }

    // ── Update aura effect ──
    if (auraRef.current) {
      const auraMat = auraRef.current.material as THREE.MeshBasicMaterial
      switch (modState.aura) {
        case 'pulse': {
          const pulse = 0.15 + Math.sin(time * 3) * 0.1
          auraMat.opacity = pulse
          auraRef.current.scale.setScalar(1 + Math.sin(time * 3) * 0.15)
          break
        }
        case 'rings': {
          auraMat.opacity = 0.1
          auraRef.current.rotation.y = time * 1.5
          auraRef.current.rotation.x = Math.sin(time * 0.5) * 0.3
          break
        }
        case 'flame': {
          auraMat.opacity = 0.15 + Math.sin(time * 8) * 0.08
          const flicker = 1 + Math.sin(time * 8) * 0.1 + Math.sin(time * 13) * 0.05
          auraRef.current.scale.setScalar(flicker)
          break
        }
        case 'none': {
          auraMat.opacity = 0
          break
        }
        case 'glow':
        default: {
          auraMat.opacity = 0.2
          auraRef.current.scale.setScalar(1)
          break
        }
      }
    }

    // ── Update trail ──
    frameCount.current++

    // Seed all trail positions to current pos on first frame so they
    // don't sit at (0,0,0) — that makes the trail invisible when the
    // player spawns far from the origin.
    if (!trailSeeded.current) {
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        trailPositions.current[i].copy(flightState.position)
      }
      trailSeeded.current = true
    }

    if (frameCount.current % TRAIL_SPACING_FRAMES === 0 && modState.trail !== 'none') {
      for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
        trailPositions.current[i].copy(trailPositions.current[i - 1])
        trailAlphas.current[i] = trailAlphas.current[i - 1] * 0.95 // gentle decay = longer visible trail
      }
      trailPositions.current[0].copy(flightState.position)

      // Trail brightness varies by style — higher floor so it's always visible
      let alphaScale = 1.0
      if (modState.trail === 'sparkle') alphaScale = 0.85
      if (modState.trail === 'helix') alphaScale = 0.9
      trailAlphas.current[0] = Math.min(0.55 + flightState.speed / 4, 1.0) * alphaScale
    }

    // Write trail to buffer
    if (trailRef.current) {
      const posArr = trailGeo.attributes.position.array as Float32Array
      const alphaArr = trailGeo.attributes.alpha.array as Float32Array
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        posArr[i * 3] = trailPositions.current[i].x
        posArr[i * 3 + 1] = trailPositions.current[i].y
        posArr[i * 3 + 2] = trailPositions.current[i].z
        alphaArr[i] = trailAlphas.current[i]
      }
      trailGeo.attributes.position.needsUpdate = true
      trailGeo.attributes.alpha.needsUpdate = true
    }

    // ── Update speed lines ──
    speedLineTimer.current = Math.max(0, speedLineTimer.current - delta)
    if (speedLinesRef.current) {
      speedLinesRef.current.visible = speedLineTimer.current > 0.01
      if (speedLineTimer.current > 0.01) {
        const vel = flightState.velocity.clone().normalize()
        const right = new THREE.Vector3().crossVectors(vel, new THREE.Vector3(0, 1, 0)).normalize()
        const up = new THREE.Vector3().crossVectors(right, vel).normalize()
        const positions = speedLineGeo.attributes.position as THREE.BufferAttribute
        const alphas = speedLineGeo.attributes.alpha as THREE.BufferAttribute
        const offsets = speedLineOffsets.current!
        const progress = 1 - speedLineTimer.current / SPEED_LINE_LIFETIME

        for (let i = 0; i < SPEED_LINE_COUNT; i++) {
          const angle = offsets[i]
          const spread = 1.5 + Math.sin(offsets[i] * 3.7) * 0.8
          const streak = progress * 5.0 + offsets[i] * 0.8
          const pos = flightState.position.clone()
            .addScaledVector(vel, -streak) // behind the player
            .addScaledVector(right, Math.cos(angle) * spread)
            .addScaledVector(up, Math.sin(angle) * spread)
          positions.setXYZ(i, pos.x, pos.y, pos.z)
          alphas.setX(i, (1 - progress) * 0.85)
        }
        positions.needsUpdate = true
        alphas.needsUpdate = true
      }
    }
  })

  return (
    <>
      <group ref={groupRef}>
        {/* Inner core — bright, shape driven by mod slot */}
        <mesh geometry={shapeGeo}>
          <meshBasicMaterial
            color={orbColor}
            transparent
            opacity={0.95}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Outer aura — style driven by mod slot */}
        <mesh ref={auraRef}>
          <sphereGeometry args={[0.35, 14, 14]} />
          <meshBasicMaterial
            color={orbColor}
            transparent
            opacity={0.35}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
            side={THREE.BackSide}
          />
        </mesh>

        {/* Directional glow */}
        <mesh>
          <sphereGeometry args={[0.22, 12, 12]} />
          <meshBasicMaterial
            color="white"
            transparent
            opacity={0.15}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Point light */}
        <pointLight color={orbColor} intensity={3.0} distance={8} decay={2} />
      </group>

      {/* Trail — shader varies by mod slot (frustumCulled=false because
           positions update every frame and the bounding sphere goes stale) */}
      <points ref={trailRef} geometry={trailGeo} material={trailMatRef.current} frustumCulled={false} />

      {/* Speed lines — burst on slingshot exit */}
      <points ref={speedLinesRef} geometry={speedLineGeo} material={speedLineMat} visible={false} frustumCulled={false} />
    </>
  )
}

// ── Module-level slingshot pulse trigger ──

interface PulseRef {
  slingshotPulse: React.MutableRefObject<number>
  speedLineTimer: React.MutableRefObject<number>
}
let _pulseRef: PulseRef | null = null

/**
 * Trigger the slingshot speed boost VFX on the player orb.
 * Call from Scene.tsx when a slingshot event fires.
 */
export function triggerSlingshotPulse(): void {
  if (_pulseRef) {
    _pulseRef.slingshotPulse.current = 1.0
    _pulseRef.speedLineTimer.current = SPEED_LINE_LIFETIME
  }
}

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

const TRAIL_LENGTH = 24
const TRAIL_SPACING_FRAMES = 2

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
    gl_PointSize = max(2.0, 10.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`

export function PlayerOrb({ color }: PlayerOrbProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const trailRef = useRef<THREE.Points>(null!)
  const auraRef = useRef<THREE.Mesh>(null!)
  const frameCount = useRef(0)

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

  useEffect(() => () => {
    trailGeo.dispose()
    if (trailMatRef.current) trailMatRef.current.dispose()
  }, [trailGeo])

  useFrame((state) => {
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
    if (frameCount.current % TRAIL_SPACING_FRAMES === 0 && modState.trail !== 'none') {
      for (let i = TRAIL_LENGTH - 1; i > 0; i--) {
        trailPositions.current[i].copy(trailPositions.current[i - 1])
        trailAlphas.current[i] = trailAlphas.current[i - 1] * 0.86
      }
      trailPositions.current[0].copy(flightState.position)

      // Trail brightness varies by style
      let alphaScale = 0.9
      if (modState.trail === 'sparkle') alphaScale = 0.7
      if (modState.trail === 'helix') alphaScale = 0.8
      trailAlphas.current[0] = Math.min(flightState.speed / 8, 1.0) * alphaScale
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
          <sphereGeometry args={[0.3, 14, 14]} />
          <meshBasicMaterial
            color={orbColor}
            transparent
            opacity={0.2}
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
        <pointLight color={orbColor} intensity={1.5} distance={5} decay={2} />
      </group>

      {/* Trail — shader varies by mod slot */}
      <points ref={trailRef} geometry={trailGeo} material={trailMatRef.current} />
    </>
  )
}

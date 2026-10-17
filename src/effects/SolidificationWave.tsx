/**
 * Aweborn — The Solidification Wave & the Living Frontier (Phase 05)
 *
 * Three pieces, all driven by `waveStore`:
 *  - **FrontierEdge**: the sphere of light at `mana.frontierRadius`. Faint
 *    lattice that brightens where you're close to it; flares while a wave
 *    pushes it outward by the gift's true amount.
 *  - **WaveShell**: the golden shockwave from the Aweborn Portal. Same size
 *    for every gift (WAVE_MAX_RADIUS over WAVE_DURATION_S).
 *  - **SolidifyBursts**: when the front reaches a world this gift solidified,
 *    its wireframe bursts into golden sparks and it reforms solid
 *    (UniverseWorlds holds it as a Ghost until then, via `heldAsGhost`).
 *
 * Not yet: refraction of the stars behind the shell, audio (no audio system
 * yet), opt-in donor names (the banner says "a generous soul").
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useUniverseStore } from '../stores/universeStore'
import {
  useWaveStore,
  waveFront,
  waveProgress,
  displayedFrontier,
  WAVE_MAX_RADIUS,
} from '../stores/waveStore'

const GOLD = new THREE.Color('#f2c45a')
const WHITE_GOLD = new THREE.Color('#fff4d6')

// ── Shared vertex shader (world position + view-space normal) ────────

const shellVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = viewMatrix * world;
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

// ── The golden shockwave ─────────────────────────────────────────────

const waveFragment = /* glsl */ `
  uniform vec3 uGold;
  uniform vec3 uWhite;
  uniform float uTime;
  uniform float uFade;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.2);
    // Slow ripples crawling over the shell, so it reads as energy, not glass.
    float ripple = 0.5 + 0.5 * sin(vWorldPos.x * 0.09 + vWorldPos.y * 0.07 - uTime * 2.4)
                       * sin(vWorldPos.z * 0.08 - vWorldPos.y * 0.05 + uTime * 1.7);
    float a = (rim * 0.95 + 0.05 + ripple * 0.10) * uFade;
    vec3 col = mix(uGold, uWhite, rim * 0.6 + ripple * 0.2);
    gl_FragColor = vec4(col * (1.0 + rim * 1.6), a);
  }
`

function WaveShell() {
  const mesh = useRef<THREE.Mesh>(null!)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shellVertex,
    fragmentShader: waveFragment,
    uniforms: {
      uGold: { value: GOLD },
      uWhite: { value: WHITE_GOLD },
      uTime: { value: 0 },
      uFade: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame((state) => {
    const p = waveProgress()
    const front = waveFront()
    if (p === null || front === null) {
      mesh.current.visible = false
      return
    }
    mesh.current.visible = true
    mesh.current.scale.setScalar(Math.max(0.5, front))
    mat.uniforms.uTime.value = state.clock.elapsedTime
    // Swell in fast, linger, fade at the far end.
    mat.uniforms.uFade.value = Math.min(1, p * 12) * (1 - Math.pow(p, 3))

    // The front sweeps past the player: flash once (WaveBanner listens).
    const cam = state.camera.position.length()
    const w = useWaveStore.getState()
    if (w.passedAt === null && front >= cam && cam < WAVE_MAX_RADIUS) {
      useWaveStore.setState({ passedAt: performance.now() })
    }
    if (p >= 1) w.end()
  })

  return (
    <mesh ref={mesh} material={mat} visible={false} frustumCulled={false} renderOrder={10}>
      <sphereGeometry args={[1, 96, 64]} />
    </mesh>
  )
}

// ── The Living Frontier edge ─────────────────────────────────────────

const edgeFragment = /* glsl */ `
  uniform vec3 uGold;
  uniform vec3 uCam;
  uniform float uTime;
  uniform float uFlare;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  // Screen-space antialiased grid line (~1 px), faded out where the cells get
  // smaller than a few pixels. Without this, thin lines alias and shimmer
  // (gold/dark flicker, amplified by bloom) while the edge grows.
  float line(float x) {
    float fw = max(fwidth(x), 1e-4);
    float distToLine = (0.5 - abs(fract(x) - 0.5)) / fw;
    float l = 1.0 - smoothstep(0.0, 1.25, distToLine);
    return l * (1.0 - smoothstep(0.06, 0.2, fw));
  }
  void main() {
    // A lattice of light: meridians + parallels.
    float g = max(line(vUv.x * 64.0), line(vUv.y * 32.0));
    float d = distance(vWorldPos, uCam);
    float near = smoothstep(35.0, 3.0, d);              // the wall shows itself only when you're close
    float shimmer = 0.75 + 0.25 * sin(uTime * 1.3 + vUv.x * 40.0 + vUv.y * 25.0);
    float a = (g * (0.006 + near * 0.4) + near * 0.02) * shimmer;
    a += uFlare * (0.015 + g * 0.12);
    gl_FragColor = vec4(uGold * (1.0 + g * 0.5 + uFlare), a);
  }
`

function FrontierEdge() {
  const hasFrontier = useUniverseStore((s) => (s.mana?.frontierRadius ?? 0) > 0)
  const mesh = useRef<THREE.Mesh>(null!)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shellVertex,
    fragmentShader: edgeFragment,
    uniforms: {
      uGold: { value: GOLD },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uFlare: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame((state) => {
    if (!mesh.current) return
    mesh.current.scale.setScalar(Math.max(1, displayedFrontier()))
    mat.uniforms.uCam.value.copy(state.camera.position)
    mat.uniforms.uTime.value = state.clock.elapsedTime
    const p = waveProgress()
    mat.uniforms.uFlare.value = p === null ? 0 : Math.sin(Math.PI * Math.min(1, p * 1.4)) * 0.6
  })

  if (!hasFrontier) return null
  return (
    <mesh ref={mesh} material={mat} frustumCulled={false} renderOrder={9}>
      <sphereGeometry args={[1, 128, 64]} />
    </mesh>
  )
}

// ── Ghost → Solid bursts ─────────────────────────────────────────────

const BURST_COUNT = 90
const BURST_LIFE_S = 1.8
const MAX_BURSTS = 40

const burstVertex = /* glsl */ `
  attribute vec3 aDir;
  uniform float uAge;
  varying float vFade;
  void main() {
    float t = uAge;
    // Shatter outward, then fall back in (reform).
    float out_ = 1.0 - exp(-t * 4.0);
    float back = smoothstep(0.6, 1.6, t);
    vec3 p = aDir * (out_ * (1.0 - back * 0.85)) * 3.2;
    vFade = 1.0 - smoothstep(1.0, 1.8, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (2.5 + 4.0 * (1.0 - t / 1.8)) * (60.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const burstFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGold;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r) * vFade;
    gl_FragColor = vec4(mix(uGold, uColor, 0.35) * 2.0, a);
  }
`

/** One set of unit-ish directions shared by every burst. */
const burstDirs = (() => {
  const a = new Float32Array(BURST_COUNT * 3)
  for (let i = 0; i < BURST_COUNT; i++) {
    const u = Math.random() * 2 - 1
    const th = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const len = 0.5 + Math.random() * 0.7
    a[i * 3] = s * Math.cos(th) * len
    a[i * 3 + 1] = u * len
    a[i * 3 + 2] = s * Math.sin(th) * len
  }
  return a
})()

interface Burst { key: string; pos: [number, number, number]; color: string; born: number }

function SolidifyBurst({ burst, onDone }: { burst: Burst; onDone: (key: string) => void }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_COUNT * 3), 3))
    g.setAttribute('aDir', new THREE.BufferAttribute(burstDirs, 3))
    return g
  }, [])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: burstVertex,
    fragmentShader: burstFragment,
    uniforms: {
      uAge: { value: 0 },
      uColor: { value: new THREE.Color(burst.color) },
      uGold: { value: GOLD },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), [burst.color])
  useEffect(() => () => { geom.dispose(); mat.dispose() }, [geom, mat])

  useFrame(() => {
    const age = (performance.now() - burst.born) / 1000
    mat.uniforms.uAge.value = age
    if (age > BURST_LIFE_S) onDone(burst.key)
  })

  return <points geometry={geom} material={mat} position={burst.pos} frustumCulled={false} />
}

function SolidifyBursts() {
  const [bursts, setBursts] = useState<Burst[]>([])
  const fired = useRef(new Set<string>())
  const seq = useWaveStore((s) => s.seq)

  useEffect(() => { fired.current = new Set() }, [seq])

  useFrame(() => {
    const { pendingGhosts, startedAt } = useWaveStore.getState()
    if (startedAt === null || pendingGhosts.size === 0) return
    const front = waveFront() ?? 0
    const worlds = useUniverseStore.getState().worlds
    const fresh: Burst[] = []
    for (const id of pendingGhosts) {
      if (fired.current.has(id)) continue
      const w = worlds.get(id)
      // Only worlds the server actually solidified with this gift.
      if (!w || !w.solidified) continue
      const p = w.resolvedPosition
      if (Math.hypot(p.x, p.y, p.z) > front) continue
      fired.current.add(id)
      fresh.push({ key: `${seq}:${id}`, pos: [p.x, p.y, p.z], color: w.color, born: performance.now() })
    }
    if (fresh.length) setBursts((b) => [...b, ...fresh].slice(-MAX_BURSTS))
  })

  const done = (key: string) => setBursts((b) => b.filter((x) => x.key !== key))
  return <>{bursts.map((b) => <SolidifyBurst key={b.key} burst={b} onDone={done} />)}</>
}

// ── Public component ─────────────────────────────────────────────────

export function SolidificationWave() {
  return (
    <>
      <FrontierEdge />
      <WaveShell />
      <SolidifyBursts />
    </>
  )
}

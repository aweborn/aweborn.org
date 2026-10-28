/**
 * Aweborn — Card beam (Rough Draft M6a, Phase 05 "card swell")
 *
 * When a card of a world is paid for, a column of golden light stands on
 * that world for CARD_BEAM_S, so everyone online can see which world just
 * came into someone's hand. Driven by `waveStore.beam` (also previewable
 * with `awebornCard()` in the console).
 *
 * One open cylinder, additive, soft at its silhouette (view-angle fade) and
 * at both ends; a slow upward shimmer; tinted toward the world's color.
 * Mounted only while a beam is live.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useUniverseStore } from '../stores/universeStore'
import { beamStrength, useWaveStore, CARD_BEAM_S } from '../stores/waveStore'

const GOLD = new THREE.Color('#f2c45a')
/** Beam length, through the world (u). */
const BEAM_LENGTH = 520
const BEAM_RADIUS = 1.8

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCam;
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uStrength;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 v = normalize(uCam - vPosW);
    float facing = abs(dot(normalize(vNormalW), v));   // 1 at the core, 0 at the silhouette
    float core = pow(facing, 2.2);
    float ends = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    float mid = 1.0 + 1.6 * exp(-pow((vUv.y - 0.5) * 18.0, 2.0)); // brighter where it meets the world
    float shimmer = 0.78 + 0.22 * sin(vUv.y * 90.0 - uTime * 3.0);
    // Standing right beside it (just stepped out), it would fill the screen: dim it up close
    float near = mix(0.12, 1.0, smoothstep(4.0, 40.0, length(uCam.xz - uCenter.xz)));
    float a = core * ends * mid * shimmer * near * uStrength * 0.45;
    gl_FragColor = vec4(uColor * (1.2 + core), a);
  }
`

function Beam({ worldId, startedAt }: { worldId: string; startedAt: number }) {
  const group = useRef<THREE.Group>(null!)
  const mat = useMemo(() => {
    const w = useUniverseStore.getState().worlds.get(worldId)
    const color = GOLD.clone().lerp(new THREE.Color(w?.color ?? '#f2c45a'), 0.25)
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uColor: { value: color },
        uCam: { value: new THREE.Vector3() },
        uCenter: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uStrength: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  }, [worldId])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame((state) => {
    const w = useUniverseStore.getState().worlds.get(worldId)
    const s = beamStrength()
    if (!w || s === null) {
      // Done (or the world left): clear it, once
      if (useWaveStore.getState().beam?.startedAt === startedAt) useWaveStore.setState({ beam: null })
      group.current.visible = false
      return
    }
    group.current.visible = true
    group.current.position.set(w.resolvedPosition.x, w.resolvedPosition.y, w.resolvedPosition.z)
    // Keep a few pixels of width from across the universe (1× up close, up to 6× far away)
    const k = Math.min(6, Math.max(1, state.camera.position.distanceTo(group.current.position) / 90))
    group.current.scale.set(k, 1, k)
    mat.uniforms.uCam.value.copy(state.camera.position)
    mat.uniforms.uCenter.value.copy(group.current.position)
    mat.uniforms.uTime.value = state.clock.elapsedTime
    mat.uniforms.uStrength.value = s
  })

  return (
    <group ref={group} visible={false}>
      <mesh material={mat} frustumCulled={false} renderOrder={10}>
        <cylinderGeometry args={[BEAM_RADIUS, BEAM_RADIUS, BEAM_LENGTH, 32, 1, true]} />
      </mesh>
    </group>
  )
}

export function CardBeam() {
  const beam = useWaveStore((s) => s.beam)
  // Safety net: drop a stale beam even if the scene wasn't rendering frames
  useEffect(() => {
    if (!beam) return
    const t = setTimeout(() => {
      if (useWaveStore.getState().beam?.startedAt === beam.startedAt) useWaveStore.setState({ beam: null })
    }, CARD_BEAM_S * 1000 + 500)
    return () => clearTimeout(t)
  }, [beam])
  if (!beam) return null
  return <Beam key={beam.startedAt} worldId={beam.worldId} startedAt={beam.startedAt} />
}

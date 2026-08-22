import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { warpSystem, type WarpPhase } from '../systems/WarpSystem'
import { flightController } from '../systems/FlightController'

/**
 * Warp visual effects — charge streaks, leap blur, arrival flash.
 *
 * During charge: radial light streaks compress toward the player.
 * During leap: star-streak lines in the velocity direction.
 * On arrival: bright flash dispersing outward.
 */

const STREAK_COUNT = 40
const ARRIVAL_PARTICLE_COUNT = 24

export function WarpEffect() {
  const chargeStreaksRef = useRef<THREE.Points>(null!)
  const arrivalRef = useRef<THREE.Points>(null!)
  const flashRef = useRef<THREE.Mesh>(null!)
  const prevPhase = useRef<WarpPhase>('idle')
  const arrivalTimer = useRef(0)

  // ── Charge streaks geometry ──
  const chargeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(STREAK_COUNT * 3)
    const alphas = new Float32Array(STREAK_COUNT)
    const offsets = new Float32Array(STREAK_COUNT) // Random radial offsets
    for (let i = 0; i < STREAK_COUNT; i++) {
      offsets[i] = Math.random() * Math.PI * 2
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1))
    return geo
  }, [])

  const chargeMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(2.0, 12.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = 1.0 - d * 2.0;
        vec3 color = mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 1.0, 1.0), glow);
        gl_FragColor = vec4(color * 2.0, vAlpha * glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [])

  // ── Arrival particles geometry ──
  const arrivalGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(ARRIVAL_PARTICLE_COUNT * 3)
    const velocities: THREE.Vector3[] = []
    for (let i = 0; i < ARRIVAL_PARTICLE_COUNT; i++) {
      // Random outward direction
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      ).normalize().multiplyScalar(3 + Math.random() * 4))
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const alphas = new Float32Array(ARRIVAL_PARTICLE_COUNT)
    geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
    ;(geo as any)._velocities = velocities
    return geo
  }, [])

  const arrivalMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(3.0, 16.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = 1.0 - d * 2.0;
        vec3 color = vec3(1.0, 0.95, 0.8);
        gl_FragColor = vec4(color * 2.5, vAlpha * glow * glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [])

  useEffect(() => () => {
    chargeGeo.dispose(); chargeMat.dispose()
    arrivalGeo.dispose(); arrivalMat.dispose()
  }, [chargeGeo, chargeMat, arrivalGeo, arrivalMat])

  useFrame((state, delta) => {
    const warp = warpSystem.getState()
    const playerPos = flightController.position

    // ── Detect phase transitions ──
    if (warp.phase === 'arriving' && prevPhase.current === 'leaping') {
      arrivalTimer.current = 0.8 // Start arrival particle animation
      // Initialize arrival particles at player position
      const posArr = arrivalGeo.attributes.position.array as Float32Array
      for (let i = 0; i < ARRIVAL_PARTICLE_COUNT; i++) {
        posArr[i * 3] = playerPos.x
        posArr[i * 3 + 1] = playerPos.y
        posArr[i * 3 + 2] = playerPos.z
      }
      arrivalGeo.attributes.position.needsUpdate = true
    }
    prevPhase.current = warp.phase

    // ── Charge streaks ──
    const showCharge = warp.phase === 'charging' || warp.phase === 'leaping'
    if (chargeStreaksRef.current) {
      chargeStreaksRef.current.visible = showCharge

      if (showCharge) {
        const posArr = chargeGeo.attributes.position.array as Float32Array
        const alphaArr = chargeGeo.attributes.alpha.array as Float32Array
        const offsetArr = chargeGeo.attributes.offset.array as Float32Array
        const t = state.clock.elapsedTime

        for (let i = 0; i < STREAK_COUNT; i++) {
          const angle = offsetArr[i] + t * (1 + warp.chargeProgress * 3)
          // Radius shrinks as charge builds (streaks compress inward)
          const baseRadius = 2 + (1 - warp.chargeProgress) * 3
          const radius = baseRadius + Math.sin(t * 3 + i) * 0.3
          const height = (Math.random() - 0.5) * 2

          posArr[i * 3] = playerPos.x + Math.cos(angle) * radius
          posArr[i * 3 + 1] = playerPos.y + height
          posArr[i * 3 + 2] = playerPos.z + Math.sin(angle) * radius

          // Alpha increases with charge
          alphaArr[i] = warp.chargeProgress * 0.8 * (0.5 + Math.sin(t * 5 + i) * 0.5)
        }
        chargeGeo.attributes.position.needsUpdate = true
        chargeGeo.attributes.alpha.needsUpdate = true
      }
    }

    // ── Flash on leap/arrival ──
    if (flashRef.current) {
      if (warp.phase === 'leaping') {
        flashRef.current.visible = true
        flashRef.current.position.copy(playerPos)
        const flashScale = 1 + warp.leapProgress * 5
        flashRef.current.scale.setScalar(flashScale)
        ;(flashRef.current.material as THREE.MeshBasicMaterial).opacity =
          warp.leapProgress < 0.3 ? warp.leapProgress / 0.3 * 0.6 : (1 - warp.leapProgress) * 0.6
      } else if (arrivalTimer.current > 0) {
        flashRef.current.visible = true
        flashRef.current.position.copy(playerPos)
        flashRef.current.scale.setScalar(2 + (0.8 - arrivalTimer.current) * 4)
        ;(flashRef.current.material as THREE.MeshBasicMaterial).opacity = arrivalTimer.current * 0.8
      } else {
        flashRef.current.visible = false
      }
    }

    // ── Arrival particles ──
    if (arrivalRef.current) {
      if (arrivalTimer.current > 0) {
        arrivalRef.current.visible = true
        arrivalTimer.current = Math.max(0, arrivalTimer.current - delta)

        const posArr = arrivalGeo.attributes.position.array as Float32Array
        const alphaArr = arrivalGeo.attributes.alpha.array as Float32Array
        const velocities = (arrivalGeo as any)._velocities as THREE.Vector3[]

        for (let i = 0; i < ARRIVAL_PARTICLE_COUNT; i++) {
          posArr[i * 3] += velocities[i].x * delta
          posArr[i * 3 + 1] += velocities[i].y * delta
          posArr[i * 3 + 2] += velocities[i].z * delta
          alphaArr[i] = arrivalTimer.current * 1.2
        }
        arrivalGeo.attributes.position.needsUpdate = true
        arrivalGeo.attributes.alpha.needsUpdate = true
      } else {
        arrivalRef.current.visible = false
      }
    }
  })

  return (
    <>
      {/* Charge streaks — spiral inward during charge */}
      <points ref={chargeStreaksRef} geometry={chargeGeo} material={chargeMat} visible={false} />

      {/* Flash — bright sphere during leap and arrival */}
      <mesh ref={flashRef} visible={false}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Arrival particles — burst outward on landing */}
      <points ref={arrivalRef} geometry={arrivalGeo} material={arrivalMat} visible={false} />
    </>
  )
}

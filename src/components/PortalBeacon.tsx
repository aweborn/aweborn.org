import { useRef, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

/**
 * PortalBeacon — A tall, faint golden light beam emanating from the
 * Aweborn Portal. Visible from anywhere in the scene as a wayfinding cue.
 *
 * Uses a double-sided plane with additive blending and a vertical gradient
 * (bright at base, transparent at top). Two crossed planes create an
 * omnidirectional column of light.
 */

/** Portal position — must match GravitySystem and UniverseWorlds */
const PORTAL_POS = new THREE.Vector3(0, 1, -8)

/** Beam height in scene units */
const BEAM_HEIGHT = 60

/** Beam width at the base */
const BEAM_WIDTH = 0.6

export function PortalBeacon() {
  const materialRef1 = useRef<THREE.ShaderMaterial>(null)
  const materialRef2 = useRef<THREE.ShaderMaterial>(null)

  const shaderData = useMemo(() => ({
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        // Vertical fade: bright at bottom, transparent at top
        float fade = pow(1.0 - vUv.y, 2.0);

        // Horizontal fade: centered, transparent at edges
        float hFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
        hFade = smoothstep(0.0, 0.8, hFade);

        // Subtle pulse animation
        float pulse = 0.85 + 0.15 * sin(uTime * 1.2 + vUv.y * 4.0);

        // Warm golden color
        vec3 color = vec3(1.0, 0.82, 0.3);

        float alpha = fade * hFade * pulse * 0.06;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    uniforms: {
      uTime: { value: 0 },
    },
  }), [])

  // Clone uniforms for the second plane so they share the time value
  const uniforms2 = useMemo(() => ({
    uTime: shaderData.uniforms.uTime,
  }), [shaderData])

  useFrame((_state, _delta) => {
    shaderData.uniforms.uTime.value += _delta
  })

  return (
    <group position={[PORTAL_POS.x, PORTAL_POS.y, PORTAL_POS.z]}>
      {/* First plane — facing X */}
      <mesh position={[0, BEAM_HEIGHT / 2, 0]}>
        <planeGeometry args={[BEAM_WIDTH, BEAM_HEIGHT]} />
        <shaderMaterial
          ref={materialRef1}
          vertexShader={shaderData.vertexShader}
          fragmentShader={shaderData.fragmentShader}
          uniforms={shaderData.uniforms}
          transparent
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Second plane — rotated 90° for omnidirectional visibility */}
      <mesh position={[0, BEAM_HEIGHT / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[BEAM_WIDTH, BEAM_HEIGHT]} />
        <shaderMaterial
          ref={materialRef2}
          vertexShader={shaderData.vertexShader}
          fragmentShader={shaderData.fragmentShader}
          uniforms={uniforms2}
          transparent
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

/**
 * Aweborn — World Glow Shader
 *
 * Custom ShaderMaterial for world stars in the universe view.
 * Features:
 *  - Fresnel-based edge glow (brighter at silhouette edges)
 *  - Animated pulse via uTime uniform
 *  - Color from world data (uColor)
 *  - Ghost variant: additive wireframe overlay + lower opacity
 *
 * Used by the Close LOD tier in UniverseWorlds.
 */

import * as THREE from 'three'

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uGhost;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    // Fresnel — brighter at edges (silhouette glow)
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 2.5);

    // Animated pulse
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5);

    // Core glow — bright at center, fades outward
    float core = 1.0 - fresnel * 0.4;

    // Combine
    float glow = (core + fresnel * 1.5) * pulse * uIntensity;

    // Ghost effect: reduce opacity, add shimmer
    float ghostAlpha = mix(1.0, 0.5 + 0.15 * sin(uTime * 3.0 + vUv.x * 10.0), uGhost);

    gl_FragColor = vec4(uColor * glow, ghostAlpha);
  }
`

export interface WorldGlowMaterialOptions {
  color: THREE.Color
  intensity?: number
  ghost?: boolean
}

export function createWorldGlowMaterial(options: WorldGlowMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: options.color },
      uTime: { value: 0 },
      uIntensity: { value: options.intensity ?? 1.4 },
      uGhost: { value: options.ghost ? 1.0 : 0.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    toneMapped: false,
  })
}

/**
 * Halo shader — used for the outer glow sphere.
 * Radial gradient that fades from center (bright) to edge (transparent).
 */
const haloVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`

const haloFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 1.5);

    // Softer pulse
    float pulse = 0.9 + 0.1 * sin(uTime * 1.2);

    float alpha = fresnel * uOpacity * pulse;
    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`

export function createHaloMaterial(color: THREE.Color, opacity = 0.3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: haloVertexShader,
    fragmentShader: haloFragmentShader,
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    toneMapped: false,
  })
}

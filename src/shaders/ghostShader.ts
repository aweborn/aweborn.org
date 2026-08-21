/**
 * Aweborn — Ghost World Shader
 *
 * Custom ShaderMaterial for ghost worlds (unsoldified, outside the Living Frontier).
 * Features:
 *  - Wireframe overlay with thin glowing lines
 *  - Translucent base with animated noise shimmer
 *  - Ethereal fresnel edge glow
 *  - Color tinted by world's palette but desaturated
 *
 * Visual hierarchy:
 *  - Solid: full opaque glow (worldGlow shader)
 *  - Ghost: wireframe + translucent (this shader)
 *  - Oasis: like Ghost but brighter core (patron-funded bubble)
 */

import * as THREE from 'three'

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vPosition = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOasis;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vPosition;
  varying vec2 vUv;

  // Simple hash for shimmer noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    // Fresnel edge glow
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 2.0);

    // Animated shimmer noise
    vec2 noiseCoord = vUv * 8.0 + vec2(uTime * 0.3, uTime * 0.2);
    float shimmer = noise(noiseCoord) * 0.6 + 0.4;

    // Desaturate the color for ghostly appearance
    float luma = dot(uColor, vec3(0.299, 0.587, 0.114));
    vec3 ghostColor = mix(vec3(luma), uColor, 0.4); // 40% saturation

    // Core opacity — very transparent with shimmer
    float baseAlpha = 0.15 + shimmer * 0.1;

    // Edge glow
    float edgeGlow = fresnel * 0.8;

    // Oasis boost — brighter, more saturated
    float oasisBoost = uOasis * 0.3;
    vec3 finalColor = mix(ghostColor, uColor, oasisBoost);
    float finalAlpha = baseAlpha + edgeGlow + oasisBoost * 0.2;

    // Pulse
    float pulse = 0.9 + 0.1 * sin(uTime * 2.0);
    finalAlpha *= pulse;

    gl_FragColor = vec4(finalColor * (1.0 + edgeGlow * 2.0), finalAlpha);
  }
`

export interface GhostMaterialOptions {
  color: THREE.Color
  isOasis?: boolean
}

export function createGhostMaterial(options: GhostMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: options.color },
      uTime: { value: 0 },
      uOasis: { value: options.isOasis ? 1.0 : 0.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    wireframe: false, // We simulate wireframe in the shader, but also add a wireframe overlay mesh
  })
}

/**
 * Wireframe overlay material for ghost worlds.
 * Renders as thin glowing lines on top of the ghost base.
 */
export function createGhostWireframeMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}

import * as THREE from 'three'
import { createWorldGlowMaterial, createHaloMaterial } from '../shaders/worldGlow'
import { createGhostMaterial, createGhostWireframeMaterial } from '../shaders/ghostShader'

/**
 * Live mini-render of a world for World Index cards (Phase 08B).
 *
 * One small offscreen WebGL renderer for every card: browsers allow only
 * ~16 live WebGL contexts, and the grid can hold hundreds of cards. Each draw
 * renders the world with the scene's own orb shaders (glow, halo, ghost
 * wireframe, ring), then copies the frame into the card's plain 2D canvas.
 *
 * - Still cards (the grid): drawn once, a few per frame, only when on screen.
 * - Live cards (hovered, detail view, reveal): redrawn at ~30 fps from one
 *   shared animation loop, which stops when nothing is live.
 *
 * If WebGL is unavailable (or the context is lost), `cardArtAvailable()` is
 * false and cards keep their CSS orb art.
 */

export interface CardLook {
  id: string
  color: string
  solidified: boolean
}

/** Backing size of the art window (55 × 45 mm on the card). */
export const ART_W = 550
export const ART_H = 450

const BG_BASE = new THREE.Color('#0a0a12')
const STAR_COUNT = 160

/** Deterministic 0..1 from a string (same as WorldCard's CSS art). */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0xffffffff
}

// ── Renderer (lazy singleton) ───────────────────────────────────────

interface Rig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  bg: THREE.ShaderMaterial
  stars: THREE.Points
  orb: THREE.Group
  glow: THREE.Mesh
  ghost: THREE.Mesh
  wire: THREE.Mesh
  halo: THREE.Mesh
  ring: THREE.Mesh
  glowMat: THREE.ShaderMaterial
  ghostMat: THREE.ShaderMaterial
  wireMat: THREE.MeshBasicMaterial
  haloMat: THREE.ShaderMaterial
  ringMat: THREE.MeshBasicMaterial
  lastStarsFor: string | null
}

let rig: Rig | null = null
let failed = false

function buildRig(): Rig | null {
  if (failed) return null
  if (rig) return rig
  try {
    const canvas = document.createElement('canvas')
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    })
    renderer.setPixelRatio(1)
    renderer.setSize(ART_W, ART_H, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    canvas.addEventListener('webglcontextlost', () => {
      // Drop it; the next draw rebuilds (or falls back if that fails too).
      rig = null
    })

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, ART_W / ART_H, 0.1, 100)
    camera.position.set(0, 0, 5.2)

    // Background: radial wash of the world's colour (matches the CSS art).
    const bg = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uBase: { value: BG_BASE.clone() } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uBase;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - vec2(0.5, 0.4)) * vec2(1.0, 0.82);
          float d = clamp(length(p) / 0.62, 0.0, 1.0);
          vec3 c = mix(mix(uBase, uColor, 0.18), uBase, smoothstep(0.0, 1.0, d));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bg)
    bgMesh.frustumCulled = false
    bgMesh.renderOrder = -1
    scene.add(bgMesh)

    // Stars: positions re-seeded per world.
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3))
    starGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(STAR_COUNT * 3), 3))
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 2.2,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    stars.frustumCulled = false
    scene.add(stars)

    // The orb, built like WorldOrbClose in UniverseWorlds.
    const white = new THREE.Color('#ffffff')
    const glowMat = createWorldGlowMaterial({ color: white.clone(), intensity: 1.6 })
    const ghostMat = createGhostMaterial({ color: white.clone() })
    const wireMat = createGhostWireframeMaterial(white.clone())
    wireMat.opacity = 0.28 // a touch brighter than in flight: the card is small
    const haloMat = createHaloMaterial(white.clone(), 0.35)
    const ringMat = new THREE.MeshBasicMaterial({
      color: white.clone(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })

    const orb = new THREE.Group()
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), glowMat)
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 32), ghostMat)
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.02, 2), wireMat)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 32), haloMat)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.02, 8, 96), ringMat)
    orb.add(glow, ghost, wire, halo, ring)
    scene.add(orb)

    rig = {
      renderer, scene, camera, bg, stars, orb, glow, ghost, wire, halo, ring,
      glowMat, ghostMat, wireMat, haloMat, ringMat, lastStarsFor: null,
    }
    return rig
  } catch (err) {
    console.warn('[cardArt] WebGL unavailable, keeping CSS card art:', err)
    failed = true
    return null
  }
}

export function cardArtAvailable(): boolean {
  return buildRig() !== null
}

function seedStars(r: Rig, id: string): void {
  if (r.lastStarsFor === id) return
  r.lastStarsFor = id
  const pos = r.stars.geometry.getAttribute('position') as THREE.BufferAttribute
  const col = r.stars.geometry.getAttribute('color') as THREE.BufferAttribute
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (hash01(id, 100 + i * 3) - 0.5) * 9
    const y = (hash01(id, 101 + i * 3) - 0.5) * 7.4
    const b = 0.25 + Math.pow(hash01(id, 102 + i * 3), 3) * 0.75
    pos.setXYZ(i, x, y, -6)
    col.setXYZ(i, b, b, b * 1.05)
  }
  pos.needsUpdate = true
  col.needsUpdate = true
}

function pose(r: Rig, look: CardLook, t: number): void {
  const color = new THREE.Color(look.color)
  const solid = look.solidified
  const size = solid ? 0.62 : 0.48

  r.bg.uniforms.uColor.value.copy(color)
  seedStars(r, look.id)

  r.glow.visible = solid
  r.ghost.visible = !solid
  r.wire.visible = !solid
  r.glow.scale.setScalar(size)
  r.ghost.scale.setScalar(size)
  r.wire.scale.setScalar(size)
  r.halo.scale.setScalar(size)
  r.ring.scale.setScalar(size)

  r.glowMat.uniforms.uColor.value.copy(color)
  r.ghostMat.uniforms.uColor.value.copy(color)
  r.wireMat.color.copy(color)
  r.haloMat.uniforms.uColor.value.copy(color)
  r.haloMat.uniforms.uOpacity.value = solid ? 0.35 : 0.18
  r.ringMat.color.copy(color)
  r.ringMat.opacity = solid ? 0.5 : 0.22
  r.ring.visible = solid || hash01(look.id, 7) > 0.4

  for (const m of [r.glowMat, r.ghostMat, r.haloMat]) m.uniforms.uTime.value = t

  // Per-world framing, then a slow turn and bob when live.
  const offset = hash01(look.id, 5) * Math.PI * 2
  r.orb.position.set((hash01(look.id, 3) - 0.5) * 0.5, -0.1 + (hash01(look.id, 4) - 0.5) * 0.3 + Math.sin(t * 0.8) * 0.05, 0)
  r.orb.rotation.set(0, t * 0.25, 0)
  r.ring.rotation.set(Math.PI * (0.36 + hash01(look.id, 8) * 0.12), 0, offset)
}

/** Render `look` at time `t` into a 2D canvas. False if WebGL is unavailable. */
export function drawCardArt(ctx: CanvasRenderingContext2D, look: CardLook, t: number): boolean {
  const r = buildRig()
  if (!r) return false
  pose(r, look, t)
  r.renderer.render(r.scene, r.camera)
  ctx.drawImage(r.renderer.domElement, 0, 0, ctx.canvas.width, ctx.canvas.height)
  return true
}

// ── Scheduling: still queue + live loop ─────────────────────────────

interface Target {
  ctx: CanvasRenderingContext2D
  look: CardLook
}

const STILLS_PER_FRAME = 6
const LIVE_FRAME_MS = 1000 / 30

const stills = new Map<HTMLCanvasElement, Target>()
const live = new Map<HTMLCanvasElement, Target>()
let raf = 0
let lastLive = 0
const t0 = performance.now()

function tick(now: number): void {
  raf = 0
  let n = 0
  for (const [canvas, target] of stills) {
    if (n++ >= STILLS_PER_FRAME) break
    stills.delete(canvas)
    // A still pose: the world's own phase, frozen.
    drawCardArt(target.ctx, target.look, hash01(target.look.id, 9) * 10)
  }
  if (live.size > 0 && now - lastLive >= LIVE_FRAME_MS) {
    lastLive = now
    const t = (now - t0) / 1000
    for (const target of live.values()) {
      drawCardArt(target.ctx, target.look, t + hash01(target.look.id, 9) * 10)
    }
  }
  if (stills.size > 0 || live.size > 0) raf = requestAnimationFrame(tick)
}

function wake(): void {
  if (!raf) raf = requestAnimationFrame(tick)
}

/** Queue a one-off still render (deduped per canvas). */
export function requestStill(canvas: HTMLCanvasElement, look: CardLook): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  stills.set(canvas, { ctx, look })
  wake()
}

export function cancelStill(canvas: HTMLCanvasElement): void {
  stills.delete(canvas)
}

/** Animate a canvas until the returned function is called. */
export function startLive(canvas: HTMLCanvasElement, look: CardLook): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  live.set(canvas, { ctx, look })
  lastLive = 0
  wake()
  return () => {
    live.delete(canvas)
  }
}

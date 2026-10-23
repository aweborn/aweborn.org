import * as THREE from 'three'
import { create } from 'zustand'
import { MeshoptSimplifier } from 'meshoptimizer'
import type { Box } from '@aweborn/shared/sim/interior'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'

/**
 * Tight colliders and client-side decimated LOD meshes for generated models.
 *
 * Full-resolution 120k-triangle PBR GLBs remain archived in S3 (`models/<sha>.glb`)
 * for future hardware. On the client, each loaded model is:
 *   1. Fitted into a centred unit cube `[-0.5, 0.5]^3` and binned into an 8×8
 *      column collider + instant ~200-tri silhouette fallback (`registerModelShape`).
 *   2. Decimated via `MeshoptSimplifier` (WASM) into 3 compact LOD geometries
 *      (`lod0` close ~900–1600 tris, `lod1` mid ~550 tris, `lod2` far ~200 tris)
 *      with compacted vertex buffers and blended high-res normals.
 *   3. Converted from a multi-texture `MeshStandardMaterial` to a single-texture
 *      `MeshLambertMaterial` whose 512×512 diffuse canvas has the normal-map
 *      relief, roughness crevices, and fine surface micro-grain baked directly in,
 *      while disposing the raw 120k geometry and heavy PBR textures from VRAM.
 */
const N = 8
const MAX_SAMPLES = 60000
const BAKED_TEX_PX = 512

/** Cells in fitted local space, each within [-0.5, 0.5]^3. */
type Cell = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; r: number; g: number; b: number }

export interface PreparedModelPart {
  /** Close-range mesh (capped by tier.modelMaxTris, e.g. 900–1600 tris on Low/Medium). */
  lod0: THREE.BufferGeometry
  /** Mid-range mesh (~550 tris). */
  lod1: THREE.BufferGeometry
  /** Far-range mesh (~200 tris, still UV-mapped to the baked texture). */
  lod2: THREE.BufferGeometry
  /** Lightweight Lambert material with normal/roughness relief & grain baked into a single map. */
  material: THREE.MeshLambertMaterial
}

export const useModelShapes = create<{
  shapes: Record<string, Cell[]>
  proxies: Record<string, THREE.BufferGeometry>
  models: Record<string, PreparedModelPart[]>
}>(() => ({ shapes: {}, proxies: {}, models: {} }))

const TEX_GRID = 16
let sampleCanvas: HTMLCanvasElement | null = null
let sampleCtx: CanvasRenderingContext2D | null = null

function readTextureGrid(img: unknown): Uint8ClampedArray | null {
  if (typeof document === 'undefined' || !img) return null
  try {
    if (!sampleCanvas) {
      sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = TEX_GRID
      sampleCanvas.height = TEX_GRID
      sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
    }
    if (!sampleCtx) return null
    sampleCtx.clearRect(0, 0, TEX_GRID, TEX_GRID)
    sampleCtx.drawImage(img as CanvasImageSource, 0, 0, TEX_GRID, TEX_GRID)
    return sampleCtx.getImageData(0, 0, TEX_GRID, TEX_GRID).data
  } catch {
    return null
  }
}

/** Build a single low-poly vertex-colored silhouette mesh (~150–400 tris) from the occupied 8×8 columns. */
function buildProxyGeometry(cells: Cell[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const pushQuad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    r: number, g: number, b: number,
    shade: number,
  ) => {
    const base = positions.length / 3
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz)
    for (let i = 0; i < 4; i++) {
      normals.push(nx, ny, nz)
      colors.push(r * shade, g * shade, b * shade)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  for (const c of cells) {
    const { x0, x1, z0, z1, y0, y1, r, g, b } = c
    // Top (+Y)
    pushQuad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0, r, g, b, 1.0)
    // Front (+Z)
    pushQuad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, r, g, b, 0.9)
    // Back (-Z)
    pushQuad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, r, g, b, 0.82)
    // Right (+X)
    pushQuad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, r, g, b, 0.86)
    // Left (-X)
    pushQuad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, r, g, b, 0.86)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeBoundingSphere()
  return geo
}

/** Call once per asset with the fitted (unit-cube, centred) group. */
export function registerModelShape(asset: string, fitted: THREE.Object3D): void {
  if (useModelShapes.getState().shapes[asset]) return
  fitted.updateMatrixWorld(true)
  const lo = new Float32Array(N * N).fill(Infinity)
  const hi = new Float32Array(N * N).fill(-Infinity)
  const cr = new Float32Array(N * N)
  const cg = new Float32Array(N * N)
  const cb = new Float32Array(N * N)
  const cc = new Uint32Array(N * N)
  const v = new THREE.Vector3()
  let total = 0
  fitted.traverse((o) => {
    const p = (o as THREE.Mesh).geometry?.attributes?.position
    if ((o as THREE.Mesh).isMesh && p) total += p.count
  })
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES))
  fitted.traverse((o) => {
    const mesh = o as THREE.Mesh
    const p = mesh.isMesh ? mesh.geometry?.attributes?.position : undefined
    if (!p) return
    const uv = mesh.geometry?.attributes?.uv
    const colAttr = mesh.geometry?.attributes?.color
    const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const stdMat = rawMat as THREE.MeshStandardMaterial | undefined
    const baseCol = stdMat?.color ?? new THREE.Color(0x9aa4b8)
    const texData = stdMat?.map?.image ? readTextureGrid(stdMat.map.image) : null

    for (let i = 0; i < p.count; i += stride) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld)
      const cx = Math.min(N - 1, Math.max(0, Math.floor((v.x + 0.5) * N)))
      const cz = Math.min(N - 1, Math.max(0, Math.floor((v.z + 0.5) * N)))
      const k = cz * N + cx
      if (v.y < lo[k]) lo[k] = v.y
      if (v.y > hi[k]) hi[k] = v.y

      let r = baseCol.r
      let g = baseCol.g
      let b = baseCol.b
      if (texData && uv && i < uv.count) {
        const u = ((uv.getX(i) % 1) + 1) % 1
        const vt = 1 - (((uv.getY(i) % 1) + 1) % 1)
        const tx = Math.min(TEX_GRID - 1, Math.floor(u * TEX_GRID))
        const ty = Math.min(TEX_GRID - 1, Math.floor(vt * TEX_GRID))
        const idx = (ty * TEX_GRID + tx) * 4
        r *= texData[idx] / 255
        g *= texData[idx + 1] / 255
        b *= texData[idx + 2] / 255
      } else if (colAttr && i < colAttr.count) {
        r *= colAttr.getX(i)
        g *= colAttr.getY(i)
        b *= colAttr.getZ(i)
      }
      cr[k] += r
      cg[k] += g
      cb[k] += b
      cc[k] += 1
    }
  })
  const cells: Cell[] = []
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const k = cz * N + cx
      if (hi[k] < lo[k]) continue
      const count = Math.max(1, cc[k])
      cells.push({
        x0: cx / N - 0.5,
        x1: (cx + 1) / N - 0.5,
        z0: cz / N - 0.5,
        z1: (cz + 1) / N - 0.5,
        y0: lo[k],
        y1: hi[k],
        r: Math.min(1, Math.max(0.08, cr[k] / count)),
        g: Math.min(1, Math.max(0.08, cg[k] / count)),
        b: Math.min(1, Math.max(0.08, cb[k] / count)),
      })
    }
  }
  const proxy = buildProxyGeometry(cells)
  useModelShapes.setState((s) => ({
    shapes: { ...s.shapes, [asset]: cells },
    proxies: { ...s.proxies, [asset]: proxy },
  }))
}

// ── Client-side Texture Relief Baking & Mesh Decimation ──────────────

let grainCanvas: HTMLCanvasElement | null = null
let sharedGrainTex: THREE.CanvasTexture | null = null
let normalScratchCanvas: HTMLCanvasElement | null = null
let normalScratchCtx: CanvasRenderingContext2D | null = null

/** 64×64 tileable micro-grain canvas + texture so low-poly surfaces retain crisp tactile detail up close. */
function getGrainCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (grainCanvas) return grainCanvas
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Deterministic multi-octave value noise centred on neutral 128
      const h1 = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
      const h2 = Math.sin(((x >> 1) + 17) * 39.346 + ((y >> 1) + 29) * 11.135) * 23421.631
      const n1 = h1 - Math.floor(h1)
      const n2 = h2 - Math.floor(h2)
      const val = Math.max(0, Math.min(255, Math.round(128 + (n1 * 0.65 + n2 * 0.35 - 0.5) * 72)))
      const idx = (y * size + x) * 4
      d[idx] = val
      d[idx + 1] = val
      d[idx + 2] = val
      d[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  grainCanvas = c
  return c
}

function getSharedGrainTexture(): THREE.CanvasTexture | null {
  if (sharedGrainTex) return sharedGrainTex
  const c = getGrainCanvas()
  if (!c) return null
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 6)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  sharedGrainTex = tex
  return tex
}

/**
 * Convert a heavy PBR `MeshStandardMaterial` into a single-texture `MeshLambertMaterial`.
 * Bakes `normalMap` bump relief, `roughnessMap`/`aoMap` crevices, and tactile micro-grain
 * directly into a 512×512 diffuse canvas, then disposes the original 1024×1024 PBR maps.
 */
function bakeLiteMaterial(
  rawMat: THREE.Material | undefined,
  hasUv: boolean,
  cache: Map<THREE.Material, THREE.MeshLambertMaterial>,
): THREE.MeshLambertMaterial {
  if (rawMat && cache.has(rawMat)) return cache.get(rawMat)!

  const std = rawMat as THREE.MeshStandardMaterial | undefined
  const baseColor = std?.color ? std.color.clone() : new THREE.Color(0xffffff)
  let bakedMap: THREE.Texture | null = null

  if (typeof document !== 'undefined' && std?.map?.image) {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = BAKED_TEX_PX
      canvas.height = BAKED_TEX_PX
      const ctx = canvas.getContext('2d')
      if (ctx) {
        // 1. Base diffuse albedo at 512×512 (4× smaller in VRAM than 1024×1024)
        ctx.drawImage(std.map.image as CanvasImageSource, 0, 0, BAKED_TEX_PX, BAKED_TEX_PX)

        // 2. Bake ambient occlusion / roughness crevices via multiply
        const creviceImg = (std.aoMap?.image ?? std.roughnessMap?.image) as CanvasImageSource | undefined
        if (creviceImg) {
          ctx.save()
          ctx.globalCompositeOperation = 'multiply'
          ctx.globalAlpha = 0.22
          ctx.drawImage(creviceImg, 0, 0, BAKED_TEX_PX, BAKED_TEX_PX)
          ctx.restore()
        }

        // 3. Bake normalMap high-frequency surface relief via desaturated overlay
        if (std.normalMap?.image) {
          if (!normalScratchCanvas) {
            normalScratchCanvas = document.createElement('canvas')
            normalScratchCanvas.width = BAKED_TEX_PX
            normalScratchCanvas.height = BAKED_TEX_PX
            normalScratchCtx = normalScratchCanvas.getContext('2d')
          }
          if (normalScratchCtx && normalScratchCanvas) {
            normalScratchCtx.globalCompositeOperation = 'source-over'
            normalScratchCtx.drawImage(std.normalMap.image as CanvasImageSource, 0, 0, BAKED_TEX_PX, BAKED_TEX_PX)
            normalScratchCtx.globalCompositeOperation = 'color'
            normalScratchCtx.fillStyle = '#808080'
            normalScratchCtx.fillRect(0, 0, BAKED_TEX_PX, BAKED_TEX_PX)

            ctx.save()
            ctx.globalCompositeOperation = 'overlay'
            ctx.globalAlpha = 0.36
            ctx.drawImage(normalScratchCanvas, 0, 0, BAKED_TEX_PX, BAKED_TEX_PX)
            ctx.restore()
          }
        }

        // 4. Tile subtle micro-grain so close-range surfaces feel crisp and tactile
        const grain = getGrainCanvas()
        const pattern = grain ? ctx.createPattern(grain, 'repeat') : null
        if (pattern) {
          ctx.save()
          ctx.globalCompositeOperation = 'overlay'
          ctx.globalAlpha = 0.1
          ctx.fillStyle = pattern
          ctx.fillRect(0, 0, BAKED_TEX_PX, BAKED_TEX_PX)
          ctx.restore()
        }

        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = std.map.flipY
        tex.wrapS = std.map.wrapS
        tex.wrapT = std.map.wrapT
        tex.anisotropy = 4
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.needsUpdate = true
        bakedMap = tex
      }
    } catch {
      bakedMap = std.map
    }
  } else if (hasUv) {
    bakedMap = getSharedGrainTexture()
  }

  const lite = new THREE.MeshLambertMaterial({
    color: baseColor,
    map: bakedMap,
    vertexColors: true,
    transparent: Boolean(std?.transparent),
    opacity: std?.opacity ?? 1,
    alphaTest: std?.alphaTest ?? 0,
    side: std?.side ?? THREE.FrontSide,
  })

  // Free the heavy 1024×1024 PBR textures from GPU memory
  if (std) {
    if (bakedMap !== std.map) std.map?.dispose()
    std.normalMap?.dispose()
    std.roughnessMap?.dispose()
    std.metalnessMap?.dispose()
    std.aoMap?.dispose()
    std.emissiveMap?.dispose()
    std.dispose()
  }

  if (rawMat) cache.set(rawMat, lite)
  return lite
}

function simplifyIndices(
  srcIndices: Uint32Array,
  posWorld: Float32Array,
  uvSource: Float32Array | null,
  targetTris: number,
): Uint32Array {
  const targetCount = Math.max(36, targetTris * 3)
  if (srcIndices.length <= targetCount) return srcIndices
  if (uvSource && uvSource.length === (posWorld.length / 3) * 2) {
    const [out] = MeshoptSimplifier.simplifyWithAttributes(
      srcIndices,
      posWorld,
      3,
      uvSource,
      2,
      [0.4, 0.4],
      null,
      targetCount,
      0.5,
      ['Permissive', 'Sparse'],
    )
    if (out.length > 0 && out.length <= targetCount * 1.6) return out
  }
  const [out] = MeshoptSimplifier.simplify(srcIndices, posWorld, 3, targetCount, 0.5, ['Permissive', 'Sparse'])
  return out.length > 0 ? out : srcIndices
}

/**
 * Strip unreferenced vertices from a simplified index buffer and blend the
 * original high-res vertex normals with the simplified face normals so lighting
 * stays smooth across UV seams and low-poly facets.
 */
function buildCompactedGeometry(
  simpIndices: Uint32Array,
  posWorld: Float32Array,
  normWorld: Float32Array | null,
  uvSource: Float32Array | null,
  colBake: Float32Array,
): THREE.BufferGeometry {
  const totalVerts = posWorld.length / 3
  const remap = new Int32Array(totalVerts).fill(-1)
  let nextVert = 0
  const outIndices = new Uint32Array(simpIndices.length)

  for (let i = 0; i < simpIndices.length; i++) {
    const oldV = simpIndices[i]
    let newV = remap[oldV]
    if (newV === -1) {
      newV = nextVert++
      remap[oldV] = newV
    }
    outIndices[i] = newV
  }

  const outPos = new Float32Array(nextVert * 3)
  const outCol = new Float32Array(nextVert * 3)
  const outUv = uvSource ? new Float32Array(nextVert * 2) : null
  const origNorm = normWorld ? new Float32Array(nextVert * 3) : null

  for (let oldV = 0; oldV < totalVerts; oldV++) {
    const newV = remap[oldV]
    if (newV === -1) continue
    const p3 = newV * 3
    const o3 = oldV * 3
    outPos[p3] = posWorld[o3]
    outPos[p3 + 1] = posWorld[o3 + 1]
    outPos[p3 + 2] = posWorld[o3 + 2]
    outCol[p3] = colBake[o3]
    outCol[p3 + 1] = colBake[o3 + 1]
    outCol[p3 + 2] = colBake[o3 + 2]
    if (origNorm && normWorld) {
      origNorm[p3] = normWorld[o3]
      origNorm[p3 + 1] = normWorld[o3 + 1]
      origNorm[p3 + 2] = normWorld[o3 + 2]
    }
    if (outUv && uvSource) {
      outUv[newV * 2] = uvSource[oldV * 2]
      outUv[newV * 2 + 1] = uvSource[oldV * 2 + 1]
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(outCol, 3))
  if (outUv) geo.setAttribute('uv', new THREE.BufferAttribute(outUv, 2))
  geo.setIndex(new THREE.BufferAttribute(nextVert <= 65535 ? new Uint16Array(outIndices) : outIndices, 1))
  geo.computeVertexNormals()

  // Blend 55% original high-poly surface normal + 45% simplified face normal
  // so low-poly models keep smooth high-res shading gradients without UV seam creases.
  const nAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (nAttr && origNorm) {
    const arr = nAttr.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      const nx = arr[i] * 0.45 + origNorm[i] * 0.55
      const ny = arr[i + 1] * 0.45 + origNorm[i + 1] * 0.55
      const nz = arr[i + 2] * 0.45 + origNorm[i + 2] * 0.55
      const len = Math.hypot(nx, ny, nz) || 1
      arr[i] = nx / len
      arr[i + 1] = ny / len
      arr[i + 2] = nz / len
    }
    nAttr.needsUpdate = true
  }

  geo.computeBoundingSphere()
  return geo
}

const pendingAssets = new Set<string>()
let prepChain: Promise<void> = Promise.resolve()

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((r) => requestAnimationFrame(() => r()))
  }
  return new Promise((r) => setTimeout(r, 0))
}

/**
 * Fit a loaded GLTF scene into the unit box `[-0.5, 0.5]^3`, register its 8×8
 * collider + proxy synchronously, and asynchronously decimate its meshes + bake
 * its single-texture Lambert material (one model per frame).
 */
export function prepareModelAsset(asset: string, rawScene: THREE.Object3D, maxTris = 1600): void {
  if (useModelShapes.getState().models[asset] || pendingAssets.has(asset)) return
  pendingAssets.add(asset)

  const root = rawScene.clone(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())
  const s = 1 / Math.max(size.x, size.y, size.z, 1e-6)
  root.position.sub(centre).multiplyScalar(s)
  root.scale.setScalar(s)
  const fitted = new THREE.Group()
  fitted.add(root)
  registerModelShape(asset, fitted)

  prepChain = prepChain
    .then(async () => {
      await MeshoptSimplifier.ready
      await nextFrame()

      fitted.updateMatrixWorld(true)
      const meshes: THREE.Mesh[] = []
      let totalTris = 0
      fitted.traverse((o) => {
        const m = o as THREE.Mesh
        const pos = m.isMesh ? m.geometry?.attributes?.position : undefined
        if (!pos || pos.count < 3) return
        const idxCount = m.geometry.index ? m.geometry.index.count : pos.count
        totalTris += Math.floor(idxCount / 3)
        meshes.push(m)
      })

      if (meshes.length === 0 || totalTris === 0) return

      const matCache = new Map<THREE.Material, THREE.MeshLambertMaterial>()
      const parts: PreparedModelPart[] = []
      const v = new THREE.Vector3()
      const nVec = new THREE.Vector3()
      const normalMat = new THREE.Matrix3()

      for (const mesh of meshes) {
        const geo = mesh.geometry
        const posAttr = geo.attributes.position
        const normAttr = geo.attributes.normal
        const uvAttr = geo.attributes.uv
        const colAttr = geo.attributes.color
        const vCount = posAttr.count

        const posWorld = new Float32Array(vCount * 3)
        const normWorld = normAttr ? new Float32Array(vCount * 3) : null
        const uvSource = uvAttr ? new Float32Array(vCount * 2) : null
        const colBake = new Float32Array(vCount * 3)

        normalMat.getNormalMatrix(mesh.matrixWorld)

        for (let i = 0; i < vCount; i++) {
          v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld)
          const i3 = i * 3
          posWorld[i3] = v.x
          posWorld[i3 + 1] = v.y
          posWorld[i3 + 2] = v.z

          let ny = 0.5
          if (normAttr && normWorld) {
            nVec.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize()
            normWorld[i3] = nVec.x
            normWorld[i3 + 1] = nVec.y
            normWorld[i3 + 2] = nVec.z
            ny = nVec.y
          }

          if (uvAttr && uvSource) {
            uvSource[i * 2] = uvAttr.getX(i)
            uvSource[i * 2 + 1] = uvAttr.getY(i)
          }

          // Bake subtle vertical AO + hemisphere normal relief + tactile grain into vertex colors (0 shader cost)
          const hemi = 0.88 + 0.12 * Math.max(0, Math.min(1, v.y + 0.5))
          const slope = 0.94 + 0.06 * ny
          const hash = Math.sin(v.x * 91.7 + v.y * 57.3 + v.z * 113.1) * 43758.5453
          const grain = 0.96 + (hash - Math.floor(hash)) * 0.08
          const shade = Math.min(1.08, Math.max(0.76, hemi * slope * grain))

          const cr = colAttr ? colAttr.getX(i) : 1
          const cg = colAttr ? colAttr.getY(i) : 1
          const cb = colAttr ? colAttr.getZ(i) : 1
          colBake[i3] = cr * shade
          colBake[i3 + 1] = cg * shade
          colBake[i3 + 2] = cb * shade
        }

        let srcIndices: Uint32Array
        if (geo.index) {
          srcIndices = new Uint32Array(geo.index.array)
        } else {
          srcIndices = new Uint32Array(vCount)
          for (let i = 0; i < vCount; i++) srcIndices[i] = i
        }

        const meshTris = Math.floor(srcIndices.length / 3)
        const share = meshTris / Math.max(1, totalTris)
        const targetLod0 = Math.max(96, Math.round(share * maxTris))
        const targetLod1 = Math.max(60, Math.round(share * Math.min(maxTris * 0.38, 520)))
        const targetLod2 = Math.max(32, Math.round(share * 190))

        const idx0 = simplifyIndices(srcIndices, posWorld, uvSource, targetLod0)
        const idx1 = simplifyIndices(idx0, posWorld, uvSource, targetLod1)
        const idx2 = simplifyIndices(idx1, posWorld, uvSource, targetLod2)

        const lod0 = buildCompactedGeometry(idx0, posWorld, normWorld, uvSource, colBake)
        const lod1 = buildCompactedGeometry(idx1, posWorld, normWorld, uvSource, colBake)
        const lod2 = buildCompactedGeometry(idx2, posWorld, normWorld, uvSource, colBake)

        const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        const material = bakeLiteMaterial(rawMat, Boolean(uvSource), matCache)

        // Dispose the raw 120k-triangle geometry so it never sits in GPU memory
        geo.dispose()

        parts.push({ lod0, lod1, lod2, material })
      }

      if (parts.length > 0) {
        useModelShapes.setState((st) => ({
          models: { ...st.models, [asset]: parts },
        }))
      }
    })
    .catch((err) => {
      console.warn(`[model] simplification failed for ${asset}:`, err)
    })
}

/** World-space boxes for one placed model, or null if its shape isn't known yet. */
export function modelColliders(o: PlacedObject, shapes: Record<string, Cell[]>): Box[] | null {
  const cells = o.asset ? shapes[o.asset] : undefined
  if (!cells) return null
  const c = Math.cos(o.rotY || 0)
  const s = Math.sin(o.rotY || 0)
  const sx = Math.abs(o.scaleX || 1), sy = Math.abs(o.scaleY || 1), sz = Math.abs(o.scaleZ || 1)
  return cells.map((cell) => {
    // Rotate the cell's footprint (THREE rotation about +Y) and take its AABB
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const lx of [cell.x0 * sx, cell.x1 * sx]) {
      for (const lz of [cell.z0 * sz, cell.z1 * sz]) {
        const wx = lx * c + lz * s
        const wz = -lx * s + lz * c
        if (wx < minX) minX = wx
        if (wx > maxX) maxX = wx
        if (wz < minZ) minZ = wz
        if (wz > maxZ) maxZ = wz
      }
    }
    return { minX: o.x + minX, maxX: o.x + maxX, minZ: o.z + minZ, maxZ: o.z + maxZ, minY: o.y + cell.y0 * sy, maxY: o.y + cell.y1 * sy }
  })
}

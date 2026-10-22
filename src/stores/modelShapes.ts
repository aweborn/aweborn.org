import * as THREE from 'three'
import { create } from 'zustand'
import type { Box } from '@aweborn/shared/sim/interior'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'

/**
 * Tight colliders for generated models. A GLB is fitted into a unit cube, but
 * most models fill only part of it, so a whole-cube collider becomes an
 * invisible wall. Instead we bin the mesh vertices into an N×N grid of columns
 * (in the fitted, unit-cube space) and keep each occupied column's y-range.
 */
const N = 8
const MAX_SAMPLES = 60000

/** Cells in fitted local space, each within [-0.5, 0.5]^3. */
type Cell = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; r: number; g: number; b: number }

export const useModelShapes = create<{
  shapes: Record<string, Cell[]>
  proxies: Record<string, THREE.BufferGeometry>
}>(() => ({ shapes: {}, proxies: {} }))

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

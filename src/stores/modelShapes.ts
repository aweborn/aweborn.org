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
type Cell = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

export const useModelShapes = create<{ shapes: Record<string, Cell[]> }>(() => ({ shapes: {} }))

/** Call once per asset with the fitted (unit-cube, centred) group. */
export function registerModelShape(asset: string, fitted: THREE.Object3D): void {
  if (useModelShapes.getState().shapes[asset]) return
  fitted.updateMatrixWorld(true)
  const lo = new Float32Array(N * N).fill(Infinity)
  const hi = new Float32Array(N * N).fill(-Infinity)
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
    for (let i = 0; i < p.count; i += stride) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld)
      const cx = Math.min(N - 1, Math.max(0, Math.floor((v.x + 0.5) * N)))
      const cz = Math.min(N - 1, Math.max(0, Math.floor((v.z + 0.5) * N)))
      const k = cz * N + cx
      if (v.y < lo[k]) lo[k] = v.y
      if (v.y > hi[k]) hi[k] = v.y
    }
  })
  const cells: Cell[] = []
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const k = cz * N + cx
      if (hi[k] < lo[k]) continue
      cells.push({ x0: cx / N - 0.5, x1: (cx + 1) / N - 0.5, z0: cz / N - 0.5, z1: (cz + 1) / N - 0.5, y0: lo[k], y1: hi[k] })
    }
  }
  useModelShapes.setState((s) => ({ shapes: { ...s.shapes, [asset]: cells } }))
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

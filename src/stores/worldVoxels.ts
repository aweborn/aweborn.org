import { generateVoxels, voxelColliders, type VoxelGrid } from '@aweborn/shared/voxel'
import type { Box } from '@aweborn/shared/sim/interior'
import type { BlueprintDraft } from '@aweborn/shared/blueprint'

/** Manifested terrain → grid + colliders, cached by its params (regenerated only when they change). */
let lastKey = ''
let last: { grid: VoxelGrid; colliders: Box[] } | null = null

export function worldVoxels(terrain: BlueprintDraft['terrain'] | null): { grid: VoxelGrid; colliders: Box[] } | null {
  if (!terrain) return null
  const key = JSON.stringify(terrain)
  if (key !== lastKey) {
    const grid = generateVoxels(terrain)
    last = { grid, colliders: voxelColliders(grid) }
    lastKey = key
  }
  return last
}

export const sameTerrain = (a: unknown, b: unknown) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

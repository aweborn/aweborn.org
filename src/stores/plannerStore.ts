import { create } from 'zustand'
import type { Blueprint } from '@aweborn/shared/blueprint'
import { generateVoxels, voxelColliders, type VoxelGrid } from '@aweborn/shared/voxel'
import type { Box } from '@aweborn/shared/sim/interior'

/**
 * Ghost preview (Phase 07): the current planner blueprint for the world
 * you're in. Local only: the voxel terrain is generated in the browser from
 * the blueprint (deterministic, free) and is walkable; assets show as
 * wireframes until manifested. Nothing here is written to the World CRDT.
 */
interface PlannerState {
  worldId: string | null
  blueprint: Blueprint | null
  grid: VoxelGrid | null
  colliders: Box[]
  /** Hide the ghost without losing the plan */
  visible: boolean
  setBlueprint(worldId: string, bp: Blueprint | null): void
  setVisible(v: boolean): void
  clear(): void
}

export const usePlannerStore = create<PlannerState>((set) => ({
  worldId: null,
  blueprint: null,
  grid: null,
  colliders: [],
  visible: true,
  setBlueprint(worldId, bp) {
    const grid = bp ? generateVoxels(bp.terrain) : null
    set({ worldId, blueprint: bp, grid, colliders: grid ? voxelColliders(grid) : [] })
  },
  setVisible(visible) {
    set({ visible })
  },
  clear() {
    set({ worldId: null, blueprint: null, grid: null, colliders: [] })
  },
}))

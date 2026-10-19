import { create } from 'zustand'
import type { Blueprint } from '@aweborn/shared/blueprint'

/**
 * Ghost preview (Phase 07): the current planner blueprint for the world
 * you're in. Local only: the voxel terrain is generated in the browser from
 * the blueprint (deterministic, chunk by chunk around the player; see
 * worldVoxels.ts) and is walkable; assets show as wireframes until
 * manifested. Nothing here is written to the World CRDT.
 */
interface PlannerState {
  worldId: string | null
  blueprint: Blueprint | null
  /** Hide the ghost without losing the plan */
  visible: boolean
  setBlueprint(worldId: string, bp: Blueprint | null): void
  setVisible(v: boolean): void
  clear(): void
}

export const usePlannerStore = create<PlannerState>((set) => ({
  worldId: null,
  blueprint: null,
  visible: true,
  setBlueprint(worldId, bp) {
    set({ worldId, blueprint: bp })
  },
  setVisible(visible) {
    set({ visible })
  },
  clear() {
    set({ worldId: null, blueprint: null })
  },
}))

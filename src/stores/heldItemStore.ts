/**
 * Held item in hand (Minecraft-style building): selecting a Block, Shape, or
 * Made model in the Library equips it into your hand and closes the sheet so
 * you can walk/turn, see a live placement preview in front of you, and tap
 * PLACE (or press V) repeatedly to place it strategically.
 *
 * Also tracks whether the player is currently carrying an existing world object
 * (`carryingId`), so the touch HUD and held-item bar stay in sync.
 */
import { create } from 'zustand'
import { snapToCell, stackedY, type LibraryBlock } from '@aweborn/shared/library'
import { placeBlock, placeModel, placeShape, useWorldStore } from './worldStore'
import { placeOnTerrain } from './worldVoxels'
import { useUniverseStore } from './universeStore'
import { interiorController } from '../systems/InteriorController'

export type HeldItem =
  | { kind: 'block'; block: LibraryBlock }
  | { kind: 'shape'; shape: { id: string; name: string }; color: string; size: number; rotY: number }
  | { kind: 'model'; sha: string; file: string; prompt: string; size: number; rotY: number }

interface HeldItemState {
  /** Library item equipped in hand for repeat placement. */
  item: HeldItem | null
  /** ID of an existing world object currently grabbed/carried (G / GRAB), if any. */
  carryingId: string | null
  /** Equip a Library item into hand (clears any carried world object trigger). */
  equip: (item: HeldItem) => void
  /** Unequip the item in hand. */
  clear: () => void
  /** Rotate the equipped shape/model in hand by delta radians. */
  rotateItem: (deltaRad: number) => void
  /** Scale the equipped shape/model in hand by factor. */
  scaleItem: (factor: number) => void
  /** Recolor the equipped shape in hand. */
  colorItem: (color: string) => void
  /** Update the carried world object ID. */
  setCarryingId: (id: string | null) => void
}

export const useHeldItemStore = create<HeldItemState>((set) => ({
  item: null,
  carryingId: null,
  equip: (item) => set({ item }),
  clear: () => set({ item: null }),
  rotateItem: (deltaRad) =>
    set((s) => {
      if (!s.item || s.item.kind === 'block') return s
      return { item: { ...s.item, rotY: s.item.rotY + deltaRad } }
    }),
  scaleItem: (factor) =>
    set((s) => {
      if (!s.item || s.item.kind === 'block') return s
      const next = Math.min(30, Math.max(0.5, +(s.item.size * factor).toFixed(2)))
      return { item: { ...s.item, size: next } }
    }),
  colorItem: (color) =>
    set((s) => {
      if (!s.item || s.item.kind !== 'shape') return s
      return { item: { ...s.item, color } }
    }),
  setCarryingId: (carryingId) => set({ carryingId }),
}))

/**
 * Compute the exact world position where `item` will land if placed right now
 * in front of the player (`s`), matching Library placement rules:
 *  - Blocks snap to the terrain grid cell 2 m ahead, lifted to terrain surface
 *    and stacked on top of any blocks already in that column.
 *  - Shapes and models sit in front of the player at feet height.
 */
export function computePlacementTarget(
  item: HeldItem,
  s: { x: number; y: number; z: number; fx: number; fz: number } = interiorController.state,
): { x: number; y: number; z: number; scale: number; rotY: number } {
  if (item.kind === 'block') {
    const worldState = useWorldStore.getState()
    const t = worldState.voxelTerrain
    const wx = t?.size[0] ?? 40
    const wz = t?.size[2] ?? 40
    const x = snapToCell(s.x + s.fx * 2, wx)
    const z = snapToCell(s.z + s.fz * 2, wz)
    let y = Math.floor(s.y + 0.01) + 0.5
    if (t) {
      const surface = placeOnTerrain(t, [Math.floor(x + wx / 2), 0, Math.floor(z + wz / 2)]).y
      y = Math.max(y, surface + 0.5)
    }
    y = stackedY(y, x, z, worldState.objects.values())
    return { x, y, z, scale: 1, rotY: 0 }
  }
  if (item.kind === 'shape') {
    const dist = item.size / 2 + 1.5
    return {
      x: s.x + s.fx * dist,
      y: s.y + item.size / 2,
      z: s.z + s.fz * dist,
      scale: item.size,
      rotY: item.rotY,
    }
  }
  const dist = item.size / 2 + 2
  return {
    x: s.x + s.fx * dist,
    y: s.y + item.size / 2,
    z: s.z + s.fz * dist,
    scale: item.size,
    rotY: item.rotY,
  }
}

/**
 * Place the currently equipped item in front of the player.
 * Keeps the item in hand for repeat placement (Minecraft-style).
 * Returns the new object ID, or null if nothing was placed.
 */
export function placeEquippedItem(playerId: string): string | null {
  const item = useHeldItemStore.getState().item
  const doc = useUniverseStore.getState().activeWorldDoc
  if (!item || !doc) return null
  const pos = computePlacementTarget(item, interiorController.state)
  if (item.kind === 'block') {
    return placeBlock(doc, item.block, { x: pos.x, y: pos.y, z: pos.z }, playerId)
  }
  if (item.kind === 'shape') {
    return placeShape(
      doc,
      item.shape,
      { color: item.color, size: item.size },
      { x: pos.x, y: pos.y, z: pos.z },
      playerId,
      item.rotY,
    )
  }
  return placeModel(doc, item.file, item.prompt, { x: pos.x, y: pos.y, z: pos.z }, playerId, {
    scale: item.size,
    rotY: item.rotY,
  })
}

export const CARRY_TOGGLE_EVENT = 'aweborn:carry-toggle'
export const PLACE_HELD_EVENT = 'aweborn:place-held'
export const HELD_ADJUST_EVENT = 'aweborn:held-adjust'
export const HELD_RECOLOR_EVENT = 'aweborn:held-recolor'

export type HeldAdjustKind = 'rotLeft' | 'rotRight' | 'grow' | 'shrink' | 'duplicate' | 'delete'

export function triggerCarryToggle(): void {
  window.dispatchEvent(new CustomEvent(CARRY_TOGGLE_EVENT))
}

export function triggerPlaceHeld(): void {
  window.dispatchEvent(new CustomEvent(PLACE_HELD_EVENT))
}

export function triggerHeldAdjust(kind: HeldAdjustKind): void {
  window.dispatchEvent(new CustomEvent<HeldAdjustKind>(HELD_ADJUST_EVENT, { detail: kind }))
}

export function triggerHeldRecolor(color: string): void {
  window.dispatchEvent(new CustomEvent<string>(HELD_RECOLOR_EVENT, { detail: color }))
}

import { create } from 'zustand'
import type { Shot } from '../lib/photo'

/**
 * Photo mode (Rough Draft M6b): frame a shot of a world for its card.
 *
 * Shots live in memory only (object URLs): the latest per world, a handful at
 * most. Nothing leaves the device unless the player orders a card with it.
 */

const MAX_KEPT = 6

interface PhotoState {
  /** Composing: controls hidden, the card frame shown. */
  composing: boolean
  /** Opened from "Get this card": hand the shot back to that world's checkout. */
  forWorldId: string | null
  /** The shot being looked at (preview), if any. */
  preview: Shot | null
  /** Latest shot of each world. */
  byWorld: Record<string, Shot>
  open: (forWorldId?: string | null) => void
  close: () => void
  setPreview: (shot: Shot | null) => void
  /** Keep the preview as this world's card photo. */
  keep: (shot: Shot) => void
}

export const usePhotoStore = create<PhotoState>((set, get) => ({
  composing: false,
  forWorldId: null,
  preview: null,
  byWorld: {},
  open: (forWorldId = null) => set({ composing: true, forWorldId, preview: null }),
  close: () => {
    const { preview, byWorld } = get()
    // A shot nobody kept: let its pixels go
    if (preview && !Object.values(byWorld).includes(preview)) URL.revokeObjectURL(preview.url)
    set({ composing: false, preview: null, forWorldId: null })
  },
  setPreview: (shot) => {
    const { preview, byWorld } = get()
    if (preview && preview !== shot && !Object.values(byWorld).includes(preview)) URL.revokeObjectURL(preview.url)
    set({ preview: shot })
  },
  keep: (shot) => {
    if (!shot.worldId) return
    const byWorld = { ...get().byWorld }
    const old = byWorld[shot.worldId]
    if (old && old !== shot) URL.revokeObjectURL(old.url)
    delete byWorld[shot.worldId]
    byWorld[shot.worldId] = shot
    const ids = Object.keys(byWorld)
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_KEPT))) {
      URL.revokeObjectURL(byWorld[id].url)
      delete byWorld[id]
    }
    set({ byWorld })
  },
}))

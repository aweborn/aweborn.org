import { create } from 'zustand'
import { parseGame, type Game } from '@aweborn/shared/game'
import { AUTH_URL } from './player'

/**
 * The world's game, client side (Phase 10, slice 1). The saved game arrives through the
 * world itself (`meta.game`, server-written); this holds the owner's unsaved draft so the
 * Game tab and the outlines in the world show the same thing, and the call that saves it.
 * The server validates and versions every save (shared/game.ts, server game.ts).
 */

interface GameDraftState {
  /** The world the draft belongs to. */
  worldId: string | null
  /** What the owner is editing; null = nothing being edited (the outlines show the saved game). */
  draft: Game | null
  /** Changed since it was loaded or saved. */
  dirty: boolean
  start: (worldId: string, game: Game) => void
  edit: (fn: (g: Game) => Game) => void
  saved: (game: Game | null) => void
  clear: () => void
}

export const useGameDraftStore = create<GameDraftState>((set, get) => ({
  worldId: null,
  draft: null,
  dirty: false,
  start: (worldId, game) => set({ worldId, draft: game, dirty: false }),
  edit: (fn) => {
    const { draft } = get()
    if (!draft) return
    // Every edit goes through the same repair the server applies, so the tab never shows what won't save
    const p = parseGame(fn(draft))
    if (p.ok) set({ draft: p.value, dirty: true })
  },
  saved: (game) => set({ draft: game, dirty: false }),
  clear: () => set({ worldId: null, draft: null, dirty: false }),
}))

export type SaveGameReply = { worldId: string; game: Game | null; changed: boolean; warnings: string[] }
export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

/** Save the world's game (creator and builders), or remove it with `null`. */
export async function saveGame(worldId: string, game: Game | null): Promise<Result<SaveGameReply>> {
  const res = await fetch(`${AUTH_URL}/api/player/world/game`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worldId, game }),
  }).catch(() => null)
  if (!res) return { ok: false, message: 'You seem to be offline. Try again when you’re connected.' }
  const data = (await res.json().catch(() => ({}))) as SaveGameReply & { message?: string }
  if (!res.ok) return { ok: false, message: data.message ?? 'That didn’t save. Please try again.' }
  return { ok: true, data }
}

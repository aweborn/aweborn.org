import { create } from 'zustand'
import { parseGame, type Game, type GameCredit, type GameTemplate, type Vec3 } from '@aweborn/shared/game'
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

// ── The Library (slice 7): games travel between worlds, versioned and credited ──

/** A game saved to the Library, as the list shows it. */
export interface LibraryGame {
  id: string
  name: string
  version: number
  template: GameTemplate
  /** Who saved it (playerId) and the name to show. */
  by: string
  byName: string
  credits: GameCredit[]
  updatedAt: number
  mine: boolean
}

export const LIBRARY_NAME = { min: 3, max: 40 } as const

async function call<T>(path: string, body?: unknown, failed = 'That didn’t work. Please try again.'): Promise<Result<T>> {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }).catch(() => null)
  if (!res) return { ok: false, message: 'You seem to be offline. Try again when you’re connected.' }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string }
  if (!res.ok) return { ok: false, message: typeof data.message === 'string' && data.message ? data.message : failed }
  return { ok: true, data }
}

/** Library games: mine first, then recent ones by others. */
export async function listLibraryGames(): Promise<Result<LibraryGame[]>> {
  const r = await call<{ games?: unknown }>('/api/player/game-library', undefined, 'The Library didn’t load. Please try again.')
  if (!r.ok) return r
  return { ok: true, data: Array.isArray(r.data.games) ? (r.data.games as LibraryGame[]).filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string') : [] }
}

/** Save this world's saved game to the Library (again from the same world = its next version). */
export async function saveGameToLibrary(worldId: string, name: string): Promise<Result<LibraryGame>> {
  const r = await call<{ game?: LibraryGame }>('/api/player/game-library', { worldId, name }, 'That didn’t save to the Library. Please try again.')
  if (!r.ok) return r
  if (!r.data.game) return { ok: false, message: 'That didn’t save to the Library. Please try again.' }
  return { ok: true, data: r.data.game }
}

/** Make a Library game this world's game, its arena's floor middle at `at`. Returns the saved game. */
export async function bringLibraryGame(worldId: string, libraryId: string, at: Vec3): Promise<Result<Game>> {
  const r = await call<{ game?: unknown }>('/api/player/game-library/bring', { worldId, libraryId, at }, 'That game didn’t come over. Please try again.')
  if (!r.ok) return r
  const p = parseGame(r.data.game)
  if (!p.ok) return { ok: false, message: 'That game didn’t come over. Please try again.' }
  return { ok: true, data: p.value }
}

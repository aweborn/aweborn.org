import type { LibraryMind, MindHistory } from '@aweborn/shared/mind-library'
import { AUTH_URL } from './player'

/**
 * Minds you keep (2026-11-06, shared/mind-library.ts): a creation's mind history, saving
 * it to the Library, giving a saved mind to a creation, and the Library's Minds shelf.
 */

export type MindResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<MindResult<T>> {
  try {
    const res = await fetch(`${AUTH_URL}${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) return { ok: true, data: j as T }
    const message =
      typeof j.message === 'string'
        ? j.message
        : res.status === 401 || res.status === 403
          ? 'Save your player first to keep and share minds.'
          : 'Something went wrong. Try again soon.'
    return { ok: false, status: res.status, message }
  } catch {
    return { ok: false, status: 0, message: 'Minds are resting right now. Try again soon.' }
  }
}

/** Every version of this creation's mind, newest first (its makers only). */
export const fetchMindHistory = (worldId: string, objectId: string) =>
  call<MindHistory>(`/api/player/mind/history?worldId=${encodeURIComponent(worldId)}&objectId=${encodeURIComponent(objectId)}`)

/** Put this creation's mind, as it is now, on the Library's Minds shelf. */
export const saveMindToLibrary = (worldId: string, objectId: string) =>
  call<{ id: string; already?: boolean }>('/api/player/mind/save', { method: 'POST', body: { worldId, objectId } })

/** Give a creation a saved mind (it grows its own branch from there). */
export const adoptMind = (worldId: string, objectId: string, mindId: string, withBody = false) =>
  call<{ mind: unknown }>('/api/player/mind/adopt', { method: 'POST', body: { worldId, objectId, mindId, ...(withBody ? { withBody: true } : {}) } })

/** Take a mind you saved off the shelf (creations that have it keep it). */
export const removeSavedMind = (id: string) => call<{ ok: true }>(`/api/player/mind/library/${id}/remove`, { method: 'POST', body: {} })

/** The Minds shelf: signed in (your own marked) or, failing that, the public list. */
export async function fetchMindShelf(q: string, signal?: AbortSignal): Promise<LibraryMind[]> {
  const qs = `q=${encodeURIComponent(q.trim())}&limit=60`
  for (const url of [`${AUTH_URL}/api/player/minds?${qs}`, `${AUTH_URL}/minds?${qs}`]) {
    try {
      const res = await fetch(url, { credentials: url.includes('/api/player/') ? 'include' : 'omit', signal })
      if (!res.ok) continue
      const j = (await res.json()) as { minds?: LibraryMind[] }
      return Array.isArray(j.minds) ? j.minds : []
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
    }
  }
  throw new Error('shelf unavailable')
}

/**
 * Placing a body from the Minds shelf: the object is written to the world first, then the
 * server gives it the mind. The server may not have the new object yet, so try a few times.
 */
export async function adoptWhenPlaced(worldId: string, objectId: string, mindId: string): Promise<MindResult<{ mind: unknown }>> {
  let last: MindResult<{ mind: unknown }> = { ok: false, status: 0, message: '' }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 400 + i * 400))
    last = await adoptMind(worldId, objectId, mindId, true)
    if (last.ok || last.status !== 404) return last
  }
  return last
}

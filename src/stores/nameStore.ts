import { useEffect } from 'react'
import { create } from 'zustand'
import { wandererTag } from '@aweborn/shared/names'
import { AUTH_URL } from '../lib/player'

/**
 * Character names (Rough Draft M1, 2026-10-27). Chat lines and over-head
 * labels ask for names by id; lookups are batched (≤ 50 per request, one
 * request per short window) and cached for a few minutes, so a crowded
 * world costs a handful of cheap, cacheable GETs, never one per line.
 */

const BATCH_MS = 120
const MAX_IDS = 50
const FRESH_MS = 5 * 60_000
/** Ids the server never names (guests): don't ask. */
const askable = (id: string) => !!id && !id.startsWith('guest') && /^[A-Za-z0-9_-]{1,64}$/.test(id)

interface NameState {
  /** id → name; `null` = asked, unnamed */
  names: Record<string, string | null>
  /** Our own name changed (set from the account panel). */
  setOwn: (id: string, name: string) => void
}

export const useNameStore = create<NameState>((set) => ({
  names: {},
  setOwn: (id, name) => {
    fetchedAt.set(id, Date.now())
    set((s) => ({ names: { ...s.names, [id]: name } }))
  },
}))

const fetchedAt = new Map<string, number>()
const queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

async function flush(): Promise<void> {
  timer = null
  const ids = [...queue]
  queue.clear()
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const chunk = ids.slice(i, i + MAX_IDS)
    const res = await fetch(`${AUTH_URL}/players/names?ids=${chunk.map(encodeURIComponent).join(',')}`).catch(() => null)
    const body = res?.ok ? ((await res.json().catch(() => null)) as { names?: Record<string, string> } | null) : null
    if (!body?.names) {
      for (const id of chunk) fetchedAt.delete(id) // try again later
      continue
    }
    const got = body.names
    useNameStore.setState((s) => {
      const next = { ...s.names }
      for (const id of chunk) next[id] = typeof got[id] === 'string' ? got[id] : null
      return { names: next }
    })
  }
}

/** Ask for names (no-op for fresh or in-flight ids). */
export function requestNames(ids: Iterable<string>): void {
  const now = Date.now()
  for (const id of ids) {
    if (!askable(id)) continue
    const at = fetchedAt.get(id)
    if (at && now - at < FRESH_MS) continue
    fetchedAt.set(id, now)
    queue.add(id)
  }
  if (queue.size && !timer) timer = setTimeout(() => void flush(), BATCH_MS)
}

/** What to call someone: their name, or "Wanderer 4K2Q". */
export function displayName(id: string, names: Record<string, string | null>): string {
  return names[id] ?? wandererTag(id)
}

/** Hook: one player's display name (asks for it on first use). */
export function useDisplayName(id: string | null | undefined): string {
  const name = useNameStore((s) => (id ? s.names[id] : undefined))
  useEffect(() => {
    if (id && name === undefined) requestNames([id])
  }, [id, name])
  return id ? (name ?? wandererTag(id)) : ''
}

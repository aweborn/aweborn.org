import { create } from 'zustand'
import { AUTH_URL, getPlayerSnapshot, subscribePlayer } from '../lib/player'

/**
 * Muted players (Rough Draft M1, 2026-10-27): their chat lines and speech
 * bubbles are hidden for you. Kept on this device for everyone; with a
 * session it's also saved on the server so it follows you to any device.
 */
const KEY = 'aweborn.mutes'

function loadLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []
  } catch {
    return []
  }
}
function saveLocal(ids: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    /* private mode: this session only */
  }
}

const hasSession = () => {
  const p = getPlayerSnapshot()
  return Boolean(p && !p.isGuest)
}

interface MuteState {
  muted: Set<string>
  setMuted: (id: string, on: boolean) => void
  /** Player actions sheet (Mute / Report), opened by tapping a name in chat. */
  target: { id: string; place: string } | null
  openActions: (id: string, place: string) => void
  closeActions: () => void
}

export const useMuteStore = create<MuteState>((set, get) => ({
  muted: new Set(loadLocal()),
  target: null,
  openActions: (id, place) => set({ target: { id, place } }),
  closeActions: () => set({ target: null }),
  setMuted: (id, on) => {
    const next = new Set(get().muted)
    if (on) next.add(id)
    else next.delete(id)
    saveLocal(next)
    set({ muted: next })
    if (hasSession()) {
      void fetch(`${AUTH_URL}/api/player/mute`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: id, muted: on }),
      }).catch(() => {
        /* kept locally; merged up on the next sync */
      })
    }
  },
}))

/** Merge the server's list with this device's (union), and push local-only ones up. */
async function syncWithServer(): Promise<void> {
  if (!hasSession()) return
  const res = await fetch(`${AUTH_URL}/api/player/mutes`, { credentials: 'include' }).catch(() => null)
  if (!res?.ok) return
  const body = (await res.json().catch(() => null)) as { mutes?: string[] } | null
  if (!body?.mutes) return
  const server = new Set(body.mutes)
  const local = useMuteStore.getState().muted
  const merged = new Set([...server, ...local])
  saveLocal(merged)
  useMuteStore.setState({ muted: merged })
  for (const id of local) {
    if (!server.has(id)) {
      void fetch(`${AUTH_URL}/api/player/mute`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: id, muted: true }),
      }).catch(() => {})
    }
  }
}

let lastPlayer: string | null = null
subscribePlayer(() => {
  const id = getPlayerSnapshot()?.playerId ?? null
  if (id && id !== lastPlayer) {
    lastPlayer = id
    void syncWithServer()
  }
})

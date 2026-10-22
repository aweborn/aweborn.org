/**
 * Cold-start offline persistence for Universe and World CRDT documents +
 * an offline edit queue (Card Event Step 4).
 *
 * Keeps the latest Universe Y.Doc and up to 24 recently visited World Y.Docs
 * in localStorage so tapping an NFC card or opening the app with no signal
 * renders cached worlds immediately, lets the player walk around and place
 * free blocks/shapes, and merges queued CRDT updates back to the server on
 * reconnect.
 */
import * as Y from 'yjs'

const KEY_UNIVERSE = 'aweborn.offline.universe'
const KEY_WORLD_PREFIX = 'aweborn.offline.world:'
const KEY_WORLD_LRU = 'aweborn.offline.world-lru'
const KEY_PENDING_PREFIX = 'aweborn.offline.pending:'
const KEY_PENDING_INDEX = 'aweborn.offline.pending-index'
const MAX_CACHED_WORLDS = 24

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function saveUniverseDoc(doc: Y.Doc): void {
  try {
    const state = Y.encodeStateAsUpdate(doc)
    localStorage.setItem(KEY_UNIVERSE, toBase64(state))
  } catch {
    /* storage quota or private mode */
  }
}

export function loadUniverseDoc(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(KEY_UNIVERSE)
    return raw ? fromBase64(raw) : null
  } catch {
    return null
  }
}

export function saveWorldDoc(worldId: string, doc: Y.Doc): void {
  try {
    const state = Y.encodeStateAsUpdate(doc)
    localStorage.setItem(KEY_WORLD_PREFIX + worldId, toBase64(state))
    const rawLru = localStorage.getItem(KEY_WORLD_LRU)
    const lru: string[] = rawLru ? (JSON.parse(rawLru) as string[]).filter((id) => id !== worldId) : []
    lru.unshift(worldId)
    while (lru.length > MAX_CACHED_WORLDS) {
      const evicted = lru.pop()
      if (evicted) localStorage.removeItem(KEY_WORLD_PREFIX + evicted)
    }
    localStorage.setItem(KEY_WORLD_LRU, JSON.stringify(lru))
  } catch {
    /* storage quota or private mode */
  }
}

export function loadWorldDoc(worldId: string): Uint8Array | null {
  try {
    const raw = localStorage.getItem(KEY_WORLD_PREFIX + worldId)
    return raw ? fromBase64(raw) : null
  } catch {
    return null
  }
}

export function queueOfflineWorldUpdate(worldId: string, delta: Uint8Array): void {
  try {
    const key = KEY_PENDING_PREFIX + worldId
    const existingRaw = localStorage.getItem(key)
    const existing = existingRaw ? fromBase64(existingRaw) : null
    const merged = existing ? Y.mergeUpdates([existing, delta]) : delta
    localStorage.setItem(key, toBase64(merged))

    const idxRaw = localStorage.getItem(KEY_PENDING_INDEX)
    const idx: string[] = idxRaw ? (JSON.parse(idxRaw) as string[]) : []
    if (!idx.includes(worldId)) {
      idx.push(worldId)
      localStorage.setItem(KEY_PENDING_INDEX, JSON.stringify(idx))
    }
  } catch {
    /* storage quota or private mode */
  }
}

export function drainPendingWorldUpdates(): Array<{ worldId: string; update: Uint8Array }> {
  try {
    const idxRaw = localStorage.getItem(KEY_PENDING_INDEX)
    if (!idxRaw) return []
    const idx = JSON.parse(idxRaw) as string[]
    localStorage.removeItem(KEY_PENDING_INDEX)
    const out: Array<{ worldId: string; update: Uint8Array }> = []
    for (const worldId of idx) {
      const key = KEY_PENDING_PREFIX + worldId
      const raw = localStorage.getItem(key)
      localStorage.removeItem(key)
      const update = raw ? fromBase64(raw) : null
      if (update && update.byteLength > 0) {
        out.push({ worldId, update })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Cold-start offline persistence for Universe and World CRDT documents +
 * an offline edit queue (Card Event Step 4).
 *
 * Keeps the latest Universe Y.Doc and up to 24 recently visited World Y.Docs
 * on the device so tapping an NFC card or opening the app with no signal
 * renders cached worlds immediately, lets the player walk around and place
 * free blocks/shapes, and merges queued CRDT updates back to the server on
 * reconnect.
 *
 * Storage (Rough Draft M7a, 2026-10-28): IndexedDB, raw bytes (no base64), with
 * an in-memory mirror so every read stays synchronous. `initOfflineCache()` runs
 * once before the first render (src/main.tsx); it loads the mirror and moves the
 * old localStorage copies (2026-10-22 → M7a) into IndexedDB. If IndexedDB can't
 * open, the same keys keep living in localStorage as before.
 *
 * Writes: a world/universe doc fires "update" on every edit, so docs are only
 * marked dirty and encoded once per WRITE_DELAY_MS (and on pagehide / tab hidden).
 * The offline edit queue is written straight away: it's the data we can't lose.
 */
import * as Y from 'yjs'

const DB_NAME = 'aweborn-offline'
const DB_VERSION = 1
const STORE = 'kv'
const K_UNIVERSE = 'universe'
const K_WORLD = 'world:'
const K_PENDING = 'pending:'
const K_LRU = 'world-lru'
/** Offline flight log entries (Phase 09 9C), `flight:<000000n>`; IndexedDB only (memory elsewhere). */
const K_FLIGHT = 'flight:'
const MAX_CACHED_WORLDS = 24
const WRITE_DELAY_MS = 400
/** Never hold the first render hostage to a stuck IndexedDB open. */
const OPEN_TIMEOUT_MS = 1500

// localStorage keys (the only store before M7a; still the fallback store)
const LS_PREFIX = 'aweborn.offline.'
const LS_UNIVERSE = 'aweborn.offline.universe'
// v2 (2026-10-28): v1 world caches could hold local-only placeholder meta the server never got;
// any later write from that client built on it and stayed pending on the server forever.
const LS_WORLD_PREFIX = 'aweborn.offline.world.v2:'
const LS_WORLD_LRU = 'aweborn.offline.world-lru'
const LS_PENDING_PREFIX = 'aweborn.offline.pending:'

export type OfflineStorageKind = 'idb' | 'local' | 'memory'
let kind: OfflineStorageKind = 'memory'
let db: IDBDatabase | null = null

// In-memory mirror of what's on disk
let universe: Uint8Array | null = null
const worlds = new Map<string, Uint8Array>()
let lru: string[] = []
const pending = new Map<string, Uint8Array>()
const flight = new Map<number, Uint8Array>()
let flightNext = 0

// Docs changed since the last write (encoded lazily)
let dirtyUniverse: Y.Doc | null = null
const dirtyWorlds = new Map<string, Y.Doc>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const pendingListeners = new Set<() => void>()
function notifyPending(): void {
  for (const cb of pendingListeners) cb()
}

type Value = Uint8Array | string[]

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

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false /* private mode / blocked storage */
  }
}

/** Store key → localStorage key (fallback store). */
function lsKey(key: string): string {
  if (key === K_UNIVERSE) return LS_UNIVERSE
  if (key === K_LRU) return LS_WORLD_LRU
  if (key.startsWith(K_WORLD)) return LS_WORLD_PREFIX + key.slice(K_WORLD.length)
  return LS_PENDING_PREFIX + key.slice(K_PENDING.length)
}

function mergeInto(map: Map<string, Uint8Array>, id: string, bytes: Uint8Array): void {
  const existing = map.get(id)
  map.set(id, existing ? Y.mergeUpdates([existing, bytes]) : bytes)
}

/** Read every `aweborn.offline.*` key into the mirror; returns the keys seen. */
function readLocalStorage(): string[] {
  if (!hasLocalStorage()) return []
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(LS_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      if (k === LS_UNIVERSE) {
        const bytes = fromBase64(raw)
        if (bytes) universe = universe ? Y.mergeUpdates([universe, bytes]) : bytes
      } else if (k.startsWith(LS_WORLD_PREFIX)) {
        const bytes = fromBase64(raw)
        if (bytes) mergeInto(worlds, k.slice(LS_WORLD_PREFIX.length), bytes)
      } else if (k.startsWith(LS_PENDING_PREFIX)) {
        const bytes = fromBase64(raw)
        if (bytes && bytes.byteLength > 0) mergeInto(pending, k.slice(LS_PENDING_PREFIX.length), bytes)
      } else if (k === LS_WORLD_LRU) {
        const ids = JSON.parse(raw) as unknown
        if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string' && !lru.includes(id)) lru.push(id)
      } else {
        // v1 world caches, the old pending index: they'd only take up quota now
        localStorage.removeItem(k)
      }
    }
  } catch {
    /* corrupt entry: keep what parsed */
  }
  return keys
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('IndexedDB open timed out'))
    }, OPEN_TIMEOUT_MS)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      clearTimeout(timer)
      return reject(e as Error)
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      clearTimeout(timer)
      const d = req.result
      if (settled) return d.close() // too late: we already fell back
      settled = true
      d.onversionchange = () => d.close() // a newer tab is upgrading
      resolve(d)
    }
    req.onerror = () => {
      clearTimeout(timer)
      if (!settled) reject(req.error ?? new Error('IndexedDB open failed'))
      settled = true
    }
  })
}

/** One cursor pass over the store (≤ 1 universe + 24 worlds + LRU + one queue per world). */
function readIdb(d: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return
      const k = String(c.key)
      const v: unknown = c.value
      if (k === K_UNIVERSE && v instanceof Uint8Array) universe = v
      else if (k === K_LRU && Array.isArray(v)) lru = v.filter((x): x is string => typeof x === 'string')
      else if (k.startsWith(K_WORLD) && v instanceof Uint8Array) worlds.set(k.slice(K_WORLD.length), v)
      else if (k.startsWith(K_PENDING) && v instanceof Uint8Array) pending.set(k.slice(K_PENDING.length), v)
      else if (k.startsWith(K_FLIGHT) && v instanceof Uint8Array) {
        const n = Number(k.slice(K_FLIGHT.length))
        flight.set(n, v)
        flightNext = Math.max(flightNext, n + 1)
      }
      c.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/** Write to whichever store is active. Resolves when IndexedDB commits (or right away elsewhere). */
function persist(puts: Array<[string, Value]>, dels: string[]): Promise<boolean> {
  if (kind === 'idb' && db) {
    return new Promise((resolve) => {
      try {
        const tx = db!.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        for (const [k, v] of puts) store.put(v, k)
        for (const k of dels) store.delete(k)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false) // quota: the mirror still holds it for this session
        tx.onabort = () => resolve(false)
      } catch {
        resolve(false)
      }
    })
  }
  if (kind === 'local') {
    try {
      for (const [k, v] of puts) {
        localStorage.setItem(lsKey(k), v instanceof Uint8Array ? toBase64(v) : JSON.stringify(v))
      }
      for (const k of dels) localStorage.removeItem(lsKey(k))
    } catch {
      /* storage quota */
    }
  }
  return Promise.resolve(true)
}

function reconcileLru(): string[] {
  const dels: string[] = []
  lru = lru.filter((id) => worlds.has(id))
  for (const id of worlds.keys()) if (!lru.includes(id)) lru.push(id)
  while (lru.length > MAX_CACHED_WORLDS) {
    const evicted = lru.pop()!
    worlds.delete(evicted)
    dels.push(K_WORLD + evicted)
  }
  return dels
}

let initPromise: Promise<void> | null = null

/** Load the mirror from disk. Call once before the first render; safe to call again. */
export function initOfflineCache(): Promise<void> {
  initPromise ??= (async () => {
    db = await openDb().catch(() => null)
    if (db) {
      kind = 'idb'
      await readIdb(db)
      // One-time move from localStorage. The old keys go only once IndexedDB has committed the copy.
      const legacy = readLocalStorage()
      if (legacy.length > 0) {
        const dels = reconcileLru()
        const puts: Array<[string, Value]> = [[K_LRU, lru]]
        if (universe) puts.push([K_UNIVERSE, universe])
        for (const [id, bytes] of worlds) puts.push([K_WORLD + id, bytes])
        for (const [id, bytes] of pending) puts.push([K_PENDING + id, bytes])
        if (await persist(puts, dels)) {
          for (const k of legacy) {
            try {
              localStorage.removeItem(k)
            } catch {
              /* ignore */
            }
          }
        }
      }
    } else if (hasLocalStorage()) {
      kind = 'local'
      readLocalStorage()
    }
    reconcileLru()
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushOfflineCache)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushOfflineCache()
      })
    }
    if (pending.size > 0) notifyPending()
  })()
  return initPromise
}

function scheduleFlush(): void {
  flushTimer ??= setTimeout(flushOfflineCache, WRITE_DELAY_MS)
}

/** Encode and write every dirty doc now (before a doc is destroyed, on pagehide, …). */
export function flushOfflineCache(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const puts: Array<[string, Value]> = []
  let dels: string[] = []
  if (dirtyUniverse) {
    universe = Y.encodeStateAsUpdate(dirtyUniverse)
    puts.push([K_UNIVERSE, universe])
    dirtyUniverse = null
  }
  if (dirtyWorlds.size > 0) {
    for (const [id, doc] of dirtyWorlds) {
      const bytes = Y.encodeStateAsUpdate(doc)
      worlds.set(id, bytes)
      puts.push([K_WORLD + id, bytes])
      lru = [id, ...lru.filter((x) => x !== id)]
    }
    dirtyWorlds.clear()
    dels = reconcileLru()
    puts.push([K_LRU, lru])
  }
  if (puts.length > 0 || dels.length > 0) void persist(puts, dels)
}

export function saveUniverseDoc(doc: Y.Doc): void {
  dirtyUniverse = doc
  scheduleFlush()
}

export function loadUniverseDoc(): Uint8Array | null {
  if (dirtyUniverse) flushOfflineCache()
  return universe
}

export function saveWorldDoc(worldId: string, doc: Y.Doc): void {
  dirtyWorlds.set(worldId, doc)
  scheduleFlush()
}

export function loadWorldDoc(worldId: string): Uint8Array | null {
  if (dirtyWorlds.has(worldId)) flushOfflineCache()
  return worlds.get(worldId) ?? null
}

export function queueOfflineWorldUpdate(worldId: string, delta: Uint8Array): void {
  mergeInto(pending, worldId, delta)
  void persist([[K_PENDING + worldId, pending.get(worldId)!]], [])
  notifyPending()
}

export function drainPendingWorldUpdates(): Array<{ worldId: string; update: Uint8Array }> {
  if (pending.size === 0) return []
  const out: Array<{ worldId: string; update: Uint8Array }> = []
  for (const [worldId, update] of pending) {
    if (update.byteLength > 0) out.push({ worldId, update })
  }
  const dels = [...pending.keys()].map((id) => K_PENDING + id)
  pending.clear()
  void persist([], dels)
  notifyPending()
  return out
}

/** Worlds with edits made offline that haven't reached the server yet (connectivity chip). */
export function pendingWorldCount(): number {
  return pending.size
}

export function subscribePendingWorlds(cb: () => void): () => void {
  pendingListeners.add(cb)
  return () => pendingListeners.delete(cb)
}

/** Which store is in use (debugging / tests). */
export function offlineStorageKind(): OfflineStorageKind {
  return kind
}

const flightKey = (n: number) => K_FLIGHT + String(n).padStart(9, '0')

/** Append one offline flight log entry (src/lib/simLink.ts owns the format). */
export function appendFlightLog(entry: Uint8Array): void {
  const n = flightNext++
  flight.set(n, entry)
  if (kind === 'idb') void persist([[flightKey(n), entry]], [])
}

/** The offline flight log, oldest first (survives reloads where IndexedDB works). */
export function readFlightLog(): Uint8Array[] {
  return [...flight.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

export function clearFlightLog(): void {
  if (flight.size === 0) return
  const dels = [...flight.keys()].map(flightKey)
  flight.clear()
  if (kind === 'idb') void persist([], dels)
}

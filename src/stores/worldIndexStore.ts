/**
 * Aweborn — World Index store (Phase 08, Milestone 8B)
 *
 * Every world this account has found, as cards:
 *   - sighted: came within SIGHT_DISTANCE (flying), or landed next to it by
 *     link / card tap. Face-down card; you can warp there.
 *   - visited: went inside. Face-up card with full art.
 *
 * Offline-first: the client detects sightings itself, shows them at once
 * (`pending`), and queues them with their time. The queue survives reloads
 * and is replayed to `POST /api/player/world-index/sighted` when online; the
 * server accepts sightings up to 30 days old. Visits are recorded by the
 * server when the client joins a world over the socket; we mirror them
 * optimistically. Guests (no session) keep a local, per-tab index.
 *
 * Anti-cheat is cheap for now (server: real worlds only, rate limit). The
 * real answer is replayed flight (phases/09-authoritative-flight.md).
 */

import { create } from 'zustand'
import type {
  DiscoveryMethod,
  WorldEntry,
  WorldIndexEntry,
  WorldIndexWorld,
} from '@aweborn/shared/crdt-schema'
import { ORIGIN_WORLD_ENTRY, ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { useUniverseStore } from './universeStore'
import { AUTH_URL, getPlayerSnapshot, playerReady, subscribePlayer, type Player } from '../lib/player'
import type { WorldLookup } from '../systems/TeleportSystem'

// ── Tuning ───────────────────────────────────────────────────────────

/** A world counts as sighted within this distance. Also the full-detail LOD (UniverseWorlds). */
export const SIGHT_DISTANCE = 100

const SCAN_MS = 500
const FLUSH_MS = 5_000
const REFRESH_MS = 5 * 60_000
/** Server limit per POST. */
const BATCH = 20
const BACKOFF_RATE_LIMITED_MS = 30_000
const BACKOFF_OFFLINE_MS = 10_000
const BACKOFF_NO_SESSION_MS = 5 * 60_000
/** Same as the server: re-entering within 30 s counts as one visit. */
const VISIT_DEDUPE_MS = 30_000
/** A local entry the server never confirmed (and no longer queued) is dropped after this. */
const PENDING_GRACE_MS = 10 * 60_000

// ── Store ────────────────────────────────────────────────────────────

export interface CardRevealEvent {
  worldId: string
  /** Bumps per reveal so the animation restarts. */
  seq: number
}

interface WorldIndexState {
  entries: Map<string, WorldIndexEntry>
  /** Loaded for the current player (cache or server). */
  ready: boolean
  /** A first-visit card reveal to play (CardReveal). */
  reveal: CardRevealEvent | null
  /** The index panel is open. */
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useWorldIndexStore = create<WorldIndexState>((set) => ({
  entries: new Map(),
  ready: false,
  reveal: null,
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))

// ── Helpers (also used by the UI) ────────────────────────────────────

/** Origin has no interior: its card shows face-up as soon as it's sighted. */
export function isFaceUp(e: WorldIndexEntry): boolean {
  return e.state === 'visited' || e.worldId === ORIGIN_WORLD_ID
}

/** Who made it, as a player should read it (character names are a follow-up). */
export function creatorLabel(creator: string | undefined, myCharacters: readonly string[]): string {
  if (!creator) return 'an explorer'
  if (creator === 'system') return 'Aweborn'
  if (myCharacters.includes(creator)) return 'you'
  if (creator === 'guest' || creator.startsWith('guest-')) return 'a guest explorer'
  return 'a fellow explorer'
}

export function formatCoords(p: { x: number; y: number; z: number }): string {
  return `(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`
}

function metaOf(w: WorldEntry): WorldIndexWorld {
  return { name: w.name, color: w.color, creator: w.creator, position: { ...w.resolvedPosition }, sector: w.sector }
}

/** The world's live entry if we have it, else rebuilt from the card's snapshot. */
export function worldEntryFor(e: WorldIndexEntry): WorldEntry | null {
  if (e.worldId === ORIGIN_WORLD_ID) return ORIGIN_WORLD_ENTRY
  const live = useUniverseStore.getState().worlds.get(e.worldId)
  if (live) return live
  const w = e.world
  if (!w) return null
  return {
    id: e.worldId,
    name: w.name,
    creator: w.creator,
    intendedPosition: { ...w.position },
    resolvedPosition: { ...w.position },
    resolvedAt: 0,
    color: w.color,
    sector: w.sector,
    solidified: true,
    solidifiedAt: 0,
    playerCount: 0,
    lastActive: 0,
    createdAt: 0,
  }
}

function newEntry(
  worldId: string,
  world: WorldIndexWorld | null,
  method: DiscoveryMethod,
  characterId: string | null,
  now: number,
): WorldIndexEntry {
  return {
    worldId,
    state: 'sighted',
    method,
    characterId,
    discoveredAt: now,
    visitedAt: null,
    visitCount: 0,
    lastVisitedAt: null,
    world,
    pending: player?.isGuest ? undefined : true,
  }
}

// ── Engine (module singleton) ────────────────────────────────────────

interface Sighting {
  worldId: string
  at: number
}

let started = false
let player: Player | null = null
/** Cache key: the account's oldest character (stable across devices and character switches). */
let owner: string | null = null
let queue: Sighting[] = []
let flushing = false
let backoffUntil = 0
let lastRefresh = 0
/** Arrivals reported before the player resolved (boot teleport links). */
const earlyArrivals: WorldLookup[] = []

const get = useWorldIndexStore.getState
const set = useWorldIndexStore.setState

function ownerKey(p: Player): string {
  return p.isGuest ? p.playerId : (p.characters[0] ?? p.playerId)
}

/** Guests' ids are per tab, so their index is too. */
function storage(): Storage | null {
  try {
    return player?.isGuest ? sessionStorage : localStorage
  } catch {
    return null
  }
}
const entriesKey = () => `aweborn-world-index:${owner}`
const queueKey = () => `aweborn-world-index-queue:${owner}`

function readJson<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value))
  } catch {
    /* full or private mode: the index still works for this session */
  }
}

function setEntries(entries: Map<string, WorldIndexEntry>): void {
  set({ entries })
  if (owner) writeJson(entriesKey(), [...entries.values()])
}

function upsert(list: WorldIndexEntry[]): void {
  const entries = new Map(get().entries)
  for (const e of list) entries.set(e.worldId, e)
  setEntries(entries)
}

function saveQueue(): void {
  if (owner) writeJson(queueKey(), queue)
}

function enqueue(worldId: string, at: number): void {
  if (player?.isGuest) return
  const existing = queue.find((s) => s.worldId === worldId)
  if (existing) existing.at = Math.min(existing.at, at)
  else queue.push({ worldId, at })
  saveQueue()
}

function playReveal(worldId: string): void {
  set((s) => ({ reveal: { worldId, seq: (s.reveal?.seq ?? 0) + 1 } }))
}

/** Switch to this player's index: cached copy first, then the server. */
function adopt(p: Player): void {
  player = p
  owner = ownerKey(p)
  queue = readJson<Sighting[]>(queueKey()) ?? []
  const cached = readJson<WorldIndexEntry[]>(entriesKey()) ?? []
  set({ entries: new Map(cached.map((e) => [e.worldId, e])), ready: true })
  backoffUntil = 0
  for (const w of earlyArrivals.splice(0)) recordArrival(w)
  void refresh(true)
  void flush()
}

/** Pull the server's index and merge it with what's still pending here. */
export async function refresh(force = false): Promise<void> {
  if (!owner || player?.isGuest) return
  const now = Date.now()
  if (!force && now - lastRefresh < 15_000) return
  lastRefresh = now
  const me = owner
  const res = await fetch(`${AUTH_URL}/api/player/me`, { credentials: 'include' }).catch(() => null)
  if (!res?.ok || owner !== me) return
  const body = (await res.json().catch(() => null)) as { worldIndex?: WorldIndexEntry[] } | null
  if (!body?.worldIndex || owner !== me) return

  const local = get().entries
  const queued = new Set(queue.map((s) => s.worldId))
  const merged = new Map<string, WorldIndexEntry>()
  for (const s of body.worldIndex) {
    const l = local.get(s.worldId)
    // A visit we saw before the server did stays visited (and pending) until it catches up.
    const aheadOfServer = l?.state === 'visited' && s.state === 'sighted'
    merged.set(s.worldId, {
      ...s,
      state: aheadOfServer ? 'visited' : s.state,
      visitedAt: s.visitedAt ?? l?.visitedAt ?? null,
      visitCount: Math.max(s.visitCount, l?.visitCount ?? 0),
      lastVisitedAt: Math.max(s.lastVisitedAt ?? 0, l?.lastVisitedAt ?? 0) || null,
      world: s.world ?? l?.world ?? null,
      pending: aheadOfServer || undefined,
    })
  }
  for (const [id, l] of local) {
    if (merged.has(id) || !l.pending) continue
    if (queued.has(id) || now - l.discoveredAt < PENDING_GRACE_MS) merged.set(id, l)
  }
  setEntries(merged)
}

/** Replay queued sightings to the server, oldest first, one batch at a time. */
async function flush(): Promise<void> {
  if (!owner || player?.isGuest || flushing || queue.length === 0) return
  if (Date.now() < backoffUntil || !navigator.onLine) return
  flushing = true
  const me = owner
  const batch = queue.slice(0, BATCH)
  try {
    const res = await fetch(`${AUTH_URL}/api/player/world-index/sighted`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sightings: batch }),
    })
    if (owner !== me) return
    if (res.status === 429) {
      backoffUntil = Date.now() + BACKOFF_RATE_LIMITED_MS
      return
    }
    if (res.status === 401 || res.status === 403 || res.status === 503) {
      backoffUntil = Date.now() + BACKOFF_NO_SESSION_MS
      return
    }
    // Sent (or rejected as malformed: drop it rather than wedge the queue).
    const sent = new Set(batch.map((s) => s.worldId))
    queue = queue.filter((s) => !sent.has(s.worldId))
    saveQueue()
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { results?: { worldId: string }[] } | null
      const confirmed = (body?.results ?? []).map((r) => r.worldId)
      const entries = get().entries
      const updates = confirmed
        .map((id) => entries.get(id))
        .filter((e): e is WorldIndexEntry => Boolean(e?.pending && e.state === 'sighted'))
        .map((e) => ({ ...e, pending: undefined }))
      if (updates.length) upsert(updates)
    }
  } catch {
    backoffUntil = Date.now() + BACKOFF_OFFLINE_MS
  } finally {
    flushing = false
  }
}

/** Every world (and the portal) within SIGHT_DISTANCE that isn't in the index yet. */
function scan(): void {
  if (!owner) return
  const universe = useUniverseStore.getState()
  if (universe.activeWorldId) return
  const p = universe.playerPosition
  const entries = get().entries
  const now = Date.now()
  const found: WorldIndexEntry[] = []
  const check = (w: WorldEntry) => {
    if (entries.has(w.id)) return
    const dx = w.resolvedPosition.x - p.x
    const dy = w.resolvedPosition.y - p.y
    const dz = w.resolvedPosition.z - p.z
    if (dx * dx + dy * dy + dz * dz > SIGHT_DISTANCE * SIGHT_DISTANCE) return
    found.push(newEntry(w.id, metaOf(w), 'flight', player?.playerId ?? null, now))
  }
  check(ORIGIN_WORLD_ENTRY)
  for (const w of universe.worlds.values()) check(w)
  if (found.length === 0) return
  upsert(found)
  for (const e of found) enqueue(e.worldId, now)
  // Origin is face-up from the start: it gets the reveal on sighting (everyone's first card).
  if (found.some((e) => e.worldId === ORIGIN_WORLD_ID)) playReveal(ORIGIN_WORLD_ID)
}

/** Entered a world: the server records the visit; mirror it (and reveal a first visit). */
function onEnterWorld(worldId: string): void {
  if (!owner || worldId === ORIGIN_WORLD_ID) return
  const now = Date.now()
  const cur = get().entries.get(worldId)
  if (cur?.state === 'visited') {
    if (cur.lastVisitedAt && now - cur.lastVisitedAt < VISIT_DEDUPE_MS) return
    upsert([{ ...cur, visitCount: cur.visitCount + 1, lastVisitedAt: now }])
    return
  }
  const live = useUniverseStore.getState().worlds.get(worldId)
  const base = cur ?? newEntry(worldId, live ? metaOf(live) : null, 'flight', player?.playerId ?? null, now)
  upsert([
    {
      ...base,
      world: base.world ?? (live ? metaOf(live) : null),
      state: 'visited',
      visitedAt: now,
      visitCount: 1,
      lastVisitedAt: now,
      pending: player?.isGuest ? undefined : true,
    },
  ])
  playReveal(worldId)
  // Let the server's socket join land, then confirm.
  setTimeout(() => void refresh(true), 3_000)
}

/**
 * Landed next to a world by link or card tap (TeleportSystem): sighted,
 * method "link". Entering it afterwards (`?a=in`) makes it visited.
 */
export function recordArrival(world: WorldLookup): void {
  if (!owner) {
    earlyArrivals.push(world)
    return
  }
  const now = Date.now()
  const existing = get().entries.get(world.id)
  if (!existing) {
    const meta: WorldIndexWorld = {
      name: world.name,
      color: world.color,
      creator: world.creator ?? (world.isOrigin ? 'system' : ''),
      position: { ...world.position },
      sector: world.sector,
    }
    upsert([newEntry(world.id, meta, 'link', player?.playerId ?? null, now)])
    if (world.isOrigin) playReveal(world.id)
  }
  if (player?.isGuest) return
  const me = owner
  void fetch(`${AUTH_URL}/api/player/world-index/arrived`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worldId: world.id }),
  })
    .then((res) => {
      if (owner !== me) return
      if (!res.ok) throw new Error(String(res.status))
      const e = get().entries.get(world.id)
      if (e?.pending && e.state === 'sighted') upsert([{ ...e, pending: undefined }])
    })
    .catch(() => {
      if (owner === me && !existing) enqueue(world.id, now) // offline: replay as a sighting later
    })
}

/** Start tracking. Idempotent; runs for the page's life. */
export function startWorldIndex(): void {
  if (started) return
  started = true

  void playerReady.then(adopt)
  subscribePlayer(() => {
    const p = getPlayerSnapshot()
    if (p && ownerKey(p) !== owner) adopt(p)
    else if (p) player = p
  })

  useUniverseStore.subscribe((s, prev) => {
    if (s.activeWorldId && s.activeWorldId !== prev.activeWorldId) onEnterWorld(s.activeWorldId)
  })

  setInterval(scan, SCAN_MS)
  setInterval(() => void flush(), FLUSH_MS)
  setInterval(() => void refresh(true), REFRESH_MS)
  window.addEventListener('online', () => {
    backoffUntil = 0
    void flush()
    void refresh(true)
  })
}

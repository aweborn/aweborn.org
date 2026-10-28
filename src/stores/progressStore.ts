/**
 * Aweborn — progress store (Rough Draft M3, 2026-10-27): awe = the character's experience.
 *
 * Mirrors `GET /api/player/progress` (XP, level, chapter + its steps) and
 * reports what only the client sees: piloting and building skills, and the
 * distance flown. The server owns the numbers (shared/progress.ts); we only
 * say "this happened".
 *
 *   progress.use('brake')            a skill was used (cool-down per skill, so
 *                                    "3 uses" means three separate moments)
 *   progress.flightFrame(dt, pos, w) every flight frame: distance + farthest
 *                                    from Origin, warp leaps excluded
 *   refreshProgress()                re-read after the server granted something
 *                                    (first visit, sighting, a finished creation)
 *
 * Reports are batched (the server takes one per 3 s per character). A level
 * or chapter gained by any route raises a toast (ProgressToast).
 *
 * Guests (no session: the auth server was unreachable) have no progress.
 */

import { create } from 'zustand'
import type { ProgressView, Skill } from '@aweborn/shared/progress'
import { CLIENT_SKILLS, masteryUses } from '@aweborn/shared/progress'
import { ORIGIN_POSITION } from '@aweborn/shared/crdt-schema'
import { AUTH_URL, getPlayerSnapshot, playerReady, subscribePlayer, type Player } from '../lib/player'
import { useUniverseStore } from './universeStore'
import { audio } from '../audio/engine'

// ── Tuning ───────────────────────────────────────────────────────────

/** One use of a skill per this long (so mastery means separate moments, not one long press). */
const SKILL_COOLDOWN_MS = 12_000
/** How often queued reports go out (server: one per 3 s). */
const FLUSH_MS = 4_000
/** Send flight at most this often, and only after this far. */
const FLIGHT_EVERY_MS = 20_000
const FLIGHT_MIN = 25
/** Frame steps longer than this are teleports / snaps, not flight (max speed is 80 u/s). */
const MAX_SPEED = 90
const REFRESH_MS = 2 * 60_000
const TOAST_MS = 5_500

// ── Store ────────────────────────────────────────────────────────────

export interface ProgressToast {
  kind: 'level' | 'chapter'
  level: number
  chapter: number
  chapterName: string
  /** Bumps so the same toast can replay. */
  seq: number
}

interface ProgressState {
  view: ProgressView | null
  toast: ProgressToast | null
  /** The Journey panel is open. */
  open: boolean
  setOpen: (open: boolean) => void
  dismissToast: () => void
}

export const useProgressStore = create<ProgressState>((set) => ({
  view: null,
  toast: null,
  open: false,
  setOpen: (open) => set({ open }),
  dismissToast: () => set({ toast: null }),
}))

const get = useProgressStore.getState
const set = useProgressStore.setState

// ── Engine (module singleton) ────────────────────────────────────────

let started = false
let player: Player | null = null
const pendingSkills = new Set<Skill>()
const lastUse = new Map<Skill, number>()
let pendingDistance = 0
let farthest = 0
let lastFlightSent = 0
let flushing = false
let backoffUntil = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

const canReport = () => !!player && !player.isGuest

function mastered(skill: Skill): boolean {
  const n = get().view?.stats.skills[skill] ?? 0
  return n >= masteryUses(skill)
}

/** New view from the server: raise a toast if a level or chapter was gained since the last one. */
function adoptView(next: ProgressView): void {
  const prev = get().view
  set({ view: next })
  if (!prev) return
  const chapterUp = next.chapter > prev.chapter
  const levelUp = next.level > prev.level
  if (!chapterUp && !levelUp) return
  if (toastTimer) clearTimeout(toastTimer)
  set((s) => ({
    toast: {
      kind: chapterUp ? 'chapter' : 'level',
      level: next.level,
      chapter: next.chapter,
      chapterName: next.chapterName,
      seq: (s.toast?.seq ?? 0) + 1,
    },
  }))
  audio.reveal()
  toastTimer = setTimeout(() => set({ toast: null }), TOAST_MS)
}

export async function refreshProgress(): Promise<void> {
  if (!canReport()) return
  const me = player
  const res = await fetch(`${AUTH_URL}/api/player/progress`, { credentials: 'include' }).catch(() => null)
  if (!res?.ok || player !== me) return
  const body = (await res.json().catch(() => null)) as { progress?: ProgressView } | null
  if (body?.progress) adoptView(body.progress)
}

async function flush(): Promise<void> {
  if (!canReport() || flushing || Date.now() < backoffUntil || !navigator.onLine) return
  const now = Date.now()
  const sendFlight = pendingDistance >= FLIGHT_MIN && now - lastFlightSent >= FLIGHT_EVERY_MS
  if (pendingSkills.size === 0 && !sendFlight) return
  flushing = true
  const skills = [...pendingSkills]
  const distance = sendFlight ? pendingDistance : 0
  const body: { skills?: Skill[]; flight?: { distance: number; farthest: number } } = {}
  if (skills.length) body.skills = skills
  if (sendFlight) body.flight = { distance: Math.round(distance * 10) / 10, farthest: Math.round(farthest) }
  try {
    const res = await fetch(`${AUTH_URL}/api/player/progress/report`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 429) {
      backoffUntil = Date.now() + 5_000
      return
    }
    if (res.status === 401 || res.status === 403 || res.status === 503) {
      backoffUntil = Date.now() + 5 * 60_000
      return
    }
    // Sent (or rejected as malformed: drop it rather than wedge).
    for (const s of skills) pendingSkills.delete(s)
    if (sendFlight) {
      pendingDistance = Math.max(0, pendingDistance - distance)
      lastFlightSent = Date.now()
    }
    if (res.ok) {
      const r = (await res.json().catch(() => null)) as { progress?: ProgressView } | null
      if (r?.progress) adoptView(r.progress)
    }
  } catch {
    backoffUntil = Date.now() + 10_000
  } finally {
    flushing = false
  }
}

export const progress = {
  /** A client-observed skill was used successfully. */
  use(skill: Skill): void {
    if (!canReport() || !CLIENT_SKILLS.includes(skill) || mastered(skill)) return
    const now = Date.now()
    if (now - (lastUse.get(skill) ?? 0) < SKILL_COOLDOWN_MS) return
    lastUse.set(skill, now)
    pendingSkills.add(skill)
  },

  /** Called once per flight frame with the ship's position (skipped while warping). */
  flightFrame(dt: number, pos: { x: number; y: number; z: number }, warping: boolean, prev: { x: number; y: number; z: number }): void {
    if (!canReport() || warping || dt <= 0) return
    const dx = pos.x - prev.x
    const dy = pos.y - prev.y
    const dz = pos.z - prev.z
    const step = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (step > MAX_SPEED * Math.max(dt, 1 / 30)) return // teleport, snap or warp arrival
    pendingDistance += step
    const ox = pos.x - ORIGIN_POSITION.x
    const oy = pos.y - ORIGIN_POSITION.y
    const oz = pos.z - ORIGIN_POSITION.z
    const r = Math.sqrt(ox * ox + oy * oy + oz * oz)
    if (r > farthest) farthest = r
  },
}

function adopt(p: Player): void {
  const changed = player?.playerId !== p.playerId
  player = p
  if (!changed) return
  pendingSkills.clear()
  lastUse.clear()
  pendingDistance = 0
  farthest = 0
  backoffUntil = 0
  set({ view: null, toast: null })
  void refreshProgress()
}

/** Start tracking. Idempotent; runs for the page's life. */
export function startProgress(): void {
  if (started) return
  started = true

  void playerReady.then(adopt)
  subscribePlayer(() => {
    const p = getPlayerSnapshot()
    if (p) adopt(p)
  })

  // Entering (server-observed: enter, first visit) and leaving a world (client: leave)
  useUniverseStore.subscribe((s, prev) => {
    if (s.activeWorldId === prev.activeWorldId) return
    if (prev.activeWorldId && !s.activeWorldId) progress.use('leave')
    if (s.activeWorldId) setTimeout(() => void refreshProgress(), 3_000)
  })

  setInterval(() => void flush(), FLUSH_MS)
  setInterval(() => void refreshProgress(), REFRESH_MS)
  window.addEventListener('online', () => {
    backoffUntil = 0
    void flush()
  })
  // Don't lose the last few seconds of flight when the tab goes away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
  if (import.meta.env.DEV) {
    ;(window as unknown as { awebornProgress: unknown }).awebornProgress = { store: useProgressStore, progress, refresh: refreshProgress, flush }
  }
}

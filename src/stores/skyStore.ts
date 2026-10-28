/**
 * The living sky (Phase 05, Rough Draft M4, 2026-10-27).
 *
 *  - Solar cycle: the player's local daylight (from the browser's UTC
 *    offset) tints the cosmos, and the offset goes to the server in the
 *    `aw_tz` cookie, where it moves the daily mana cap by at most ±10 %.
 *  - Pool level: the band the server publishes (`mana.level`) sets how rich
 *    the sky looks: bright and full → baseline → dim → near-dark with an
 *    aurora by the Portal.
 *  - Shooting stars: every mana that leaves the pool leaves as a star,
 *    coloured by its Form 990 function. Creations streak in real time (the
 *    universe's `drawnByPurpose.creations` rises); bills and other draws
 *    come from `GET /mana/flow`, released smoothly over their period, with
 *    small ones merged so a busy day is a shower, not a blizzard.
 *
 * Visuals live in `Environment.tsx` (tint, band) and
 * `effects/ShootingStars.tsx`; the tap caption in `StarCaption.tsx`.
 */

import { create } from 'zustand'
import { poolBand, poolLevel, type PoolBand } from '@aweborn/shared/mana-level'
import {
  FUNCTION_COLORS,
  NATURES,
  PURPOSE_LABELS,
  DEFAULT_NATURE,
  localHour,
  sunHeight,
  type ManaFlow,
  type Nature,
} from '@aweborn/shared/sky'
import type { ManaFunction, ManaPurpose } from '@aweborn/shared/crdt-schema'
import { useUniverseStore } from './universeStore'
import { AUTH_URL } from '../lib/player'

/** A star waiting to be launched by the renderer. */
export interface StarSpawn {
  fn: ManaFunction
  purpose: ManaPurpose
  nature: Nature
  amount: number
  /** 'creation' rises out of a world; 'drizzle' leaves from the Portal; 'shortfall' is small and calm. */
  kind: 'creation' | 'drizzle' | 'shortfall'
}

export interface StarCaptionState {
  title: string
  detail: string
  color: string
  x: number
  y: number
  at: number
}

interface SkyState {
  band: PoolBand
  /** Local sun height, −1 (midnight) … +1 (noon). */
  sun: number
  flow: ManaFlow | null
  caption: StarCaptionState | null
  /** DEV/preview override of the band (null = follow the server). */
  bandOverride: PoolBand | null
  showCaption: (c: Omit<StarCaptionState, 'at'>) => void
  clearCaption: () => void
}

export const useSkyStore = create<SkyState>((set) => ({
  band: 'medium',
  sun: 0,
  flow: null,
  caption: null,
  bandOverride: null,
  showCaption: (c) => set({ caption: { ...c, at: Date.now() } }),
  clearCaption: () => set({ caption: null }),
}))

/** The band to draw (preview override first). */
export const useSkyBand = () => useSkyStore((s) => s.bandOverride ?? s.band)

/** Stars waiting for the renderer (it drains this each frame). */
export const starQueue: StarSpawn[] = []
const MAX_QUEUE = 24

export function launchStar(s: StarSpawn): void {
  if (starQueue.length >= MAX_QUEUE) starQueue.shift()
  starQueue.push(s)
}

/** Words for a star: "Servers · 42 mana · today" + its Form 990 line. */
export function describeStar(s: StarSpawn): { title: string; detail: string; color: string } {
  const amt = s.amount >= 100 ? Math.round(s.amount).toLocaleString() : s.amount >= 1 ? s.amount.toFixed(1) : s.amount.toFixed(2)
  if (s.kind === 'shortfall') {
    return {
      title: `Creative share covered a bill · ${amt} mana`,
      detail: 'Bills always get paid; when the rest of the pool runs short, the creative share covers the gap, in the open.',
      color: FUNCTION_COLORS.program,
    }
  }
  return {
    title: `${PURPOSE_LABELS[s.purpose]} · ${amt} mana · today`,
    detail: NATURES[s.nature],
    color: FUNCTION_COLORS[s.fn],
  }
}

// ── Solar cycle ─────────────────────────────────────────────────

/** Minutes east of UTC, from the browser. */
export function tzOffsetMin(): number {
  return -new Date().getTimezoneOffset()
}

/** Tell the server our UTC offset (cookie on the shared site, read by /api/player/*). */
function reportTimezone(): void {
  const host = location.hostname
  const domain = host === 'aweborn.org' || host.endsWith('.aweborn.org') ? '; domain=.aweborn.org' : ''
  const secure = location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `aw_tz=${tzOffsetMin()}; path=/; max-age=31536000; samesite=lax${domain}${secure}`
}

function updateSun(): void {
  const sun = sunHeight(localHour(tzOffsetMin()))
  if (Math.abs(sun - useSkyStore.getState().sun) > 0.002) useSkyStore.setState({ sun })
}

// ── Flow → drizzle stars ────────────────────────────────────────

const FLOW_POLL_MS = 5 * 60_000
/** On average at most one drizzle star this often (smaller draws merge). */
const DRIZZLE_EVERY_S = 6
const drizzleAcc = new Map<string, number>()

async function pollFlow(): Promise<void> {
  try {
    const r = await fetch(`${AUTH_URL}/mana/flow`)
    if (!r.ok) return
    useSkyStore.setState({ flow: (await r.json()) as ManaFlow })
  } catch {
    /* offline: keep the last flow */
  }
}

/** Accumulate each line's per-second release; launch a star when a line has enough to show. */
function drizzleTick(dtS: number): void {
  const flow = useSkyStore.getState().flow
  if (!flow || document.hidden) return
  const lines = flow.lines.filter((l) => l.purpose !== 'creations') // creations launch in real time
  const perDay = lines.reduce((s, l) => s + l.amount, 0)
  if (!(perDay > 0)) return
  const daySec = flow.windowMs / 1000
  // Merge threshold: the whole drizzle comes out as ≤ 1 star per DRIZZLE_EVERY_S.
  const threshold = Math.max(0.01, (perDay / daySec) * DRIZZLE_EVERY_S)
  for (const l of lines) {
    const key = `${l.fn}|${l.purpose}|${l.nature}`
    const acc = (drizzleAcc.get(key) ?? 0) + (l.amount / daySec) * dtS
    if (acc >= threshold) {
      launchStar({ fn: l.fn, purpose: l.purpose, nature: l.nature, amount: acc, kind: 'drizzle' })
      drizzleAcc.set(key, 0)
    } else {
      drizzleAcc.set(key, acc)
    }
  }
}

let started = false

/** Wire the sky to the game. Call once on boot. */
export function startSky(): void {
  if (started) return
  started = true

  reportTimezone()
  updateSun()
  setInterval(updateSun, 60_000)

  // Band + real-time creation / shortfall stars from the universe's mana map.
  let lastCreations: number | null = null
  let lastShortfall: number | null = null
  const onUniverse = (s: ReturnType<typeof useUniverseStore.getState>) => {
    const m = s.mana
    if (!m) return
    const band = poolBand(m.level ?? poolLevel(m.creative, 0))
    if (band !== useSkyStore.getState().band) useSkyStore.setState({ band })
    const c = m.drawnByPurpose?.creations ?? 0
    if (lastCreations !== null && c > lastCreations + 1e-6) {
      launchStar({ fn: 'program', purpose: 'creations', nature: DEFAULT_NATURE.creations, amount: c - lastCreations, kind: 'creation' })
    }
    lastCreations = c
    const sf = m.shortfall ?? 0
    if (lastShortfall !== null && sf > lastShortfall + 1e-6) {
      launchStar({ fn: 'program', purpose: 'other', nature: 'other', amount: sf - lastShortfall, kind: 'shortfall' })
    }
    lastShortfall = sf
  }
  onUniverse(useUniverseStore.getState())
  useUniverseStore.subscribe(onUniverse)

  void pollFlow()
  setInterval(() => void pollFlow(), FLOW_POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollFlow()
  })
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    drizzleTick(Math.min(5, (now - last) / 1000))
    last = now
  }, 1000)

  if (import.meta.env.DEV) {
    ;(window as unknown as { awebornSky: unknown }).awebornSky = {
      store: useSkyStore,
      setBand: (b: PoolBand | null) => useSkyStore.setState({ bandOverride: b }),
      setSun: (sun: number) => useSkyStore.setState({ sun }),
      star: (fn: ManaFunction = 'program', purpose: ManaPurpose = 'servers', amount = 42) =>
        launchStar({ fn, purpose, nature: DEFAULT_NATURE[purpose], amount, kind: purpose === 'creations' ? 'creation' : 'drizzle' }),
      pollFlow,
    }
  }
}

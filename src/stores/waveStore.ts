/**
 * Aweborn — Solidification Wave state (Phase 05, "The Golden Moment")
 *
 * A gift lands → the server's `mana.lastDonationAt` rises → every client
 * online plays the same golden wave out of the Aweborn Portal. The wave is
 * **the same size for every gift** (celebration, not to scale); the Frontier
 * edge moves by the true amount, tweened over the wave's duration.
 *
 * Worlds the gift solidifies are held as Ghosts until the wave front reaches
 * them: we snapshot the Ghost ids when the wave starts (the server publishes
 * mana before it flips the worlds' flags, see rooms.ts `applyFrontier`).
 *
 * Preview without a gift: call `awebornWave()` in the console. Purely
 * visual; nothing is solidified.
 */

import { create } from 'zustand'
import { useUniverseStore } from './universeStore'

/** How far the wave travels from Origin (u). Same for every gift. */
export const WAVE_MAX_RADIUS = 320
/** How long it takes to get there (s). */
export const WAVE_DURATION_S = 10
/** How long the banner stays up (s). */
export const WAVE_BANNER_S = 7

interface WaveState {
  /** performance.now() when the current wave started; null = no wave. */
  startedAt: number | null
  /** Frontier radius before and after this gift (u). */
  fromRadius: number
  toRadius: number
  /** Ghost world ids at the moment the wave started. */
  pendingGhosts: Set<string>
  /** Recognition line (opt-in donor names come later). */
  message: string
  /** Bumped each wave so effects can reset. */
  seq: number
  /** performance.now() when the front swept past the player (null = not yet). */
  passedAt: number | null
  trigger: (opts?: { fromRadius?: number; toRadius?: number; message?: string; preview?: boolean }) => void
  end: () => void
}

export const useWaveStore = create<WaveState>((set, get) => ({
  startedAt: null,
  fromRadius: 0,
  toRadius: 0,
  pendingGhosts: new Set(),
  message: '',
  seq: 0,
  passedAt: null,

  trigger: (opts = {}) => {
    const u = useUniverseStore.getState()
    const r = u.mana?.frontierRadius ?? 0
    const pending = new Set<string>()
    if (!opts.preview) for (const w of u.worlds.values()) if (!w.solidified) pending.add(w.id)
    set({
      startedAt: performance.now(),
      fromRadius: opts.fromRadius ?? r,
      toRadius: opts.toRadius ?? r,
      pendingGhosts: pending,
      message: opts.message ?? 'A wave of light from ★ a generous soul',
      seq: get().seq + 1,
      passedAt: null,
    })
  },

  end: () => set({ startedAt: null, pendingGhosts: new Set() }),
}))

/** Wave progress 0…1 (null when no wave). */
export function waveProgress(now: number = performance.now()): number | null {
  const s = useWaveStore.getState().startedAt
  if (s === null) return null
  return Math.min(1, (now - s) / 1000 / WAVE_DURATION_S)
}

/**
 * Gathers out of the portal, sweeps, settles at the far end. A slow start
 * matters: most players are within ~60 u of Origin, and they should see the
 * sphere grow before it passes them (≈ 2.7 s in).
 */
export function waveEase(p: number): number {
  return p * p * (3 - 2 * p)
}

/** Current wave front radius (u), or null when no wave. */
export function waveFront(now?: number): number | null {
  const p = waveProgress(now)
  return p === null ? null : waveEase(p) * WAVE_MAX_RADIUS
}

/**
 * Should this world still look like a Ghost? True while a wave is running,
 * the world was a Ghost when it started, and the front hasn't reached it.
 * Worlds beyond the wave's reach flip when it ends.
 */
export function heldAsGhost(id: string, distFromOrigin: number, now?: number): boolean {
  const { pendingGhosts } = useWaveStore.getState()
  if (!pendingGhosts.has(id)) return false
  const front = waveFront(now)
  return front !== null && distFromOrigin > front
}

/** The Frontier edge to draw: tweened from old to new radius during a wave. */
export function displayedFrontier(now?: number): number {
  const p = waveProgress(now)
  const live = useUniverseStore.getState().mana?.frontierRadius ?? 0
  if (p === null) return live
  const { fromRadius, toRadius } = useWaveStore.getState()
  return fromRadius + (Math.max(toRadius, live) - fromRadius) * waveEase(p)
}

// ── Gift detection ───────────────────────────────────────────────────

let started = false

/** Watch the universe's mana for new gifts. Call once on boot. */
export function startWaveWatcher(): void {
  if (started) return
  started = true

  let lastGiftAt: number | null = null
  let lastRadius = 0
  useUniverseStore.subscribe((s) => {
    const m = s.mana
    if (!m) return
    if (lastGiftAt === null) {
      // First sync: remember, don't celebrate old gifts.
      lastGiftAt = m.lastDonationAt
      lastRadius = m.frontierRadius
      return
    }
    if (m.lastDonationAt > lastGiftAt) {
      useWaveStore.getState().trigger({ fromRadius: lastRadius, toRadius: m.frontierRadius })
    }
    lastGiftAt = Math.max(lastGiftAt, m.lastDonationAt)
    lastRadius = m.frontierRadius
  })

  // Preview: awebornWave() in the console.
  const preview = () => {
    const r = useUniverseStore.getState().mana?.frontierRadius ?? 100
    useWaveStore.getState().trigger({ fromRadius: r * 0.97, toRadius: r, preview: true })
  }
  ;(window as unknown as { awebornWave: () => void }).awebornWave = preview
}

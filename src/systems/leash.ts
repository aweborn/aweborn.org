/**
 * Beginner cradle (Rough Draft M3c; Phase 05, Alex 2026-10-14 option b).
 *
 * Until warp unlocks, a soft leash keeps a new pilot near Origin: lots of
 * controls, and it's 3D, so cradle them in.
 *
 *   chapters 1–5   the Living Frontier
 *   chapter 6      max(1,500 u, Frontier + 500 u): the first supervised trip
 *                  into the Ghost dark (the ≥ 1,000 u Explorer flight)
 *   chapter 7      no leash (warp)
 *
 * Soft: past the edge, outward speed is bled off and the overshoot eases
 * back, so you feel a gentle turn, not a wall. Card and `/w/` link arrivals
 * (and a restored spot) are never yanked back: wherever the game put you, the
 * leash widens to include it.
 *
 * No progress yet (guests, outages, still loading) → no leash.
 */

import { ORIGIN_POSITION } from '@aweborn/shared/crdt-schema'
import { WARP_CHAPTER } from '@aweborn/shared/progress'
import { useProgressStore } from '../stores/progressStore'
import { useUniverseStore } from '../stores/universeStore'
import { useChatStore } from '../stores/chatStore'

const MIN_RADIUS = 100
const EXPLORER_MIN = 1500
const EXPLORER_EXTRA = 500
/** Room granted around a place the game put you (link arrival, restored spot). */
const ARRIVAL_MARGIN = 150
// An overshoot eases back at 2.5/s, applied per sim step (shared/sim/dmath LEASH_EASE_PER_STEP).
const NOTICE_EVERY_MS = 20_000

let granted = 0
let lastNotice = 0

function distFromOrigin(p: { x: number; y: number; z: number }): number {
  const dx = p.x - ORIGIN_POSITION.x
  const dy = p.y - ORIGIN_POSITION.y
  const dz = p.z - ORIGIN_POSITION.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** The leash radius right now, or null when there's none. */
export function leashRadius(): number | null {
  const v = useProgressStore.getState().view
  if (!v || v.chapter >= WARP_CHAPTER) return null
  const frontier = useUniverseStore.getState().mana?.frontierRadius ?? MIN_RADIUS
  const base = v.chapter >= 6 ? Math.max(EXPLORER_MIN, frontier + EXPLORER_EXTRA) : Math.max(MIN_RADIUS, frontier)
  return Math.max(base, granted)
}

/** The game placed the player here (link / card arrival, restored spot): never pull them back from it. */
export function grantLeashTo(p: { x: number; y: number; z: number }): void {
  granted = Math.max(granted, distFromOrigin(p) + ARRIVAL_MARGIN)
}

/**
 * The pull itself (bleed outward speed, ease the overshoot back) runs inside
 * the shared flight step (`shared/sim/flight.ts`, Phase 09 9A) with
 * `leashRadius()` in its SimWorld. Call this when a step reports it pulled.
 */
export function noteLeashed(): void {
  const now = Date.now()
  if (now - lastNotice > NOTICE_EVERY_MS) {
    lastNotice = now
    const ch = useProgressStore.getState().view?.chapter ?? 1
    useChatStore.getState().showNotice(
      ch >= 6
        ? 'This is as far as you go before warp. Finish chapter 6 to fly without limits.'
        : 'The Frontier holds you for now. Chapter 6 (Explorer) lets you fly beyond it.',
    )
  }
}

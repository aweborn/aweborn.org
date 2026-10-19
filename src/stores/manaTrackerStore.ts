/**
 * Personal mana tracker state: GET /api/player/mana (this player's allowance,
 * usage and averages). The universe-wide pool comes live from the Universe
 * CRDT (`universeStore.mana`); this is the private, per-player half.
 *
 * Anything that spends mana (planner turns, manifests, redos) can call
 * `refreshMana()` afterwards so the pill updates without waiting for the poll.
 */
import { create } from 'zustand'
import { AUTH_URL } from '../lib/player'

export interface UsageStat { count: number; total: number; average: number }

export interface ManaStatus {
  /** Personal cap per rolling 24 h */
  cap: number
  /** Unsaved player: small starter allowance until they save */
  guest: boolean
  /** Spent in the last 24 h (in-flight holds included) */
  spent: number
  /** What this player could draw right now (min of personal headroom and fair share of the flow) */
  remaining: number
  /** Held for generations still in flight */
  held: number
  /** The universe's flow per 24 h, and how much of it is used */
  flow: number
  flowSpent: number
  activePlayers: number
  windowMs: number
  /** Last 7 days, settled */
  week: { plan: UsageStat; model: UsageStat }
  recent: { at: number; amount: number; kind: 'plan' | 'model'; note: string | null }[]
  pool: { creative: number; available: number }
}

interface ManaTrackerState {
  status: ManaStatus | null
  loading: boolean
  error: boolean
}

export const useManaTracker = create<ManaTrackerState>(() => ({ status: null, loading: false, error: false }))

let inflight: Promise<void> | null = null

export function refreshMana(): Promise<void> {
  if (inflight) return inflight
  useManaTracker.setState({ loading: true })
  inflight = fetch(`${AUTH_URL}/api/player/mana`, { credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status))
      useManaTracker.setState({ status: (await res.json()) as ManaStatus, loading: false, error: false })
    })
    .catch(() => useManaTracker.setState({ loading: false, error: true }))
    .finally(() => { inflight = null })
  return inflight
}

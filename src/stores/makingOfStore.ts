import { create } from 'zustand'
import { AUTH_URL } from '../lib/player'
import type { MakingOf } from '@aweborn/shared/making-of'

/**
 * How the world you're in was made (Alex, 2026-11-02): its planner conversations, public,
 * read at the story stone by the spawn point (MakingOfStone + MakingOfPanel).
 */
interface MakingOfState {
  worldId: string | null
  data: MakingOf | null
  open: boolean
}

export const useMakingOf = create<MakingOfState>(() => ({ worldId: null, data: null, open: false }))

let inflight: Promise<void> | null = null
let inflightFor: string | null = null

/** Fetch (or refresh) a world's history. Quietly keeps what it had if the network is down. */
export function loadMakingOf(worldId: string): Promise<void> {
  if (inflight && inflightFor === worldId) return inflight
  if (useMakingOf.getState().worldId !== worldId) useMakingOf.setState({ worldId, data: null, open: false })
  inflightFor = worldId
  inflight = fetch(`${AUTH_URL}/making-of?worldId=${encodeURIComponent(worldId)}`)
    .then((r) => (r.ok ? (r.json() as Promise<MakingOf>) : null))
    .then((data) => {
      if (data && Array.isArray(data.sessions) && useMakingOf.getState().worldId === worldId) useMakingOf.setState({ data })
    })
    .catch(() => { /* offline: the stone shows what was loaded before, if anything */ })
    .finally(() => {
      inflight = null
      inflightFor = null
    })
  return inflight
}

export const openMakingOf = () => useMakingOf.setState({ open: true })
export const closeMakingOf = () => useMakingOf.setState({ open: false })


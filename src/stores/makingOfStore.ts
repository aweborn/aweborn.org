import { create } from 'zustand'
import { AUTH_URL } from '../lib/player'
import type { MakingOf } from '@aweborn/shared/making-of'
import { isAdultWorld } from '@aweborn/shared/crdt-schema'
import { useUniverseStore } from './universeStore'

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
  // An 18+ world's story is told only behind the 18+ door: the public route refuses it, the player route checks the door
  const adult = isAdultWorld(useUniverseStore.getState().worlds.get(worldId))
  inflight = fetch(`${AUTH_URL}${adult ? '/api/player' : ''}/making-of?worldId=${encodeURIComponent(worldId)}`, adult ? { credentials: 'include' } : undefined)
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


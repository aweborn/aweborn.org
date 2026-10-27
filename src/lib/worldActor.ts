import { canEditObject, isWorldOwnerId, type WorldActor } from '@aweborn/shared/world-policy'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'
import { useSyncExternalStore } from 'react'
import { getPlayerSnapshot, subscribePlayer } from './player'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'

/**
 * The local player as a world actor (Rough Draft M1): the same rules the
 * server enforces (`shared/world-policy.ts`), so the UI only offers edits
 * that will stick instead of letting them snap back.
 */
export function currentWorldActor(): WorldActor {
  const player = getPlayerSnapshot()
  const id = player && !player.isGuest ? player.playerId : null
  const worldId = useUniverseStore.getState().activeWorldId
  const entry = worldId ? useUniverseStore.getState().worlds.get(worldId) : undefined
  const meta = useWorldStore.getState().meta
  const roles = {
    creator: entry?.creator ?? meta?.creator ?? '',
    coCreators: entry?.coCreators ?? meta?.coCreators ?? [],
  }
  const mine = player?.characters ?? (id ? [id] : [])
  const owner = Boolean(id) && mine.some((c) => isWorldOwnerId(c, roles))
  return { id, owner }
}

/** May the local player move / edit / delete this object? */
export function canEditHere(obj: PlacedObject | undefined | null): boolean {
  return canEditObject(currentWorldActor(), obj ?? null)
}

/** May the local player change this world's terrain, sky and physics? */
export function ownsCurrentWorld(): boolean {
  return currentWorldActor().owner
}

/** Reactive: does the local player own (create / co-create) the world they're in? */
export function useOwnsCurrentWorld(): boolean {
  useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  useUniverseStore((s) => (s.activeWorldId ? s.worlds.get(s.activeWorldId) : undefined))
  useWorldStore((s) => s.meta)
  return ownsCurrentWorld()
}

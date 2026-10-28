import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { useUniverseStore } from '../stores/universeStore'
import { isFaceUp, useWorldIndexStore, worldEntryFor } from '../stores/worldIndexStore'
import { CARD_CHECKOUT_ON } from '../lib/cardCheckout'

/**
 * The world you're standing in, if a card of it can be ordered right now
 * (Rough Draft M6, Phase 08 "Get this card … in world settings"): card sales
 * are on, it's in your World Index as visited, it's still in the universe,
 * and it isn't Origin (Alex's own print run). Same rule as the World Index
 * detail and photo mode.
 *
 * Entry points: ••• More (touch) and the gear panel (desktop). Both open the
 * World Index on that world with checkout open.
 */
export function useCardableWorld(): string | null {
  const id = useUniverseStore((s) => s.activeWorldId)
  const entry = useWorldIndexStore((s) => (id ? s.entries.get(id) : undefined))
  if (!CARD_CHECKOUT_ON || !id || id === ORIGIN_WORLD_ID || !entry) return null
  return isFaceUp(entry) && worldEntryFor(entry) ? id : null
}

export function openCardCheckout(worldId: string): void {
  useWorldIndexStore.getState().openTo(worldId, true)
}

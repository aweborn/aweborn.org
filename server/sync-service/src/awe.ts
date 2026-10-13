/**
 * Awe hook (Phase 05 ↔ Phase 08).
 *
 * The World Index calls `onFirstDiscovery` when an account visits a world for
 * the first time. Phase 05 decides what that is worth (and whether it feeds
 * the Frontier, the spendable pool, or both); until then this is a stub that
 * only logs, so no mana exists anywhere yet.
 *
 * Only server-observed events reach here (entering a world = `rooms.joinWorld`).
 * Client-reported sightings never do: per Phase 09, the server must be able to
 * vouch for anything that pays out.
 */

export interface FirstDiscovery {
  accountId: string;
  worldId: string;
  characterId: string | null;
  /** Other clients already in the world when this one arrived (shared-awe 2×). */
  companions: number;
  at: number;
}

export type AweListener = (event: FirstDiscovery) => void;

const listeners = new Set<AweListener>();

/** Phase 05 subscribes here. Returns an unsubscribe function. */
export function onAwe(listener: AweListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onFirstDiscovery(event: FirstDiscovery): void {
  console.log(
    `[awe] first visit: world ${event.worldId}` +
      (event.companions > 0 ? ` with ${event.companions} other player(s)` : "") +
      " (no reward yet: Phase 05)",
  );
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[awe] listener failed:", err);
    }
  }
}

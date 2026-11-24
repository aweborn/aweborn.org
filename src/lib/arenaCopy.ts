import { stageOf } from '@aweborn/shared/game'
import { cellLocked, terrainLock, type ArenaObject } from '@aweborn/shared/arena'
import { useMatchStore } from './match'
import { useViewStore } from './matchView'
import { ownsCurrentWorld } from './worldActor'
import { setArenaCopy, useWorldStore } from '../stores/worldStore'
import { useUniverseStore } from '../stores/universeStore'

/**
 * A running match keeps its own copy of the arena (Phase 10, Q1b; shared/arena.ts). This
 * decides when the player is shown that copy instead of the live stage, and hands it to
 * the world store, whose `objects` everything draws and collides from.
 *
 * - **Playing**: always the match's copy, from the server's `arena` message, until the
 *   server puts the player back in the lobby. Whatever the owners add, move, recolour,
 *   kick or remove on the stage meanwhile is not seen, and not bumped into.
 * - **Watching a running match, or a replay of one played in this world**: the copy from
 *   the match's record, while flying the ghost camera, and for everyone who is not one of
 *   this world's builders while tuned in. A builder standing in the lobby keeps the live
 *   stage (they may be working on it, and must see what they do); in ghost flight they
 *   see the match's arena like anyone else.
 * - Records made before the copy existed have none: the live stage shows, as it did.
 *
 * The ground is not copied: the server locks it under a running match instead
 * (`matchLocksCell` is the same rule, so the owner is told before they try).
 */
function wanted(): { key: string; game: unknown; objects: ArenaObject[] } | null {
  const worldId = useUniverseStore.getState().activeWorldId
  const m = useMatchStore.getState()
  const worldGame = useWorldStore.getState().meta?.game ?? null
  if (m.playing) {
    return m.arena?.matchId === m.playing.matchId ? { key: `play:${m.playing.matchId}`, game: m.playing.game ?? worldGame, objects: m.arena.objects } : null
  }
  const v = useViewStore.getState()
  const asWatcher = v.ghost || !ownsCurrentWorld()
  if (v.replay) {
    const setup = v.replay.record.setup
    return asWatcher && setup.arena && setup.worldId === worldId ? { key: `replay:${setup.matchId}`, game: setup.game, objects: setup.arena.objects } : null
  }
  if (m.watching && v.watchArena?.matchId === m.watching) {
    return asWatcher ? { key: `watch:${m.watching}`, game: v.watchGame ?? worldGame, objects: v.watchArena.objects } : null
  }
  return null
}

export function syncArenaCopy(): void {
  const w = wanted()
  const stage = w ? stageOf(w.game) : null
  setArenaCopy(w && stage ? { key: w.key, stage, objects: w.objects } : null)
}

/** Keep the world store's view in step with what is being played or watched. Returns the stop function (which shows the live world again). */
export function watchArenaCopy(): () => void {
  const offMatch = useMatchStore.subscribe((s, p) => {
    if (s.playing !== p.playing || s.arena !== p.arena || s.watching !== p.watching) syncArenaCopy()
  })
  const offView = useViewStore.subscribe((s, p) => {
    if (s.replay !== p.replay || s.ghost !== p.ghost || s.watchArena !== p.watchArena) syncArenaCopy()
  })
  syncArenaCopy()
  return () => {
    offMatch()
    offView()
    setArenaCopy(null)
  }
}

/**
 * Is this terrain cell under the arena of a match running in this world right now? The
 * server refuses the edit (owners included); this lets the client say why first. Known
 * from the lobby's list of running matches, or from the match being played.
 */
export function matchLocksCell(size: readonly [number, number, number], gi: number, j: number, gk: number): boolean {
  const m = useMatchStore.getState()
  const running = Boolean(m.playing) || Boolean(m.lobby?.matches.some((r) => r.phase !== 'finished' && r.endedAt === undefined))
  if (!running) return false
  // The lobby doesn't say which game version each running match uses: the current arena and the played match's own both count
  const games = [m.playing?.game, useWorldStore.getState().meta?.game]
  return games.some((g) => cellLocked(terrainLock(g), size, gi, j, gk))
}

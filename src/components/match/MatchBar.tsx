import { useUniverseStore } from '../../stores/universeStore'
import { useWorldStore } from '../../stores/worldStore'
import { LobbyChip } from './LobbyChip'
import { WatchChip } from './WatchChip'
import { MatchLayer } from './MatchLayer'
import { WatchLayer } from './WatchLayer'
import './MatchBar.css'

/**
 * Where the game layer's screen pieces mount (Phase 10), for everyone in a world that
 * has a game:
 *   LobbyChip   the pool / queue chip and what opens from it (play layer)
 *   WatchChip   the 👁 chip that opens the list of matches and replays (view layer)
 *   MatchLayer  full-screen overlays of playing: ready check, match HUD, results (play layer)
 *   WatchLayer  spectator and replay controls (view layer)
 * In the 3D world, WorldInterior mounts MatchWorld (ring, in-match things) and
 * WatchWorld (the watched match's players and items, the hologram).
 * The two chips share one row under the world pill, so they never overlap each other.
 */
export function MatchBar() {
  const inWorld = useUniverseStore((s) => s.activeWorldId !== null)
  const hasGame = useWorldStore((s) => Boolean(s.meta?.game))
  if (!inWorld || !hasGame) return null
  return (
    <>
      <div className="match-bar" role="group" aria-label="Game">
        <LobbyChip />
        <WatchChip />
      </div>
      <MatchLayer />
      <WatchLayer />
    </>
  )
}

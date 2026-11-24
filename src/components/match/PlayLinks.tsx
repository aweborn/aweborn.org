import { useUniverseStore } from '../../stores/universeStore'
import { useWorldStore } from '../../stores/worldStore'
import { sendMatch, useMatchStore } from '../../lib/match'
import { playToast } from '../../lib/matchPlay'

/**
 * "Play with" / "Play against" in the player sheet (Phase 10, Q6 links): shown when
 * both of you are in a world that has a game and you are not in a match. The other
 * player gets an ask in their lobby sheet and must accept; the matchmaker then keeps
 * you on the same team, or on opposite ones.
 */
export function PlayLinks({ target, name, onDone }: { target: { id: string; place: string }; name: string; onDone: () => void }) {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const hasGame = useWorldStore((s) => Boolean(s.meta?.game))
  const playing = useMatchStore((s) => Boolean(s.playing))
  const link = useMatchStore((s) => s.lobby?.links.find((l) => l.with === target.id)?.kind ?? null)
  if (!worldId || !hasGame || playing || target.place !== worldId) return null
  const ask = (kind: 'with' | 'against') => {
    sendMatch(worldId, { t: 'link', to: target.id, kind })
    playToast(`Asked ${name} to play ${kind} you`)
    onDone()
  }
  return (
    <>
      <button id="pact-play-with" type="button" className="pact-btn" onClick={() => ask('with')}>
        <span aria-hidden="true">🤝</span>
        <span className="pact-btn-text">
          <span className="pact-btn-title">Play with{link === 'with' ? ' ✓' : ''}</span>
          <span className="pact-btn-sub">Ask to be on the same team in this world's game</span>
        </span>
      </button>
      <button id="pact-play-against" type="button" className="pact-btn" onClick={() => ask('against')}>
        <span aria-hidden="true">⚔️</span>
        <span className="pact-btn-text">
          <span className="pact-btn-title">Play against{link === 'against' ? ' ✓' : ''}</span>
          <span className="pact-btn-sub">Ask to be on opposite teams</span>
        </span>
      </button>
    </>
  )
}

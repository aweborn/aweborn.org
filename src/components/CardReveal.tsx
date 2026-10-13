import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { WorldIndexEntry } from '@aweborn/shared/crdt-schema'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { useWorldIndexStore } from '../stores/worldIndexStore'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'
import { WorldCard } from './WorldCard'

/**
 * First-visit card reveal (Phase 08B): the face-down card appears, flips to
 * show the world's art, holds, then flies into the HUD's World Index chip.
 * Origin gets it on first sighting (it has no interior): everyone's first card.
 */

const REVEAL_MS = 3800
const NO_CHARACTERS: readonly string[] = []

/** Reveals already shown (survives remounts; a reveal queued during loading still plays once). */
let lastPlayedSeq = 0

export function CardReveal() {
  const reveal = useWorldIndexStore((s) => s.reveal)
  const entries = useWorldIndexStore((s) => s.entries)
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot)
  const [active, setActive] = useState<{ entry: WorldIndexEntry; seq: number; fly: CSSProperties } | null>(null)

  useEffect(() => {
    if (!reveal || reveal.seq <= lastPlayedSeq) return
    const entry = useWorldIndexStore.getState().entries.get(reveal.worldId)
    if (!entry) return
    lastPlayedSeq = reveal.seq

    // Where to fly: the HUD chip (fall back to the top-left corner).
    const chip = document.getElementById('world-index-chip')?.getBoundingClientRect()
    const tx = (chip ? chip.left + chip.width / 2 : 80) - window.innerWidth / 2
    const ty = (chip ? chip.top + chip.height / 2 : 80) - window.innerHeight / 2
    setActive({ entry, seq: reveal.seq, fly: { '--cr-tx': `${tx}px`, '--cr-ty': `${ty}px` } as CSSProperties })
  }, [reveal, entries])

  const activeSeq = active?.seq
  useEffect(() => {
    if (!activeSeq) return
    const t = setTimeout(() => setActive(null), REVEAL_MS)
    return () => clearTimeout(t)
  }, [activeSeq])

  if (!active) return null
  const { entry } = active
  const isOrigin = entry.worldId === ORIGIN_WORLD_ID
  const name = entry.world?.name ?? 'A new world'

  return (
    <div key={active.seq} className="cr-overlay" role="status" aria-live="polite" style={active.fly}>
      <div className="cr-burst" style={{ '--wc-color': entry.world?.color ?? '#e8b94a' } as CSSProperties} />
      <div className="cr-fly">
        <div className="cr-flip">
          <WorldCard entry={entry} myCharacters={player?.characters ?? NO_CHARACTERS} face="back" className="cr-side cr-side--back" />
          <WorldCard entry={entry} myCharacters={player?.characters ?? NO_CHARACTERS} face="front" className="cr-side cr-side--front" />
        </div>
      </div>
      <p className="cr-caption">
        <span className="cr-kicker">{isOrigin ? 'Your first card' : 'New card'}</span>
        <span className="cr-name">{name}</span>
        <span className="cr-hint">
          Added to your World Index · <kbd>M</kbd>
        </span>
      </p>
    </div>
  )
}

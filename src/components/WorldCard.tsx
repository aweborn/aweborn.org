import { useCallback, useRef, type CSSProperties, type PointerEvent } from 'react'
import type { WorldIndexEntry } from '@aweborn/shared/crdt-schema'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { creatorLabel, formatCoords, isFaceUp } from '../stores/worldIndexStore'

/**
 * A World Index card. Face-up = an HTML replica of the printed front
 * template (scripts/cards/lib/front.mjs: 63 × 88 mm trim, Jost, same
 * palette and layout, positions in card millimetres via container units).
 * Face-down = the real printed back (public/cards/back.svg).
 *
 * Worlds have no art yet, so the art window is generated from the world's
 * colour (a live mini-render is a follow-up).
 */

/** Deterministic 0..1 from a string (art variation per world). */
function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0xffffffff
}

function CardArt({ entry }: { entry: WorldIndexEntry }) {
  if (entry.worldId === ORIGIN_WORLD_ID) {
    return (
      <div className="wc-art wc-art--portal" aria-hidden="true">
        <span className="wc-portal-halo" />
        <span className="wc-portal-ring" />
        <span className="wc-portal-core" />
      </div>
    )
  }
  const id = entry.worldId
  const style = {
    '--wc-light-x': `${25 + hash01(id, 1) * 30}%`,
    '--wc-light-y': `${20 + hash01(id, 2) * 25}%`,
    '--wc-orb-x': `${38 + hash01(id, 3) * 24}%`,
    '--wc-orb-y': `${42 + hash01(id, 4) * 16}%`,
    '--wc-tilt': `${-25 + hash01(id, 5) * 50}deg`,
    '--wc-stars-x': `${Math.round(hash01(id, 6) * 40)}px`,
  } as CSSProperties
  const ringed = hash01(id, 7) > 0.55
  return (
    <div className="wc-art" style={style} aria-hidden="true">
      <span className="wc-stars" />
      <span className="wc-nebula" />
      <span className="wc-orb">{ringed && <span className="wc-ring" />}</span>
    </div>
  )
}

/** The mark (three circles) from the card footer / favicon. */
function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="122 152 159 99" aria-hidden="true">
      <circle cx="177" cy="198" r="55" fill="#5b8cb8" />
      <circle cx="247" cy="217" r="34" fill="#a480b8" />
      <circle cx="234" cy="173" r="21" fill="#e8c860" />
    </svg>
  )
}

interface WorldCardProps {
  entry: WorldIndexEntry
  myCharacters: readonly string[]
  /** Interactive (hover tilt + glare). */
  tilt?: boolean
  /** Force a face (CardReveal flips between them). */
  face?: 'front' | 'back'
  className?: string
}

export function WorldCard({ entry, myCharacters, tilt = false, face, className }: WorldCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const showFront = face ? face === 'front' : isFaceUp(entry)
  const w = entry.world
  const color = w?.color ?? '#8b8fa8'

  const onMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    el.style.setProperty('--wc-rx', `${(0.5 - y) * 10}deg`)
    el.style.setProperty('--wc-ry', `${(x - 0.5) * 12}deg`)
    el.style.setProperty('--wc-gx', `${x * 100}%`)
    el.style.setProperty('--wc-gy', `${y * 100}%`)
  }, [])
  const onLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.removeProperty('--wc-rx')
    el.style.removeProperty('--wc-ry')
  }, [])

  return (
    <div
      ref={ref}
      className={`wc${tilt ? ' wc--tilt' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--wc-color': color } as CSSProperties}
      onPointerMove={tilt ? onMove : undefined}
      onPointerLeave={tilt ? onLeave : undefined}
    >
      {showFront ? (
        <div className="wc-face wc-front">
          <span className="wc-name">{w?.name ?? 'A faded world'}</span>
          <CardArt entry={entry} />
          <span className="wc-by">
            by <strong>{creatorLabel(w?.creator, myCharacters)}</strong>
          </span>
          {w && (
            <span className="wc-loc">
              {formatCoords(w.position)} · SECTOR {w.sector}
            </span>
          )}
          <span className="wc-rule" />
          <Mark className="wc-mark" />
          <span className="wc-set">World Index</span>
          <span className="wc-hint">aweborn.org</span>
          {entry.visitCount > 0 && (
            <span className="wc-visits" title={`${entry.visitCount} visit${entry.visitCount === 1 ? '' : 's'}`}>
              ×{entry.visitCount}
            </span>
          )}
          {tilt && <span className="wc-glare" />}
        </div>
      ) : (
        <div className="wc-face wc-back">
          <img src="/cards/back.svg" alt="" draggable={false} />
          <span className="wc-back-glow" />
          {tilt && <span className="wc-glare" />}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { WorldIndexEntry } from '@aweborn/shared/crdt-schema'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { creatorLabel, formatCoords, isFaceUp, worldEntryFor } from '../stores/worldIndexStore'
import {
  ART_H,
  ART_W,
  cancelStill,
  cardArtAvailable,
  hash01,
  requestStill,
  startLive,
  type CardLook,
} from '../lib/cardArt'

/**
 * A World Index card. Face-up = an HTML replica of the printed front
 * template (scripts/cards/lib/front.mjs: 63 × 88 mm trim, Jost, same
 * palette and layout, positions in card millimetres via container units).
 * Face-down = the real printed back (public/cards/back.svg).
 *
 * Worlds have no art yet, so the art window shows a mini-render of the world
 * (lib/cardArt.ts: the scene's own orb shaders). Still in the grid, animated
 * when `live` or hovered. Without WebGL it falls back to CSS orb art.
 */

/** The mini-render: one canvas, drawn by the shared card renderer. */
function RenderedArt({ look, live }: { look: CardLook; live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawn = useRef<string | null>(null)
  const { id, color, solidified } = look
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const l = { id, color, solidified }
    const key = `${id}|${color}|${solidified}`
    if (live) {
      drawn.current = key
      return startLive(canvas, l)
    }
    if (drawn.current === key) return // keep the last live frame
    // Grid cards: render once, when first on screen.
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      drawn.current = key
      requestStill(canvas, l)
      io.disconnect()
    })
    io.observe(canvas)
    return () => {
      io.disconnect()
      cancelStill(canvas)
    }
  }, [id, color, solidified, live])
  return <canvas ref={ref} className="wc-art-canvas" width={ART_W} height={ART_H} />
}

function CardArt({ entry, live }: { entry: WorldIndexEntry; live: boolean }) {
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
  if (cardArtAvailable()) {
    const look: CardLook = {
      id,
      color: entry.world?.color ?? '#8b8fa8',
      solidified: worldEntryFor(entry)?.solidified ?? entry.world?.solidified ?? true,
    }
    return (
      <div className="wc-art" aria-hidden="true">
        <RenderedArt look={look} live={live} />
      </div>
    )
  }
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
  /** Animate the art (detail view, reveal). Tilt cards also animate while hovered. */
  live?: boolean
  className?: string
}

export function WorldCard({ entry, myCharacters, tilt = false, face, live = false, className }: WorldCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
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
    setHovered(false)
    const el = ref.current
    if (!el) return
    el.style.removeProperty('--wc-rx')
    el.style.removeProperty('--wc-ry')
  }, [])
  const onEnter = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') setHovered(true)
  }, [])

  return (
    <div
      ref={ref}
      className={`wc${tilt ? ' wc--tilt' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--wc-color': color } as CSSProperties}
      onPointerMove={tilt ? onMove : undefined}
      onPointerEnter={tilt ? onEnter : undefined}
      onPointerLeave={tilt ? onLeave : undefined}
    >
      {showFront ? (
        <div className="wc-face wc-front">
          <span className="wc-name">{w?.name ?? 'A faded world'}</span>
          <CardArt entry={entry} live={live || hovered} />
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

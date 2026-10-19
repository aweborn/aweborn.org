import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import { placeModel, placeBlock, placeShape, useWorldStore } from '../stores/worldStore'
import { placeOnTerrain } from '../stores/worldVoxels'
import { usePresence } from '../hooks/usePresence'
import { interiorController } from '../systems/InteriorController'
import { libraryThumb } from '../lib/libraryThumbs'
import {
  STANDARD_BLOCKS, SHAPES, SHAPE_COLORS, SHAPE_SIZE, cleanColor, snapToCell, stackedY,
  type LibraryBlock,
} from '@aweborn/shared/library'

/**
 * Library. Press B (or tap ▦ Library) inside a world. Three shelves:
 *  - Blocks: terrain-style blocks (this world's own, plus the standard set), snapped to the grid
 *  - Shapes: cubes, rings, cones … in any color and size
 *  - Made: every model anyone has made, searchable
 * Everything placed from the Library is free (blocks and shapes never touch the
 * server, so they work offline); placing an existing made model is free too, it
 * is already made.
 */
interface Asset {
  sha: string
  file: string
  kind: string
  prompt: string
  bytes: number
  thumb?: number
  creator?: string | null
  created_at: number
}

const STARTING_SIZE = 3 // meters, longest side

type Tab = 'blocks' | 'shapes' | 'made'
const PREFS_KEY = 'aweborn-library-prefs'

function loadPrefs(): { color: string; size: number; tab: Tab } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { color?: string; size?: number; tab?: Tab }
    return {
      color: cleanColor(p.color, SHAPE_COLORS[5]),
      size: Math.min(SHAPE_SIZE.max, Math.max(SHAPE_SIZE.min, Number(p.size) || SHAPE_SIZE.start)),
      tab: p.tab === 'shapes' || p.tab === 'made' ? p.tab : 'blocks',
    }
  } catch {
    return { color: SHAPE_COLORS[5], size: SHAPE_SIZE.start, tab: 'blocks' }
  }
}

/** A little silhouette of each shape in the chosen color. */
function ShapeIcon({ id, color }: { id: string; color: string }) {
  const common = { fill: color, stroke: 'rgba(0,0,0,0.35)', strokeWidth: 1.5 }
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      {id === 'cube' && <rect x="9" y="9" width="30" height="30" rx="3" {...common} />}
      {id === 'sphere' && <circle cx="24" cy="24" r="16" {...common} />}
      {id === 'cylinder' && <path d="M10 14a14 6 0 0 1 28 0v20a14 6 0 0 1-28 0z" {...common} />}
      {id === 'cone' && <path d="M24 7 38 36a14 6 0 0 1-28 0z" {...common} />}
      {id === 'pyramid' && <path d="M24 7 41 38H7z" {...common} />}
      {id === 'torus' && <circle cx="24" cy="24" r="13" fill="none" stroke={color} strokeWidth="8" />}
    </svg>
  )
}

/**
 * A model's thumbnail: the server's preview if it kept one, otherwise one drawn
 * here once the row scrolls into view (and remembered on this device). Until
 * it's ready, a soft tinted tile (a different tint per model).
 */
function AssetThumb({ a }: { a: Asset }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [src, setSrc] = useState<string | null>(a.thumb ? `${AUTH_URL}/assets/${a.sha}.png` : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (a.thumb || src || failed) return
    const el = ref.current
    if (!el) return
    let live = true
    const start = () => {
      void libraryThumb(a.sha, a.file).then((url) => {
        if (!live) return
        if (url) setSrc(url)
        else setFailed(true)
      })
    }
    if (typeof IntersectionObserver === 'undefined') {
      start()
      return () => { live = false }
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect()
        start()
      }
    })
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [a.sha, a.file, a.thumb, src, failed])

  if (src) return <img className="library-thumb" src={src} alt="" loading="lazy" width={64} height={64} />
  const hue = parseInt(a.sha.slice(0, 4), 16) % 360
  return (
    <span
      ref={ref}
      className={`library-thumb library-thumb--none${failed ? '' : ' is-loading'}`}
      style={{ background: `linear-gradient(145deg, hsl(${hue} 45% 32% / 0.7), hsl(${(hue + 40) % 360} 45% 22% / 0.7))` }}
      aria-hidden="true"
    >
      ▦
    </span>
  )
}

export function LibraryPanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const { playerId } = usePresence()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The pseudonym the server stores as an asset's maker (first 6 hex of sha256(playerId))
  const [myMaker, setMyMaker] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [prefs, setPrefs] = useState(loadPrefs)
  const { tab, color, size } = prefs
  const worldTerrain = useWorldStore((s) => s.voxelTerrain)
  const setPref = useCallback((p: Partial<typeof prefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...p }
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* private mode: fine */ }
      return next
    })
  }, [])
  // This world's own terrain blocks first, then the standard set (skipping repeats)
  const worldBlocks: LibraryBlock[] = (worldTerrain?.blocks ?? []).map((b) => ({ id: b.id, name: b.name, color: cleanColor(b.color) }))
  const standardBlocks = STANDARD_BLOCKS.filter((b) => !worldBlocks.some((w) => w.id === b.id))

  useEffect(() => {
    if (!playerId) return
    let live = true
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(playerId)).then((buf) => {
      if (live) setMyMaker([...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 6))
    })
    return () => {
      live = false
    }
  }, [playerId])

  const remove = useCallback(async (a: Asset) => {
    setConfirming(null)
    try {
      const res = await fetch(`${AUTH_URL}/api/player/library/${a.sha}/remove`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error('bad')
      setAssets((all) => all.filter((x) => x.sha !== a.sha))
    } catch {
      setError("Couldn't remove that. Try again soon.")
    }
  }, [])

  useEffect(() => {
    if (!activeWorldId) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.code === 'KeyB') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorldId])

  // Search as you type (debounced). Only the Made shelf needs the network: Blocks and Shapes work offline.
  useEffect(() => {
    if (!open || tab !== 'made') return
    setLoading(true)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${AUTH_URL}/library?q=${encodeURIComponent(q.trim())}&limit=60`, { signal: ctrl.signal })
        if (!res.ok) throw new Error('bad')
        const j = (await res.json()) as { assets: Asset[] }
        setAssets(j.assets.filter((a) => a.kind === 'model'))
        setError(null)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError('The library is resting right now. Try again soon.')
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [open, q, tab])

  useEffect(() => {
    if (open && tab === 'made') setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, tab])

  const place = useCallback(
    (a: Asset) => {
      const doc = useUniverseStore.getState().activeWorldDoc
      if (!doc) return
      const s = interiorController.state
      const dist = STARTING_SIZE / 2 + 2
      placeModel(doc, a.file, a.prompt, { x: s.x + s.fx * dist, y: s.y + STARTING_SIZE / 2, z: s.z + s.fz * dist }, playerId, {
        scale: STARTING_SIZE,
      })
      setPlaced(a.sha)
      setTimeout(() => setPlaced((p) => (p === a.sha ? null : p)), 1600)
    },
    [playerId],
  )

  const flash = useCallback((key: string) => {
    setPlaced(key)
    setTimeout(() => setPlaced((p) => (p === key ? null : p)), 1200)
  }, [])

  // A block goes on the grid cell in front of you, at your feet's height, stacking on blocks already there
  const placeBlockAhead = useCallback(
    (b: LibraryBlock) => {
      const doc = useUniverseStore.getState().activeWorldDoc
      if (!doc) return
      const s = interiorController.state
      const t = useWorldStore.getState().voxelTerrain
      const wx = t?.size[0] ?? 40
      const wz = t?.size[2] ?? 40
      const x = snapToCell(s.x + s.fx * 2, wx)
      const z = snapToCell(s.z + s.fz * 2, wz)
      let y = Math.floor(s.y + 0.01) + 0.5
      if (t) {
        // Never inside the ground: lift to the terrain surface of that cell
        const surface = placeOnTerrain(t, [Math.floor(x + wx / 2), 0, Math.floor(z + wz / 2)]).y
        y = Math.max(y, surface + 0.5)
      }
      y = stackedY(y, x, z, useWorldStore.getState().objects.values())
      placeBlock(doc, b, { x, y, z }, playerId)
      flash(`block:${b.id}`)
    },
    [playerId, flash],
  )

  // A shape stands in front of you, resting at your feet's height
  const placeShapeAhead = useCallback(
    (shapeId: string) => {
      const doc = useUniverseStore.getState().activeWorldDoc
      const shape = SHAPES.find((x) => x.id === shapeId)
      if (!doc || !shape) return
      const s = interiorController.state
      const dist = size / 2 + 1.5
      placeShape(doc, shape, { color, size }, { x: s.x + s.fx * dist, y: s.y + size / 2, z: s.z + s.fz * dist }, playerId)
      flash(`shape:${shapeId}`)
    },
    [playerId, color, size, flash],
  )

  if (!activeWorldId) return null

  if (!open) {
    return (
      <button id="library-open" className="planner-open library-open" type="button" onClick={() => setOpen(true)}>
        ▦ Library <kbd>B</kbd>
      </button>
    )
  }

  return (
    <aside id="library-panel" className="planner library" aria-label="Asset library">
      <header className="planner-head">
        <h2 className="planner-title">Library</h2>
        <button className="planner-close" type="button" aria-label="Close library" onClick={() => setOpen(false)}>
          ×
        </button>
      </header>
      <nav className="library-tabs" role="tablist" aria-label="Library shelves">
        {([['blocks', 'Blocks'], ['shapes', 'Shapes'], ['made', 'Made']] as const).map(([id, label]) => (
          <button
            key={id}
            id={`library-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`library-tab${tab === id ? ' is-on' : ''}`}
            onClick={() => setPref({ tab: id })}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'blocks' && (
        <div className="library-shelf" id="library-blocks">
          {worldBlocks.length > 0 && (
            <>
              <h3 className="library-shelf-title">This world</h3>
              <ul className="library-blocks">
                {worldBlocks.map((b) => (
                  <li key={`w-${b.id}`}>
                    <button type="button" className="library-block" onClick={() => placeBlockAhead(b)} title={`Place ${b.name}`}>
                      <span className="library-swatch" style={{ background: b.color }} />
                      <span>{placed === `block:${b.id}` ? 'Placed ✓' : b.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 className="library-shelf-title">Standard</h3>
          <ul className="library-blocks">
            {standardBlocks.map((b) => (
              <li key={b.id}>
                <button type="button" className="library-block" onClick={() => placeBlockAhead(b)} title={`Place ${b.name}`}>
                  <span className="library-swatch" style={{ background: b.color }} />
                  <span>{placed === `block:${b.id}` ? 'Placed ✓' : b.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="library-hint">Blocks snap to the grid and stack. Free, and they work offline.</p>
        </div>
      )}

      {tab === 'shapes' && (
        <div className="library-shelf" id="library-shapes">
          <div className="library-picker">
            <label className="library-color" htmlFor="library-color">
              <input
                id="library-color"
                type="color"
                value={color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color}
                onChange={(e) => setPref({ color: cleanColor(e.target.value, color) })}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Shape color"
              />
              <span>Color</span>
            </label>
            <div className="library-swatches" role="group" aria-label="Quick colors">
              {SHAPE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`library-dot${c === color ? ' is-on' : ''}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => setPref({ color: c })}
                />
              ))}
            </div>
          </div>
          <label className="library-size" htmlFor="library-size">
            <span>Size</span>
            <input
              id="library-size"
              type="range"
              min={SHAPE_SIZE.min}
              max={SHAPE_SIZE.max}
              step={SHAPE_SIZE.step}
              value={size}
              onChange={(e) => setPref({ size: Number(e.target.value) })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <b>{size} m</b>
          </label>
          <ul className="library-shapes">
            {SHAPES.map((s) => (
              <li key={s.id}>
                <button type="button" className="library-shape" onClick={() => placeShapeAhead(s.id)} title={`Place ${s.name}`}>
                  <ShapeIcon id={s.id} color={color} />
                  <span>{placed === `shape:${s.id}` ? 'Placed ✓' : s.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="library-hint">Pick a color and size, then tap a shape. Free, and they work offline.</p>
        </div>
      )}

      {tab === 'made' && (
        <form className="planner-form" onSubmit={(e) => e.preventDefault()}>
          <input
            ref={inputRef}
            id="library-search"
            className="planner-input"
            placeholder="Search everything anyone has made…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </form>
      )}
      {tab === 'made' && error && <p className="planner-error">{error}</p>}
      {tab === 'made' && (
      <ul className="library-list">
        {assets.map((a) => (
          <li key={a.sha} className="library-item">
            <AssetThumb a={a} />
            <p className="library-prompt">{a.prompt}</p>
            <span className="library-meta">
              {a.creator ? `by maker ${a.creator} · ` : ''}{(a.bytes / 1_048_576).toFixed(1)} MB · {new Date(a.created_at).toLocaleDateString()}
            </span>
            <button type="button" className="planner-chip library-place" onClick={() => place(a)}>
              {placed === a.sha ? 'Placed ✓' : 'Place'}
            </button>
            {myMaker && a.creator === myMaker &&
              (confirming === a.sha ? (
                <button type="button" className="planner-chip library-remove" onClick={() => remove(a)} onBlur={() => setConfirming(null)} autoFocus>
                  Remove for everyone?
                </button>
              ) : (
                <button type="button" className="planner-chip library-remove" aria-label={`Remove ${a.prompt}`} title="Remove" onClick={() => setConfirming(a.sha)}>
                  ✕
                </button>
              ))}
          </li>
        ))}
        {!loading && !assets.length && !error && <li className="planner-empty">Nothing here yet. Make something, and it lands here for everyone.</li>}
      </ul>
      )}
    </aside>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import { useWorldStore } from '../stores/worldStore'
import { usePresence } from '../hooks/usePresence'
import { libraryThumb } from '../lib/libraryThumbs'
import { matchesBinding } from '../stores/keybindingStore'
import { useSheet } from '../stores/sheetStore'
import { useHeldItemStore } from '../stores/heldItemStore'
import { useOwnsCurrentWorld } from '../lib/worldActor'
import { MakeTabs } from './MakeTabs'
import {
  STANDARD_BLOCKS, SHAPES, SHAPE_COLORS, SHAPE_SIZE, cleanColor,
  type LibraryBlock,
} from '@aweborn/shared/library'

/**
 * Library. Press B (or tap ▦ Library) inside a world. Three shelves:
 *  - Blocks: terrain-style blocks (this world's own, plus the standard set), snapped to the grid
 *  - Shapes: cubes, rings, cones … in any color and size
 *  - Made: every model anyone has made, searchable
 * And for the world's creators, a fourth: Terrain (dig the ground, fill it with
 * the world's own blocks; Rough Draft M5d).
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

type Tab = 'blocks' | 'shapes' | 'made' | 'terrain'
const TABS: ReadonlyArray<readonly [Tab, string]> = [['blocks', 'Blocks'], ['shapes', 'Shapes'], ['made', 'Made']]
const TABS_WITH_TERRAIN: ReadonlyArray<readonly [Tab, string]> = [...TABS, ['terrain', 'Terrain']]
const PREFS_KEY = 'aweborn-library-prefs'

function loadPrefs(): { color: string; size: number; tab: Tab } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { color?: string; size?: number; tab?: Tab }
    return {
      color: cleanColor(p.color, SHAPE_COLORS[5]),
      size: Math.min(SHAPE_SIZE.max, Math.max(SHAPE_SIZE.min, Number(p.size) || SHAPE_SIZE.start)),
      tab: p.tab === 'shapes' || p.tab === 'made' || p.tab === 'terrain' ? p.tab : 'blocks',
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
  const [open, setOpen] = useSheet('library')
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
  const worldTerrain = useWorldStore((s) => s.voxelTerrain)
  // Terrain shelf: only the world's creators, and only where there's voxel ground to reshape
  const owns = useOwnsCurrentWorld()
  const canTerrain = owns && !!worldTerrain
  const tab: Tab = prefs.tab === 'terrain' && !canTerrain ? 'blocks' : prefs.tab
  const { color, size } = prefs
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
  const tabs = canTerrain ? TABS_WITH_TERRAIN : TABS

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
      if (matchesBinding(e, 'library')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorldId, setOpen])

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

  // Keyboard moves between shelves keep focus on the tabs (no jump into the search box)
  const keyNav = useRef(false)
  useEffect(() => {
    if (keyNav.current) { keyNav.current = false; return }
    if (open && tab === 'made') setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, tab])

  const equip = useHeldItemStore((s) => s.equip)
  const heldItem = useHeldItemStore((s) => s.item)

  // Clear equipped item when leaving a world
  useEffect(() => {
    if (!activeWorldId) useHeldItemStore.getState().clear()
  }, [activeWorldId])

  const selectModel = useCallback(
    (a: Asset) => {
      equip({ kind: 'model', sha: a.sha, file: a.file, prompt: a.prompt, size: STARTING_SIZE, rotY: 0 })
      setPlaced(a.sha)
      setOpen(false)
    },
    [equip, setOpen],
  )

  const selectBlock = useCallback(
    (b: LibraryBlock) => {
      equip({ kind: 'block', block: b })
      setPlaced(`block:${b.id}`)
      setOpen(false)
    },
    [equip, setOpen],
  )

  const selectShape = useCallback(
    (shapeId: string) => {
      const shape = SHAPES.find((x) => x.id === shapeId)
      if (!shape) return
      equip({ kind: 'shape', shape, color, size, rotY: 0 })
      setPlaced(`shape:${shapeId}`)
      setOpen(false)
    },
    [equip, color, size, setOpen],
  )

  // Terrain tools: `block` is the grid's 1-based index into this world's blocks
  const selectTerrain = useCallback(
    (tool: { op: 'dig' } | { op: 'fill'; block: number; name: string; color: string }) => {
      equip({ kind: 'terrain', ...tool })
      setPlaced(tool.op === 'dig' ? 'terrain:dig' : `terrain:${tool.block}`)
      setOpen(false)
    },
    [equip, setOpen],
  )

  // Arrow keys / Home / End move between shelves (the tab pattern), focus follows the selection
  const onTabKey = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const i = tabs.findIndex(([id]) => id === tab)
      const n = tabs.length
      const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
      if (next < 0) return
      e.preventDefault()
      e.stopPropagation()
      keyNav.current = true
      setPref({ tab: tabs[next][0] })
      document.getElementById(`library-tab-${tabs[next][0]}`)?.focus()
    },
    [tabs, tab, setPref],
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
      <MakeTabs current="library" />
      <header className="planner-head">
        <h2 className="planner-title">Library</h2>
        <button className="planner-close" type="button" aria-label="Close library" onClick={() => setOpen(false)}>
          ×
        </button>
      </header>
      <nav className="library-tabs" role="tablist" aria-label="Library shelves" onKeyDown={onTabKey}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`library-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`library-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`library-tab${tab === id ? ' is-on' : ''}`}
            onClick={() => setPref({ tab: id })}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'terrain' && worldTerrain && (
        <div className="library-shelf" id="library-terrain" role="tabpanel" aria-labelledby="library-tab-terrain">
          <ul className="library-blocks">
            <li>
              <button
                id="library-terrain-dig"
                type="button"
                className={`library-block library-dig${heldItem?.kind === 'terrain' && heldItem.op === 'dig' ? ' is-on' : ''}`}
                onClick={() => selectTerrain({ op: 'dig' })}
                title="Hold the digger, then tap DIG to take out the ground in front of you"
              >
                <span className="library-swatch library-swatch--dig" aria-hidden="true">⛏</span>
                <span>{(heldItem?.kind === 'terrain' && heldItem.op === 'dig') || placed === 'terrain:dig' ? 'Dig ✓' : 'Dig'}</span>
              </button>
            </li>
            {worldTerrain.blocks.map((b, i) => {
              const n = i + 1
              const c = cleanColor(b.color)
              const isHeld = heldItem?.kind === 'terrain' && heldItem.op === 'fill' && heldItem.block === n
              return (
                <li key={`t-${b.id}`}>
                  <button
                    type="button"
                    className={`library-block${isHeld ? ' is-on' : ''}`}
                    onClick={() => selectTerrain({ op: 'fill', block: n, name: b.name, color: c })}
                    aria-label={`Fill with ${b.name}`}
                    title={`Hold ${b.name}, then tap FILL to raise the ground in front of you`}
                  >
                    <span className="library-swatch" style={{ background: c }} aria-hidden="true" />
                    <span>{isHeld || placed === `terrain:${n}` ? `${b.name} ✓` : b.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="library-hint">
            Reshape this world's ground: hold Dig or a block, face where you want it and tap the button. Everyone here sees it. Only creators can do this, and reshaping the whole terrain in the planner starts the ground fresh.
          </p>
        </div>
      )}

      {tab === 'blocks' && (
        <div className="library-shelf" id="library-blocks" role="tabpanel" aria-labelledby="library-tab-blocks">
          {worldBlocks.length > 0 && (
            <>
              <h3 className="library-shelf-title">This world</h3>
              <ul className="library-blocks">
                {worldBlocks.map((b) => {
                  const isHeld = heldItem?.kind === 'block' && heldItem.block.id === b.id
                  return (
                    <li key={`w-${b.id}`}>
                      <button type="button" className={`library-block${isHeld ? ' is-on' : ''}`} onClick={() => selectBlock(b)} title={`Hold ${b.name} to place`}>
                        <span className="library-swatch" style={{ background: b.color }} />
                        <span>{isHeld || placed === `block:${b.id}` ? `${b.name} ✓` : b.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <h3 className="library-shelf-title">Standard</h3>
          <ul className="library-blocks">
            {standardBlocks.map((b) => {
              const isHeld = heldItem?.kind === 'block' && heldItem.block.id === b.id
              return (
                <li key={b.id}>
                  <button type="button" className={`library-block${isHeld ? ' is-on' : ''}`} onClick={() => selectBlock(b)} title={`Hold ${b.name} to place`}>
                    <span className="library-swatch" style={{ background: b.color }} />
                    <span>{isHeld || placed === `block:${b.id}` ? `${b.name} ✓` : b.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="library-hint">Tap a block to hold it in your hand, then walk and tap PLACE as many times as you want.</p>
        </div>
      )}

      {tab === 'shapes' && (
        <div className="library-shelf" id="library-shapes" role="tabpanel" aria-labelledby="library-tab-shapes">
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
            {SHAPES.map((s) => {
              const isHeld = heldItem?.kind === 'shape' && heldItem.shape.id === s.id
              return (
                <li key={s.id}>
                  <button type="button" className={`library-shape${isHeld ? ' is-on' : ''}`} onClick={() => selectShape(s.id)} title={`Hold ${s.name} to place`}>
                    <ShapeIcon id={s.id} color={color} />
                    <span>{isHeld || placed === `shape:${s.id}` ? `${s.name} ✓` : s.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="library-hint">Pick a color and size, then tap a shape to hold it in your hand and place it anywhere.</p>
        </div>
      )}

      {tab === 'made' && (
        <div className="library-made" id="library-made" role="tabpanel" aria-labelledby="library-tab-made">
        <form className="planner-form" onSubmit={(e) => e.preventDefault()}>
          <input
            ref={inputRef}
            id="library-search"
            className="planner-input"
            placeholder="Search everything anyone has made…"
            aria-label="Search the library"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </form>
      {error && <p className="planner-error">{error}</p>}
      <ul className="library-list">
        {assets.map((a) => {
          const isHeld = heldItem?.kind === 'model' && heldItem.sha === a.sha
          return (
          <li key={a.sha} className="library-item">
            <AssetThumb a={a} />
            <p className="library-prompt">{a.prompt}</p>
            <span className="library-meta">
              {a.creator ? `by maker ${a.creator} · ` : ''}{(a.bytes / 1_048_576).toFixed(1)} MB · {new Date(a.created_at).toLocaleDateString()}
            </span>
            <button type="button" className="planner-chip library-place" onClick={() => selectModel(a)}>
              {isHeld || placed === a.sha ? 'In hand ✓' : 'Hold'}
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
          )
        })}
        {!loading && !assets.length && !error && <li className="planner-empty">Nothing here yet. Make something, and it lands here for everyone.</li>}
      </ul>
        </div>
      )}
    </aside>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import { placeModel } from '../stores/worldStore'
import { usePresence } from '../hooks/usePresence'
import { interiorController } from '../systems/InteriorController'

/**
 * Asset library: every model anyone has made. Press B (or tap ▦ Library)
 * inside a world, search by what it was made from, and place it in front of
 * you. Placing an existing asset is free; it is already made.
 */
interface Asset {
  sha: string
  file: string
  kind: string
  prompt: string
  bytes: number
  created_at: number
}

const STARTING_SIZE = 3 // meters, longest side

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

  // Search as you type (debounced)
  useEffect(() => {
    if (!open) return
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
  }, [open, q])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

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
      {error && <p className="planner-error">{error}</p>}
      <ul className="library-list">
        {assets.map((a) => (
          <li key={a.sha} className="library-item">
            <p className="library-prompt">{a.prompt}</p>
            <span className="library-meta">
              {(a.bytes / 1_048_576).toFixed(1)} MB · {new Date(a.created_at).toLocaleDateString()}
            </span>
            <button type="button" className="planner-chip library-place" onClick={() => place(a)}>
              {placed === a.sha ? 'Placed ✓' : 'Place'}
            </button>
          </li>
        ))}
        {!loading && !assets.length && !error && <li className="planner-empty">Nothing here yet. Make something, and it lands here for everyone.</li>}
      </ul>
    </aside>
  )
}

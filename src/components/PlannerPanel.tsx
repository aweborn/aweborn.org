import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import type { Blueprint } from '@aweborn/shared/blueprint'
import { usePlannerStore } from '../stores/plannerStore'
import { setVoxelTerrain, placeModel } from '../stores/worldStore'
import { usePresence } from '../hooks/usePresence'
import { cellToWorld, generateVoxels } from '@aweborn/shared/voxel'
import type { BlueprintAsset } from '@aweborn/shared/blueprint'

/**
 * World Planner panel (Phase 07): talk a world into a blueprint before
 * anything is made. Press P or tap ✧ Plan inside a world. Each turn is a
 * paid request (reserve → settle on the server). Manifest comes next.
 */

interface Turn {
  who: 'you' | 'planner'
  text: string
  chips?: string[]
  meta?: string
}

interface Making {
  key: string
  jobId?: string
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'later'
  progress: number
  message?: string
  asset: BlueprintAsset
  blueprintId: string
  terrain: Blueprint['terrain']
}
const POLL_MS = 2500

const MODEL_LABEL = (id: string) => id.split('/')[1] ?? id

export function PlannerPanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const ghostVisible = usePlannerStore((s) => s.visible)
  const { playerId } = usePresence()
  const [makings, setMakings] = useState<Making[]>([])
  const [manifesting, setManifesting] = useState(false)

  // Poll manifest jobs; place each model where the blueprint put it (works with the panel closed)
  useEffect(() => {
    const pending = makings.filter((m) => m.jobId && (m.status === 'queued' || m.status === 'processing'))
    if (!pending.length) return
    const t = setTimeout(async () => {
      for (const m of pending) {
        try {
          const res = await fetch(`${AUTH_URL}/api/player/create/${m.jobId}`, { credentials: 'include' })
          if (!res.ok) continue
          const j = (await res.json()) as { status: Making['status']; progress: number; asset?: string; error?: string }
          if (j.status === 'complete' && j.asset) {
            const doc = useUniverseStore.getState().activeWorldDoc
            const grid = generateVoxels(m.terrain)
            const at = m.asset.at ?? [grid.size[0] / 2, 0, grid.size[2] / 2]
            const p = cellToWorld(grid, at)
            const scale = Math.max(...(m.asset.size ?? [1.5, 1.5, 1.5]))
            if (doc) {
              placeModel(doc, j.asset, m.asset.prompt, { x: p.x, y: p.y + scale / 2, z: p.z }, playerId, {
                scale, rotY: m.asset.rotationY, planKey: `${m.blueprintId}:${m.key}`,
              })
            }
          }
          setMakings((all) => all.map((x) => (x.jobId === m.jobId ? { ...x, status: j.status, progress: j.progress, message: j.error } : x)))
        } catch {
          /* keep polling */
        }
      }
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [makings, playerId])

  // Entering a world resumes your last plan there (everything is saved server-side)
  useEffect(() => {
    setSessionId(null)
    setTurns([])
    setBlueprint(null)
    usePlannerStore.getState().clear()
    if (!activeWorldId) {
      setOpen(false)
      return
    }
    let cancelled = false
    fetch(`${AUTH_URL}/api/player/plan?worldId=${encodeURIComponent(activeWorldId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { session: { sessionId: string; blueprint: Blueprint | null; turns: Turn[] } | null } | null) => {
        if (cancelled || !j?.session) return
        setSessionId(j.session.sessionId)
        setTurns(j.session.turns)
        setBlueprint(j.session.blueprint)
        if (j.session.blueprint) usePlannerStore.getState().setBlueprint(activeWorldId, j.session.blueprint)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeWorldId])

  useEffect(() => {
    if (!activeWorldId) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.code === 'KeyP') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorldId])

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 0)
    if (models.length) return
    fetch(`${AUTH_URL}/api/player/plan/models`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { models: string[]; default: string } | null) => {
        if (!j) return
        setModels(j.models)
        setModel((m) => m || j.default)
      })
      .catch(() => {})
  }, [open, models.length])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy])

  const manifest = useCallback(async () => {
    if (!blueprint || !sessionId || manifesting || !activeWorldId) return
    setManifesting(true)
    setError(null)
    try {
      const res = await fetch(`${AUTH_URL}/api/player/plan/manifest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        terrain?: Blueprint['terrain']; items?: { key: string; jobId?: string; error?: string; message?: string }[]; message?: string
      }
      if (!res.ok || !j.terrain || !j.items) {
        setError(j.message ?? 'The manifest didn\'t start. Nothing was drawn.')
        return
      }
      // Terrain is free and instant: write it to the world so everyone sees it
      const doc = useUniverseStore.getState().activeWorldDoc
      if (doc) setVoxelTerrain(doc, j.terrain)
      const byKey = new Map(blueprint.assets.map((a) => [a.key, a]))
      setMakings((prev) => [
        ...prev.filter((m) => m.status === 'queued' || m.status === 'processing'),
        ...j.items!.filter((it) => byKey.has(it.key)).map((it): Making => ({
          key: it.key,
          jobId: it.jobId,
          status: it.jobId ? 'queued' : it.error === 'later' ? 'later' : 'failed',
          progress: 0,
          message: it.message,
          asset: byKey.get(it.key)!,
          blueprintId: blueprint.id,
          terrain: j.terrain!,
        })),
      ])
    } catch {
      setError('Creation is resting right now. Try again soon.')
    } finally {
      setManifesting(false)
    }
  }, [blueprint, sessionId, manifesting, activeWorldId])

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || busy || !activeWorldId) return
      setBusy(true)
      setError(null)
      setInput('')
      setTurns((t) => [...t, { who: 'you', text: message }])
      try {
        const res = await fetch(`${AUTH_URL}/api/player/plan`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, worldId: activeWorldId, message, model: model || undefined }),
        })
        const j = (await res.json().catch(() => ({}))) as {
          sessionId?: string; reply?: string; chips?: string[]; blueprint?: Blueprint; model?: string; mana?: number; message?: string
        }
        if (!res.ok || !j.reply) {
          setError(j.message ?? (res.status === 401 ? 'Save your player first to plan.' : 'Something went wrong.'))
          return
        }
        setSessionId(j.sessionId ?? null)
        setBlueprint(j.blueprint ?? null)
        if (j.blueprint) usePlannerStore.getState().setBlueprint(activeWorldId, j.blueprint)
        setTurns((t) => [
          ...t,
          { who: 'planner', text: j.reply!, chips: j.chips, meta: `${MODEL_LABEL(j.model ?? model)} · ${(j.mana ?? 0).toFixed(1)} mana` },
        ])
      } catch {
        setError('The planner is resting right now. Try again soon.')
      } finally {
        setBusy(false)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
    },
    [busy, activeWorldId, sessionId, model],
  )

  if (!activeWorldId) return null

  const active = makings.filter((m) => m.status === 'queued' || m.status === 'processing')

  if (!open) {
    return (
      <button id="planner-open" className="planner-open" type="button" onClick={() => setOpen(true)}>
        ✧ Plan <kbd>P</kbd>
        {active.length > 0 && <span className="planner-open-badge">{active.length} manifesting</span>}
      </button>
    )
  }

  const lastChips = turns.length && turns[turns.length - 1].who === 'planner' ? turns[turns.length - 1].chips ?? [] : []

  return (
    <aside className="planner" aria-label="World planner">
      <header className="planner-head">
        <h2 className="planner-title">{blueprint?.name ?? 'Dream a world'}</h2>
        <select id="planner-model" className="planner-model" value={model} onChange={(e) => setModel(e.target.value)} title="Planner model">
          {models.map((m) => (
            <option key={m} value={m}>{MODEL_LABEL(m)}</option>
          ))}
        </select>
        {blueprint && (
          <button
            id="planner-ghost"
            className={`planner-ghost${ghostVisible ? ' is-on' : ''}`}
            type="button"
            onClick={() => usePlannerStore.getState().setVisible(!ghostVisible)}
            title={ghostVisible ? 'Hide the preview' : 'Show the preview'}
          >
            ◇
          </button>
        )}
        <button id="planner-close" className="planner-close" type="button" onClick={() => setOpen(false)} aria-label="Close planner">×</button>
      </header>

      <div className="planner-log" ref={logRef} aria-live="polite">
        {!turns.length && <p className="planner-empty">What are you dreaming of?</p>}
        {turns.map((t, i) => (
          <div key={i} className={`planner-turn planner-turn--${t.who}`}>
            <p>{t.text}</p>
            {t.meta && <span className="planner-meta">{t.meta}</span>}
          </div>
        ))}
        {busy && <div className="planner-turn planner-turn--planner planner-thinking"><span /><span /><span /></div>}
      </div>

      {lastChips.length > 0 && !busy && (
        <div className="planner-chips">
          {lastChips.map((c) => (
            <button key={c} type="button" className="planner-chip" onClick={() => send(c)}>{c}</button>
          ))}
          <button type="button" className="planner-chip planner-chip--open" onClick={() => inputRef.current?.focus()}>something else…</button>
        </div>
      )}

      {blueprint && (
        <details className="planner-card">
          <summary>
            Blueprint v{blueprint.version} · {blueprint.assets.length} items · ≈{blueprint.estimate.total} mana
          </summary>
          <p className="planner-art">{blueprint.style.artDirection}</p>
          <div className="planner-palette">
            {blueprint.style.palette.map((c) => <span key={c} style={{ background: c }} title={c} />)}
          </div>
          <ul className="planner-assets">
            {blueprint.assets.map((a) => (
              <li key={a.key}>
                <strong>{a.key}</strong> <em>{a.kind}{a.quality === 'full' ? ' · full' : ''}</em>
                <span>{a.prompt}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {makings.length > 0 && (
        <ul className="planner-makings" aria-live="polite">
          {makings.map((m) => (
            <li key={`${m.key}-${m.jobId ?? m.status}`} className={`planner-making planner-making--${m.status}`}>
              <span>{m.key.replace(/-/g, ' ')}</span>
              <span className="planner-making-state">
                {m.status === 'complete' ? 'made ✦' : m.status === 'later' ? 'later' : m.status === 'failed' ? (m.message ?? 'failed') : `${m.progress}%`}
              </span>
              {(m.status === 'queued' || m.status === 'processing') && (
                <span className="planner-making-bar" style={{ width: `${Math.max(4, m.progress)}%` }} />
              )}
            </li>
          ))}
        </ul>
      )}

      {blueprint && (
        <button id="planner-manifest" className="planner-manifest" type="button" onClick={manifest} disabled={manifesting || busy}>
          {manifesting ? 'Manifesting…' : `Manifest ✦ ≈${blueprint.estimate.items.reduce((s, i) => s + i.mana, 0)} mana`}
        </button>
      )}

      <form className="planner-form" onSubmit={(e) => { e.preventDefault(); void send(input) }}>
        <input
          id="planner-input"
          ref={inputRef}
          className="planner-input"
          value={input}
          maxLength={1000}
          placeholder={turns.length ? 'Say more…' : 'a quiet floating tea garden at dusk'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
        <button id="planner-send" className="planner-send" type="submit" disabled={busy || !input.trim()}>↑</button>
      </form>
      {error && <p className="planner-error">{error}</p>}
    </aside>
  )
}

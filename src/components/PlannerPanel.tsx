import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import type { Blueprint } from '../../shared/blueprint'

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

  // New world = new conversation
  useEffect(() => {
    setSessionId(null)
    setTurns([])
    setBlueprint(null)
    if (!activeWorldId) setOpen(false)
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

  if (!open) {
    return (
      <button id="planner-open" className="planner-open" type="button" onClick={() => setOpen(true)}>
        ✧ Plan <kbd>P</kbd>
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

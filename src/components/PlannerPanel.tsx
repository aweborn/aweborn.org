import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import { refreshMana } from '../stores/manaTrackerStore'
import type { Blueprint, BlueprintEdit } from '@aweborn/shared/blueprint'
import { DEFAULT_ASSET_SIZE } from '@aweborn/shared/blueprint'
import { usePlannerStore } from '../stores/plannerStore'
import { setVoxelTerrain, placeModel, replaceModelAsset, useWorldStore } from '../stores/worldStore'
import { usePresence } from '../hooks/usePresence'
import { placeOnTerrain } from '../stores/worldVoxels'
import type { BlueprintAsset } from '@aweborn/shared/blueprint'
import { matchesBinding } from '../stores/keybindingStore'
import { useSheet } from '../stores/sheetStore'
import { MakeTabs } from './MakeTabs'
import { ManaSeal, useCanChannel } from './ManaSeal'
import { useOwnsCurrentWorld } from '../lib/worldActor'
import { audio } from '../audio/engine'
import { progress, refreshProgress } from '../stores/progressStore'

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

interface Version { version: number; kind: string; label: string; at: number; items: number }

const ago = (at: number) => {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export function PlannerPanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const [open, setOpen] = useSheet('plan')
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
  const worldObjects = useWorldStore((s) => s.objects)
  const worldTerrain = useWorldStore((s) => s.voxelTerrain)
  const worldSky = useWorldStore((s) => s.sky)
  const placedKeys = new Set([...worldObjects.values()].map((o) => o.planKey))
  const { playerId } = usePresence()
  const { canChannel } = useCanChannel()
  const [makings, setMakings] = useState<Making[]>([])
  const [manifesting, setManifesting] = useState(false)
  const [redoKey, setRedoKey] = useState<string | null>(null)
  const [redoNote, setRedoNote] = useState('')

  const redo = useCallback(async (key: string, note: string) => {
    if (!sessionId || !activeWorldId) return
    setError(null)
    try {
      const res = await fetch(`${AUTH_URL}/api/player/plan/redo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, key, note: note.trim() || undefined }),
      })
      const j = (await res.json().catch(() => ({}))) as { jobId?: string; blueprint?: Blueprint; message?: string }
      void refreshMana()
      if (!res.ok || !j.jobId || !j.blueprint) {
        setError(j.message ?? "The remake didn't start. Nothing was drawn.")
        return
      }
      const bp = j.blueprint
      setBlueprint(bp)
      usePlannerStore.getState().setBlueprint(activeWorldId, bp)
      const asset = bp.assets.find((a) => a.key === key)!
      setMakings((prev) => [
        ...prev.filter((m) => m.key !== key),
        { key, jobId: j.jobId, status: 'queued', progress: 0, asset, blueprintId: bp.id, terrain: bp.terrain },
      ])
      setRedoKey(null)
      setRedoNote('')
    } catch {
      setError('Creation is resting right now. Try again soon.')
    }
  }, [sessionId, activeWorldId])

  // ── Direct edits + history (M5c): free, no planner call ──
  const [wordKey, setWordKey] = useState<string | null>(null)
  const [wordText, setWordText] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [undoTo, setUndoTo] = useState<number | null>(null)
  const [versions, setVersions] = useState<Version[] | null>(null)
  const historyRef = useRef<HTMLDetailsElement>(null)

  const adopt = useCallback((bp: Blueprint) => {
    setBlueprint(bp)
    if (activeWorldId) usePlannerStore.getState().setBlueprint(activeWorldId, bp)
    if (historyRef.current?.open) setVersions(null) // reloads below
  }, [activeWorldId])

  const loadVersions = useCallback(async () => {
    if (!sessionId) return
    try {
      const r = await fetch(`${AUTH_URL}/api/player/plan/versions?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'include' })
      if (r.ok) setVersions(((await r.json()) as { versions: Version[] }).versions)
    } catch { /* the list stays as it was */ }
  }, [sessionId])

  useEffect(() => {
    if (versions === null && historyRef.current?.open) void loadVersions()
  }, [versions, loadVersions])

  const post = useCallback(async (path: 'edit' | 'restore', body: object): Promise<boolean> => {
    if (!sessionId || editing) return false
    setEditing(true)
    setError(null)
    try {
      const res = await fetch(`${AUTH_URL}/api/player/plan/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...body }),
      })
      const j = (await res.json().catch(() => ({}))) as { blueprint?: Blueprint; message?: string; warnings?: string[] }
      if (path === 'edit') void refreshMana() // new words cost a safety check
      if (j.blueprint) adopt(j.blueprint)
      if (!res.ok) {
        setError(j.message ?? "That change didn't stick.")
        return false
      }
      if (j.warnings?.length) setError(j.warnings[0])
      return true
    } catch {
      setError('The planner is resting right now. Try again soon.')
      return false
    } finally {
      setEditing(false)
    }
  }, [sessionId, editing, adopt])

  const edit = useCallback(async (e: BlueprintEdit): Promise<boolean> => {
    if (!blueprint) return false
    const base = blueprint.version
    const ok = await post('edit', { base, edit: e })
    if (ok) setUndoTo(base)
    return ok
  }, [blueprint, post])

  const restore = useCallback(async (version: number) => {
    if (await post('restore', { version })) setUndoTo(null)
  }, [post])

  // Bumped after every poll round (even failed ones) so the loop always re-arms
  const [pollTick, setPollTick] = useState(0)

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
          if (j.status === 'complete' || j.status === 'failed') void refreshMana()
          if (j.status === 'complete' && j.asset) {
            const doc = useUniverseStore.getState().activeWorldDoc
            const at = m.asset.at ?? [m.terrain.size[0] / 2, 0, m.terrain.size[2] / 2]
            const p = placeOnTerrain(m.terrain, at)
            const scale = Math.max(...(m.asset.size ?? [1.5, 1.5, 1.5]))
            const planKey = `${m.blueprintId}:${m.key}`
            const existing = [...useWorldStore.getState().objects.values()].find((o) => o.planKey === planKey)
            if (doc && existing) {
              // Redo: swap the file, keep where it stands and how it's turned
              replaceModelAsset(doc, existing.id, j.asset, m.asset.prompt)
            } else if (doc) {
              placeModel(doc, j.asset, m.asset.prompt, { x: p.x, y: p.y + scale / 2, z: p.z }, playerId, {
                scale, rotY: m.asset.rotationY, planKey,
              })
            }
            audio.creationDone()
            void refreshProgress()
          }
          setMakings((all) => all.map((x) => (x.jobId === m.jobId ? { ...x, status: j.status, progress: j.progress, message: j.error } : x)))
        } catch {
          /* keep polling */
        }
      }
      setPollTick((n) => n + 1)
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [makings, playerId, pollTick])

  // Entering a world resumes your last plan there (everything is saved server-side)
  useEffect(() => {
    setSessionId(null)
    setTurns([])
    setBlueprint(null)
    setMakings([])
    setUndoTo(null)
    setVersions(null)
    usePlannerStore.getState().clear()
    if (!activeWorldId) {
      setOpen(false)
      return
    }
    let cancelled = false
    fetch(`${AUTH_URL}/api/player/plan?worldId=${encodeURIComponent(activeWorldId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { session: { sessionId: string; blueprint: Blueprint | null; turns: Turn[]; jobs?: { key: string; jobId: string }[] } | null } | null) => {
        if (cancelled || !j?.session) return
        setSessionId(j.session.sessionId)
        setTurns(j.session.turns)
        setBlueprint(j.session.blueprint)
        const bp = j.session.blueprint
        if (bp) usePlannerStore.getState().setBlueprint(activeWorldId, bp)
        // Resume manifest jobs whose model isn't placed yet (the poller skips finished/failed ones)
        if (bp && j.session.jobs?.length) {
          const placed = new Set([...useWorldStore.getState().objects.values()].map((o) => o.planKey))
          const byKey = new Map(bp.assets.map((a) => [a.key, a]))
          const latest = new Map(j.session.jobs.map((x) => [x.key, x.jobId]))
          setMakings(
            [...latest].filter(([key]) => byKey.has(key) && !placed.has(`${bp.id}:${key}`)).map(([key, jobId]): Making => ({
              key, jobId, status: 'queued', progress: 0, asset: byKey.get(key)!, blueprintId: bp.id, terrain: bp.terrain,
            })),
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeWorldId, setOpen])

  useEffect(() => {
    if (!activeWorldId) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (matchesBinding(e, 'plannerPanel')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorldId, setOpen])

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

  // Terrain is its own step: instant, no server call (the planner turn already paid for it). Everyone in the world sees it.
  // Only the world's creator / co-creators may reshape it (the server reverts anyone else).
  const ownsWorld = useOwnsCurrentWorld()
  const shapeTerrain = useCallback(() => {
    if (!blueprint || !ownsWorld) return
    const doc = useUniverseStore.getState().activeWorldDoc
    if (doc) {
      setVoxelTerrain(doc, blueprint.terrain, blueprint.sky ?? null)
      audio.creationDone()
      progress.use('terrain')
    }
  }, [blueprint, ownsWorld])

  // The button is only live while the previewed blueprint differs from what the world already has
  const terrainShaped = !!blueprint && !!worldTerrain &&
    JSON.stringify(worldTerrain) === JSON.stringify(blueprint.terrain) &&
    JSON.stringify(worldSky ?? null) === JSON.stringify(blueprint.sky ?? null)

  // Models are made separately: all of them, or just the given keys (one by one)
  const manifest = useCallback(async (keys?: string[]) => {
    if (!blueprint || !sessionId || manifesting || !activeWorldId) return
    setManifesting(true)
    setError(null)
    try {
      const modelKeys = keys ?? blueprint.assets.filter((a) => a.kind === 'model' || a.kind === 'terrain-piece').map((a) => a.key)
      const res = await fetch(`${AUTH_URL}/api/player/plan/manifest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, keys: modelKeys }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        terrain?: Blueprint['terrain']; items?: { key: string; jobId?: string; error?: string; message?: string }[]; message?: string
      }
      void refreshMana()
      if (!res.ok || !j.terrain || !j.items) {
        setError(j.message ?? 'The manifest didn\'t start. Nothing was drawn.')
        return
      }
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
      if (j.items.some((it) => it.jobId)) audio.creationStart()
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
        void refreshMana()
        if (!res.ok || !j.reply) {
          setError(j.message ?? (res.status === 401 ? 'Save your player first to plan.' : 'Something went wrong.'))
          return
        }
        setSessionId(j.sessionId ?? null)
        setBlueprint(j.blueprint ?? null)
        setUndoTo(null)
        setVersions(null)
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
      <button id="planner-open" className={`planner-open${canChannel ? '' : ' is-sealed'}`} type="button" onClick={() => setOpen(true)}>
        ✧ Plan <kbd>P</kbd>
        {active.length > 0 && <span className="planner-open-badge">{active.length} manifesting</span>}
      </button>
    )
  }

  if (!canChannel) return <ManaSeal kind="plan" onClose={() => setOpen(false)} />

  const lastChips = turns.length && turns[turns.length - 1].who === 'planner' ? turns[turns.length - 1].chips ?? [] : []

  return (
    <aside className="planner" aria-label="World planner">
      <MakeTabs current="plan" />
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
          <div className="planner-card-bar">
            {renaming === null ? (
              <button type="button" className="planner-tool planner-tool--text" disabled={editing} onClick={() => setRenaming(blueprint.name)}>
                ✎ Rename
              </button>
            ) : (
              <form className="planner-redo-form planner-rename" onSubmit={(e) => { e.preventDefault(); void edit({ op: 'rename', name: renaming }).then((ok) => { if (ok) setRenaming(null) }) }}>
                <label htmlFor="planner-rename" className="visually-hidden">World plan name</label>
                <input
                  id="planner-rename"
                  autoFocus
                  className="planner-redo-input"
                  value={renaming}
                  maxLength={60}
                  required
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null) } }}
                />
                <button type="submit" className="planner-redo-go" disabled={editing || !renaming.trim()}>Save</button>
              </form>
            )}
            {undoTo !== null && renaming === null && (
              <button id="planner-undo" type="button" className="planner-tool planner-tool--text" disabled={editing} onClick={() => void restore(undoTo)}>
                ↶ Undo
              </button>
            )}
          </div>
          <p className="planner-art">{blueprint.style.artDirection}</p>
          <div className="planner-palette">
            {blueprint.style.palette.map((c) => <span key={c} style={{ background: c }} title={c} />)}
          </div>
          <ul className="planner-assets">
            {blueprint.assets.map((a) => {
              const isModel = a.kind === 'model' || a.kind === 'terrain-piece'
              const placed = placedKeys.has(`${blueprint.id}:${a.key}`)
              const size = Math.max(...(a.size ?? DEFAULT_ASSET_SIZE))
              const name = a.key.replace(/-/g, ' ')
              return (
                <li key={a.key}>
                  <div className="planner-asset-head">
                    <strong>{a.key}</strong> <em>{a.kind}{a.quality === 'full' ? ' · full' : ''}{isModel ? ` · ${size.toFixed(1)} m` : ''}{placed ? ' · placed' : ''}</em>
                  </div>
                  <span>{a.prompt}</span>
                  <div className="planner-asset-tools" role="group" aria-label={`Change ${name}`}>
                    {isModel && !placed && (
                      <button type="button" className="planner-tool" title="Make just this one" aria-label={`Make ${name}`} disabled={manifesting || busy} onClick={() => void manifest([a.key])}>✦</button>
                    )}
                    {isModel && (
                      <button type="button" className="planner-tool" title="Make this one again" aria-label={`Remake ${name}`} onClick={() => { setRedoKey(redoKey === a.key ? null : a.key); setRedoNote(''); setWordKey(null) }}>↻</button>
                    )}
                    {isModel && !placed && (
                      <>
                        <button type="button" className="planner-tool" title="Smaller" aria-label={`Make ${name} smaller`} disabled={editing || size <= 0.1} onClick={() => void edit({ op: 'size', key: a.key, factor: 0.8 })}>−</button>
                        <button type="button" className="planner-tool" title="Bigger" aria-label={`Make ${name} bigger`} disabled={editing || size >= 20} onClick={() => void edit({ op: 'size', key: a.key, factor: 1.25 })}>+</button>
                      </>
                    )}
                    <button type="button" className="planner-tool" title="Reword" aria-label={`Reword ${name}`} disabled={editing} onClick={() => { setWordKey(wordKey === a.key ? null : a.key); setWordText(a.prompt); setRedoKey(null) }}>✎</button>
                    <button type="button" className="planner-tool planner-tool--remove" title={placed ? 'Remove from the plan (what’s placed stays)' : 'Remove from the plan'} aria-label={`Remove ${name} from the plan`} disabled={editing} onClick={() => void edit({ op: 'remove', key: a.key })}>✕</button>
                  </div>
                  {wordKey === a.key && (
                    <form className="planner-redo-form planner-word-form" onSubmit={(e) => { e.preventDefault(); void edit({ op: 'prompt', key: a.key, prompt: wordText }).then((ok) => { if (ok) setWordKey(null) }) }}>
                      <label htmlFor={`planner-word-${a.key}`} className="visually-hidden">Words for {name}</label>
                      <textarea
                        id={`planner-word-${a.key}`}
                        autoFocus
                        className="planner-redo-input"
                        rows={3}
                        value={wordText}
                        maxLength={400}
                        required
                        onChange={(e) => setWordText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setWordKey(null) } }}
                      />
                      <button type="submit" className="planner-redo-go" disabled={editing || !wordText.trim() || wordText.trim() === a.prompt}>Save words</button>
                    </form>
                  )}
                  {redoKey === a.key && (
                    <form className="planner-redo-form" onSubmit={(e) => { e.preventDefault(); void redo(a.key, redoNote) }}>
                      <input
                        autoFocus
                        className="planner-redo-input"
                        value={redoNote}
                        maxLength={200}
                        placeholder="What should change? (optional)"
                        aria-label={`What should change about ${name}`}
                        onChange={(e) => setRedoNote(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRedoKey(null) } }}
                      />
                      <button type="submit" className="planner-redo-go">Remake ✦ 60</button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
          <details
            className="planner-history"
            ref={historyRef}
            onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void loadVersions() }}
          >
            <summary id="planner-history">History</summary>
            {versions === null ? (
              <p className="planner-history-empty">Loading…</p>
            ) : (
              <ol className="planner-history-list">
                {versions.map((v) => (
                  <li key={`${v.version}-${v.at}`} className={v.version === blueprint.version ? 'is-current' : undefined}>
                    <span className="planner-history-v">v{v.version}</span>
                    <span className="planner-history-label">{v.label}</span>
                    <span className="planner-history-at">{ago(v.at)} · {v.items} items</span>
                    {v.version === blueprint.version ? (
                      <span className="planner-history-now">now</span>
                    ) : (
                      <button type="button" className="planner-tool planner-tool--text" disabled={editing} aria-label={`Restore version ${v.version}`} onClick={() => void restore(v.version)}>Restore</button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </details>
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
        <div className="planner-actions">
          <button
            id="planner-terrain"
            className="planner-manifest"
            type="button"
            onClick={shapeTerrain}
            disabled={busy || terrainShaped || !ownsWorld}
            title={ownsWorld ? undefined : 'Only this world’s creator (or a co-creator) can shape its terrain'}
          >
            {!ownsWorld ? 'Terrain: creator only' : terrainShaped ? 'Terrain shaped ✓' : worldTerrain ? 'Reshape terrain' : 'Shape terrain'}
          </button>
          <button id="planner-manifest" className="planner-manifest" type="button" onClick={() => void manifest()} disabled={manifesting || busy}>
            {manifesting ? 'Manifesting…' : `Make models ✦ ≈${blueprint.estimate.items.reduce((s, i) => s + i.mana, 0)} mana`}
          </button>
        </div>
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

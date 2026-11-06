import { useEffect, useRef, useState } from 'react'
import type { LibraryMind, MindHistory, MindVersion } from '@aweborn/shared/mind-library'
import { libraryThumb } from '../lib/libraryThumbs'
import { fetchMindShelf, removeSavedMind } from '../lib/minds'
import { AUTH_URL } from '../lib/player'
import './MindPanels.css'

/**
 * Minds you keep (2026-11-06): the Library's Minds shelf, the picker that gives a creation a
 * saved mind, and a mind's history (every version, the words as typed and exactly how they
 * were written to the mind). See shared/mind-library.ts for how versions branch.
 */

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const modelName = (m: string | null) => (m ? m.split('/').pop() ?? m : '')

/** The saved body's picture (drawn on this device once, like Library models). */
function MindThumb({ m }: { m: LibraryMind }) {
  const file = m.body.stillAsset ?? m.body.asset
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!/^[a-f0-9]{64}\.glb$/.test(file)) return
    let live = true
    void libraryThumb(file.slice(0, 64), file).then((u) => live && setSrc(u))
    return () => {
      live = false
    }
  }, [file])
  if (src) return <img className="library-thumb" src={src} alt="" loading="lazy" width={64} height={64} />
  return (
    <span className="library-thumb library-thumb--none is-loading mind-thumb" aria-hidden="true">
      ✦
    </span>
  )
}

/** Search + list of saved minds. `action` is the button on each row (Hold on the shelf, Give in the Life sheet). */
export function MindList({
  action,
  busyId,
  heldId,
  empty,
}: {
  action: { label: (m: LibraryMind) => string; run: (m: LibraryMind) => void }
  busyId?: string | null
  heldId?: string | null
  empty: string
}) {
  const [q, setQ] = useState('')
  const [minds, setMinds] = useState<LibraryMind[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const list = await fetchMindShelf(q, ctrl.signal)
        setMinds(list)
        setError(null)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError('The Minds shelf is resting right now. Try again soon.')
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, q ? 250 : 0)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, rev])

  const remove = async (m: LibraryMind) => {
    setConfirming(null)
    const r = await removeSavedMind(m.id)
    if (r.ok) setRev((n) => n + 1)
    else setError(r.message)
  }

  return (
    <div className="library-made mind-list">
      <form className="planner-form" onSubmit={(e) => e.preventDefault()}>
        <input
          className="planner-input"
          placeholder="Search saved minds…"
          aria-label="Search saved minds"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </form>
      {error && <p className="planner-error">{error}</p>}
      <ul className="library-list">
        {minds.map((m) => (
          <li key={m.id} className="library-item mind-item">
            <MindThumb m={m} />
            <p className="library-prompt">
              <b>{m.name}</b>
              {m.epithet ? `, ${m.epithet}` : ''}
              {m.greeting && <span className="mind-item-greeting"> “{m.greeting}”</span>}
            </p>
            <span className="library-meta">
              saved by {m.savedBy} · {m.versions} {m.versions === 1 ? 'version' : 'versions'} · {day(m.savedAt)}
            </span>
            <button type="button" className="planner-chip library-place" disabled={busyId === m.id} onClick={() => action.run(m)}>
              {busyId === m.id ? '…' : heldId === m.id ? 'In hand ✓' : action.label(m)}
            </button>
            {m.mine &&
              (confirming === m.id ? (
                <button type="button" className="planner-chip library-remove" onClick={() => void remove(m)} onBlur={() => setConfirming(null)} autoFocus>
                  Take off the shelf?
                </button>
              ) : (
                <button type="button" className="planner-chip library-remove" aria-label={`Take ${m.name} off the shelf`} title="Take off the shelf" onClick={() => setConfirming(m.id)}>
                  ✕
                </button>
              ))}
            <button type="button" className="mind-item-more" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
              {open === m.id ? 'Hide how it was written' : 'How it was written'}
            </button>
            {open === m.id && <PublicHistory id={m.id} />}
          </li>
        ))}
        {!loading && !minds.length && !error && <li className="planner-empty">{empty}</li>}
      </ul>
    </div>
  )
}

/** A saved mind's history, from the public shelf. */
function PublicHistory({ id }: { id: string }) {
  const [h, setH] = useState<MindHistory | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(`${AUTH_URL}/minds/${id}`)
        const j = (await res.json()) as { history?: MindHistory }
        if (live) {
          if (res.ok && j.history) setH(j.history)
          else setFailed(true)
        }
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [id])
  if (failed) return <p className="life-note mind-history-wide">Its history couldn’t be read right now.</p>
  if (!h) return <p className="life-note mind-history-wide">Reading…</p>
  return <MindHistoryView history={h} className="mind-history-wide" />
}

/** One version: who, when, the words as typed; open it for exactly what the mind was told and what it became. */
function VersionItem({ v, n, systems }: { v: MindVersion; n: number; systems: Record<string, string> }) {
  const p = v.persona
  return (
    <li className="mind-version">
      <p className="mind-version-head">
        <b>v{n}</b> · {v.by} · {day(v.at)}
        {!v.here && v.world ? ` · in ${v.world}` : !v.here ? ' · on another creation' : ''}
      </p>
      <blockquote className="mind-version-words">{v.prompt}</blockquote>
      <details className="mind-version-detail">
        <summary>How it was written to the mind</summary>
        {v.request ? (
          <>
            <p className="mind-label">Sent to the mind-writer{v.model ? ` (${modelName(v.model)})` : ''}:</p>
            <pre className="mind-pre">{v.request}</pre>
            {v.system && systems[v.system] && (
              <details className="mind-version-detail">
                <summary>Its standing instructions</summary>
                <pre className="mind-pre">{systems[v.system]}</pre>
              </details>
            )}
          </>
        ) : (
          <p className="life-note">Written before minds kept the exact request; its words and what it became are kept.</p>
        )}
        <p className="mind-label">What it became:</p>
        <dl className="mind-persona">
          <dt>Name</dt>
          <dd>{p.name}{p.epithet ? `, ${p.epithet}` : ''}</dd>
          <dt>Who</dt>
          <dd>{p.description}</dd>
          {p.personality.length > 0 && (<><dt>Personality</dt><dd>{p.personality.join(', ')}</dd></>)}
          {p.speech && (<><dt>Speaks</dt><dd>{p.speech} ({p.verbosity})</dd></>)}
          {p.goals.length > 0 && (<><dt>Goals</dt><dd>{p.goals.join('; ')}</dd></>)}
          {p.knowledge.length > 0 && (<><dt>Knows</dt><dd>{p.knowledge.join(' ')}</dd></>)}
          {p.boundaries.length > 0 && (<><dt>Limits</dt><dd>{p.boundaries.join('; ')}</dd></>)}
          {p.greeting && (<><dt>Greeting</dt><dd>“{p.greeting}”</dd></>)}
          <dt>Voice</dt>
          <dd>{p.voice} · {p.size}{p.spoken ? '' : ' · silent'}</dd>
        </dl>
      </details>
    </li>
  )
}

/** Every version, newest first. */
export function MindHistoryView({ history, className = '' }: { history: MindHistory; className?: string }) {
  const n = history.versions.length
  if (!n) return null
  return (
    <div className={`mind-history ${className}`}>
      {history.origin && (
        <p className="life-note mind-origin">
          Came from the Library: <b>{history.origin.name}</b>, saved by {history.origin.savedBy}. What it learns here grows its own branch; the saved one stays as it was.
        </p>
      )}
      <ol className="mind-versions" reversed>
        {history.versions.map((v, i) => (
          <VersionItem key={v.id} v={v} n={n - i} systems={history.systems} />
        ))}
      </ol>
    </div>
  )
}

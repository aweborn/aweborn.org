import { useCallback, useEffect, useRef } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { inputManager } from '../systems/InputManager'
import { useMakingOf, loadMakingOf, closeMakingOf } from '../stores/makingOfStore'
import type { MakingOfEntry, MakingOfSession } from '@aweborn/shared/making-of'
import './MakingOfPanel.css'

/**
 * How this world was made (Alex, 2026-11-02): the full back-and-forth with the planner that
 * shaped the world, oldest first, for everyone who visits. Opened from the story stone
 * (MakingOfStone). Read-only: what was written here stays as it was.
 * Phone: a bottom sheet. Desktop: a panel on the right, the world still in view.
 */

const REFRESH_MS = 15_000

const when = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export function MakingOfPanel() {
  const open = useMakingOf((s) => s.open)
  const worldId = useUniverseStore((s) => s.activeWorldId)
  // Leaving the world closes it
  useEffect(() => {
    if (!worldId) closeMakingOf()
  }, [worldId])
  if (!open || !worldId) return null
  return <MakingOfDialog worldId={worldId} />
}

function MakingOfDialog({ worldId }: { worldId: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const wasEnabled = useRef(true)
  const data = useMakingOf((s) => (s.worldId === worldId ? s.data : null))
  const worldName = useWorldStore((s) => s.meta?.name) ?? 'this world'

  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    wasEnabled.current = inputManager.isEnabled()
    d.showModal()
    inputManager.setEnabled(false)
  }, [])
  const onClosed = useCallback(() => {
    if (wasEnabled.current) inputManager.setEnabled(true)
    closeMakingOf()
  }, [])
  // The makers may still be talking it into shape: keep it current while it's open
  useEffect(() => {
    void loadMakingOf(worldId)
    const t = setInterval(() => void loadMakingOf(worldId), REFRESH_MS)
    return () => clearInterval(t)
  }, [worldId])

  const sessions = data?.sessions ?? []
  const authors = [...new Set(sessions.map((s) => s.by))]

  return (
    <dialog ref={ref} id="making-of-panel" className="making-of" aria-labelledby="making-of-title" onClose={onClosed}>
      <header className="making-of-head">
        <span className="making-of-glyph" aria-hidden="true">📜</span>
        <div className="making-of-head-text">
          <h2 id="making-of-title" className="making-of-title">How {worldName} was made</h2>
          <p className="making-of-sub">
            {sessions.length ? `${authors.join(', ')} with the world planner` : 'Reading the stone…'}
          </p>
        </div>
        <button type="button" className="making-of-close" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
      </header>
      <div className="making-of-log" role="log" aria-live="polite">
        {sessions.map((s, i) => (
          <Conversation key={s.id} s={s} n={i + 1} total={sessions.length} />
        ))}
        {data && !sessions.length && <p className="making-of-empty">No one has planned this world yet.</p>}
      </div>
    </dialog>
  )
}

/** Runs of this many hand edits in a row fold into one line you can open, so the words stay readable. */
const FOLD_AT = 4

type Block = { kind: 'line'; e: MakingOfEntry } | { kind: 'notes'; notes: MakingOfEntry[] }

function blocks(entries: MakingOfEntry[]): Block[] {
  const out: Block[] = []
  let run: MakingOfEntry[] = []
  const flush = () => {
    if (run.length >= FOLD_AT) out.push({ kind: 'notes', notes: run })
    else for (const e of run) out.push({ kind: 'line', e })
    run = []
  }
  for (const e of entries) {
    if (e.kind === 'note') run.push(e)
    else {
      flush()
      out.push({ kind: 'line', e })
    }
  }
  flush()
  return out
}

function Conversation({ s, n, total }: { s: MakingOfSession; n: number; total: number }) {
  return (
    <section className="making-of-session" aria-label={`Conversation ${n} of ${total}`}>
      <h3 className="making-of-session-head">
        <span>{s.plan ?? `Conversation ${n}`}</span>
        <span className="making-of-session-meta">{s.by} · {when(s.startedAt)}</span>
      </h3>
      {blocks(s.entries).map((b, i) =>
        b.kind === 'line' ? (
          <Line key={i} e={b.e} by={s.by} />
        ) : (
          <details key={i} className="making-of-fold">
            <summary>{s.by} made {b.notes.length} changes by hand</summary>
            {b.notes.map((e, j) => <Line key={j} e={e} by={s.by} />)}
          </details>
        ),
      )}
    </section>
  )
}

function Line({ e, by }: { e: MakingOfEntry; by: string }) {
  if (e.kind === 'note') return <p className="making-of-note">{by} {e.text}</p>
  if (e.kind === 'player') {
    return (
      <div className="making-of-turn making-of-turn--player">
        <span className="making-of-who">{by}</span>
        <p className="making-of-bubble">{e.text}</p>
      </div>
    )
  }
  return (
    <div className="making-of-turn making-of-turn--planner">
      <span className="making-of-who">Planner{e.model ? ` · ${e.model}` : ''}</span>
      <p className="making-of-bubble">{e.text}</p>
      {e.chips.length > 0 && (
        <ul className="making-of-chips" aria-label="Suggestions it offered">
          {e.chips.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
    </div>
  )
}

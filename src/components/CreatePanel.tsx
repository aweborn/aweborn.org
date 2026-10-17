import { useCallback, useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { placeModel } from '../stores/worldStore'
import { interiorController } from '../systems/InteriorController'
import { AUTH_URL } from '../lib/player'
import { usePresence } from '../hooks/usePresence'

/**
 * Create panel (Phase 07, first gen-AI slice): inside a world, type what you
 * want and it's made (Meshy text-to-3D) and placed in front of you.
 * Press C or tap ✦ Create. Mana is reserved at admission and settled on
 * completion by sync-service; a failed making draws nothing.
 */

interface Making {
  jobId: string
  prompt: string
  progress: number
  status: 'queued' | 'processing' | 'complete' | 'failed'
  message?: string
}

const POLL_MS = 2000

export function CreatePanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const { playerId } = usePresence()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [makings, setMakings] = useState<Making[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // C toggles the panel inside a world (not while typing)
  useEffect(() => {
    if (!activeWorldId) {
      setOpen(false)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'KeyC') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorldId])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Poll open makings; place each one when it completes
  useEffect(() => {
    const pending = makings.filter((m) => m.status === 'queued' || m.status === 'processing')
    if (!pending.length) return
    const t = setTimeout(async () => {
      for (const m of pending) {
        try {
          const res = await fetch(`${AUTH_URL}/api/player/create/${m.jobId}`, { credentials: 'include' })
          if (!res.ok) continue
          const j = (await res.json()) as { status: Making['status']; progress: number; asset?: string; error?: string }
          if (j.status === 'complete' && j.asset) {
            const doc = useUniverseStore.getState().activeWorldDoc
            const s = interiorController.state
            if (doc) placeModel(doc, j.asset, m.prompt, { x: s.x + s.fx * 2.5, y: 0.5, z: s.z + s.fz * 2.5 }, playerId)
          }
          setMakings((all) => all.map((x) => (x.jobId === m.jobId ? { ...x, status: j.status, progress: j.progress, message: j.error } : x)))
        } catch {
          /* keep polling */
        }
      }
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [makings, playerId])

  // Drop finished makings from the list after a moment
  useEffect(() => {
    if (!makings.some((m) => m.status === 'complete' || m.status === 'failed')) return
    const t = setTimeout(() => setMakings((all) => all.filter((m) => m.status !== 'complete')), 4000)
    return () => clearTimeout(t)
  }, [makings])

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const text = prompt.trim()
      if (!text || busy) return
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`${AUTH_URL}/api/player/create`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text }),
        })
        const j = (await res.json().catch(() => ({}))) as { jobId?: string; message?: string; error?: string }
        if (!res.ok || !j.jobId) {
          setError(j.message ?? (res.status === 401 ? 'Save your player first to make things.' : 'Something went wrong.'))
          return
        }
        setMakings((all) => [...all, { jobId: j.jobId!, prompt: text, progress: 0, status: 'queued' }])
        setPrompt('')
        setOpen(false)
      } catch {
        setError('Creation is resting right now. Try again soon.')
      } finally {
        setBusy(false)
      }
    },
    [prompt, busy],
  )

  if (!activeWorldId) return null

  return (
    <div className="create-panel">
      {makings.length > 0 && (
        <ul className="create-makings" aria-live="polite">
          {makings.map((m) => (
            <li key={m.jobId} className={`create-making create-making--${m.status}`}>
              <span className="create-making-prompt">{m.prompt}</span>
              <span className="create-making-state">
                {m.status === 'failed' ? m.message ?? 'failed' : m.status === 'complete' ? 'made ✦' : `${m.progress}%`}
              </span>
              {m.status !== 'failed' && m.status !== 'complete' && (
                <span className="create-making-bar" style={{ width: `${Math.max(4, m.progress)}%` }} />
              )}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <form className="create-form" onSubmit={submit}>
          <input
            id="create-prompt"
            ref={inputRef}
            className="create-input"
            value={prompt}
            maxLength={600}
            placeholder="What do you want to make? (a mossy stone lantern…)"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
          />
          <button id="create-submit" className="create-submit" type="submit" disabled={busy || !prompt.trim()}>
            {busy ? '…' : 'Make'}
          </button>
          {error && <p className="create-error">{error}</p>}
        </form>
      ) : (
        <button id="create-open" className="create-open" type="button" onClick={() => setOpen(true)}>
          ✦ Create <kbd>C</kbd>
        </button>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { cleanPlayerName, NAME_MAX, wandererTag } from '@aweborn/shared/names'
import { AUTH_URL } from '../lib/player'
import { useNameStore, requestNames } from '../stores/nameStore'

/**
 * "What should we call you?": names the character you're playing (Rough
 * Draft M1, 2026-10-27). Shown to everyone in chat and over your head.
 * Validated as you type with the same rules the server enforces.
 */
export function NameField({ playerId }: { playerId: string }) {
  const current = useNameStore((s) => s.names[playerId])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (current === undefined) requestNames([playerId])
  }, [current, playerId])

  const start = () => {
    setDraft(current ?? '')
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const r = cleanPlayerName(draft)
    if (!r.ok) return setError(r.message)
    if (r.name === current) return setEditing(false)
    setBusy(true)
    setError(null)
    const res = await fetch(`${AUTH_URL}/api/player/character/name`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: r.name }),
    }).catch(() => null)
    setBusy(false)
    if (!res) return setError("Couldn't reach Aweborn. Check your connection and try again.")
    if (res.status === 401) return setError('Your session ended. Reload the page, then try again.')
    const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string }
    if (!res.ok || !body.name) return setError(body.message ?? "Couldn't save that name. Please try again.")
    useNameStore.getState().setOwn(playerId, body.name)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="pa-name">
        <span className="pa-name-label">Name</span>
        <span className={`pa-name-value${current ? '' : ' is-unset'}`}>{current ?? wandererTag(playerId)}</span>
        <button type="button" id="player-name-edit" className="pa-link" onClick={start}>
          {current ? 'Change' : 'Pick a name'}
        </button>
      </div>
    )
  }

  return (
    <form
      className="pa-name pa-name--editing"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="pa-name-label" htmlFor="player-name-input">
        Name
      </label>
      <input
        id="player-name-input"
        className="pa-input pa-name-input"
        value={draft}
        maxLength={NAME_MAX + 4}
        autoComplete="nickname"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="What should we call you?"
        aria-describedby="player-name-hint"
        aria-invalid={error ? true : undefined}
        autoFocus
        disabled={busy}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
          }
        }}
      />
      <div className="pa-name-actions">
        <button type="submit" id="player-name-save" className="pa-btn pa-btn--primary pa-btn--sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" id="player-name-cancel" className="pa-btn pa-btn--ghost pa-btn--sm" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      <p id="player-name-hint" className={`pa-hint pa-hint--left${error ? ' pa-name-error' : ''}`} role={error ? 'alert' : undefined}>
        {error ?? 'Everyone sees this in chat and over your head.'}
      </p>
    </form>
  )
}

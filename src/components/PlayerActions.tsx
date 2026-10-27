import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMuteStore } from '../stores/muteStore'
import { useNameStore, displayName } from '../stores/nameStore'
import { AUTH_URL, getPlayerSnapshot, subscribePlayer } from '../lib/player'

const REASONS: [string, string][] = [
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate'],
  ['sexual', 'Sexual content'],
  ['personal_info', 'Sharing personal info'],
  ['spam', 'Spam'],
  ['other', 'Something else'],
]

/**
 * Tap a name in chat → this sheet (Rough Draft M1, 2026-10-27): Mute (hide
 * their chat for you) or Report (a person reviews what they said here; the
 * server attaches its own copy of their recent lines). A native <dialog>, so
 * focus, Esc and the backdrop behave everywhere.
 */
export function PlayerActions() {
  const target = useMuteStore((s) => s.target)
  const muted = useMuteStore((s) => (target ? s.muted.has(target.id) : false))
  const names = useNameStore((s) => s.names)
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  const ref = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<'menu' | 'report' | 'sent'>('menu')
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (target && !d.open) {
      setStep('menu')
      setReason(null)
      setNote('')
      setError(null)
      d.showModal()
    } else if (!target && d.open) d.close()
  }, [target])

  const close = () => useMuteStore.getState().closeActions()
  const name = target ? displayName(target.id, names) : ''
  const canReport = Boolean(player && !player.isGuest)

  const send = async () => {
    if (!target || !reason) return
    setBusy(true)
    setError(null)
    const res = await fetch(`${AUTH_URL}/api/player/report`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId: target.id, place: target.place, reason, note }),
    }).catch(() => null)
    setBusy(false)
    if (!res) return setError("Couldn't reach Aweborn. Check your connection and try again.")
    if (res.status === 401) return setError('Your session ended. Reload the page, then try again.')
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    if (!res.ok) return setError(body.message ?? "Couldn't send the report. Please try again.")
    setStep('sent')
  }

  return (
    <dialog
      ref={ref}
      id="player-actions"
      className="pact"
      aria-labelledby="pact-title"
      onClose={close}
      onClick={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {target && (
        <div className="pact-panel">
          <p className="pact-eyebrow">{step === 'report' ? 'Report' : step === 'sent' ? 'Thank you' : 'Player'}</p>
          <h2 id="pact-title" className="pact-title">
            {name}
          </h2>

          {step === 'menu' && (
            <div className="pact-actions">
              <button
                id="pact-mute"
                type="button"
                className="pact-btn"
                onClick={() => {
                  useMuteStore.getState().setMuted(target.id, !muted)
                  close()
                }}
              >
                <span aria-hidden="true">{muted ? '🔊' : '🔇'}</span>
                <span className="pact-btn-text">
                  <span className="pact-btn-title">{muted ? 'Unmute' : 'Mute'}</span>
                  <span className="pact-btn-sub">{muted ? 'See their chat again' : 'Hide their chat and speech bubbles for you'}</span>
                </span>
              </button>
              {canReport && (
                <button id="pact-report" type="button" className="pact-btn pact-btn--danger" onClick={() => setStep('report')}>
                  <span aria-hidden="true">🚩</span>
                  <span className="pact-btn-text">
                    <span className="pact-btn-title">Report…</span>
                    <span className="pact-btn-sub">A person will look at what they said here</span>
                  </span>
                </button>
              )}
              <button id="pact-cancel" type="button" className="pact-quiet" onClick={close}>
                Cancel
              </button>
            </div>
          )}

          {step === 'report' && (
            <form
              className="pact-actions"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <fieldset className="pact-reasons">
                <legend className="pact-legend">What's wrong?</legend>
                {REASONS.map(([value, label]) => (
                  <label key={value} className={`pact-reason${reason === value ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name="pact-reason"
                      id={`pact-reason-${value}`}
                      value={value}
                      checked={reason === value}
                      onChange={() => setReason(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className="pact-legend" htmlFor="pact-note">
                Anything else? (optional)
              </label>
              <textarea
                id="pact-note"
                className="pact-note"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="pact-hint">We attach our own copy of what they said here in the last hour. They won't know who reported them.</p>
              {error && (
                <p className="pact-error" role="alert">
                  {error}
                </p>
              )}
              <button id="pact-send" type="submit" className="pact-cta" disabled={!reason || busy}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
              <button id="pact-back" type="button" className="pact-quiet" onClick={() => setStep('menu')}>
                Back
              </button>
            </form>
          )}

          {step === 'sent' && (
            <div className="pact-actions">
              <p className="pact-body">A person will review it. You can also mute them so you don't see their chat.</p>
              {!muted && (
                <button
                  id="pact-sent-mute"
                  type="button"
                  className="pact-cta"
                  onClick={() => {
                    useMuteStore.getState().setMuted(target.id, true)
                    close()
                  }}
                >
                  Mute {name}
                </button>
              )}
              <button id="pact-done" type="button" className="pact-quiet" onClick={close}>
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}

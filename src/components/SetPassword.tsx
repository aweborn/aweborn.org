/**
 * Aweborn — add or change a saved player's password (for people who like
 * passwords). Signs in with the player's email + this password afterwards.
 * The server asks for "confirm it's you" first and emails a notice.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { setPassword as savePassword } from '../lib/player'

export function SetPassword({ email, changing, disabled, onDone, onNeedsConfirm, onCancel }: {
  /** The player's email: the username password managers should store. */
  email: string
  /** There's a password already (this replaces it). */
  changing: boolean
  disabled?: boolean
  onDone: (message: string) => void
  onNeedsConfirm: () => void
  onCancel: () => void
}) {
  const uid = useId()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || password.length < 10) return
    setBusy(true)
    setError(null)
    try {
      const res = await savePassword(password)
      if (res.ok) onDone(changing ? 'Password changed.' : `Password added. Sign in with ${email} and your password any time.`)
      else if (res.needsConfirm) onNeedsConfirm()
      else setError(res.message)
    } catch {
      setError('Something went wrong. Your player is safe. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const off = disabled || busy
  return (
    <form className="pa-email" onSubmit={onSubmit}>
      {/* Lets password managers file the new password under the right email. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="pa-field">
        <label htmlFor={`${uid}-pw`} className="pa-label">{changing ? 'New password' : 'Choose a password'}</label>
        <div className="pa-input-wrap">
          <input
            ref={inputRef}
            id={`${uid}-pw`}
            className="pa-input"
            type={show ? 'text' : 'password'}
            name="new-password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={off}
          />
          <button
            type="button"
            className="pa-link pa-link--quiet pa-input-toggle"
            aria-pressed={show}
            onClick={() => setShow(!show)}
            disabled={off}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="pa-hint pa-hint--left">At least 10 characters. A short phrase works great.</p>
      </div>
      <button type="submit" id="player-password-save" className="pa-btn pa-btn--primary" disabled={off || password.length < 10}>
        {busy ? 'Checking…' : changing ? 'Change password' : 'Add password'}
      </button>
      <button type="button" id="player-password-cancel" className="pa-link pa-link--quiet" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {error && <p className="pa-email-status pa-status--error" role="status" aria-live="polite">{error}</p>}
    </form>
  )
}

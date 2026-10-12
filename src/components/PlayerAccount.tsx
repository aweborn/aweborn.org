/**
 * Aweborn — "Save your player" chip, gentle nudge, and account panel.
 *
 * Anonymous-first: the chip is always there but never in the way. After a
 * meaningful moment (first world, ~10 min of play) a dismissible nudge
 * suggests saving, at most once a day. Saving attaches a real sign-in method
 * to the *same* player (`playerId`), so nothing is lost.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import {
  confirmWithGoogle,
  confirmWithPasskey,
  continueWithGoogle,
  fetchAuthMethods,
  getPlayerSnapshot,
  listSignInMethods,
  removeGoogle,
  removePasskey,
  removePassword,
  saveWithPasskey,
  signInWithPasskey,
  signOutOfDevice,
  subscribePlayer,
  switchCharacter,
  takeRecheckReturn,
  colorForPlayer,
  type AuthMethods,
  type AuthResult,
  type SignInMethods,
} from '../lib/player'
import { canPromptNow, onMeaningfulMoment, recordPrompted, trackPlaytime } from '../lib/onramp'
import { EmailSignIn } from './EmailSignIn'

type Busy = null | 'passkey-save' | 'passkey-signin' | 'google' | 'signout' | 'switch' | 'confirm' | `remove-${string}`

function usePlayer() {
  return useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
}

/** Read and clear `?signin=failed|different&error=…` left by a Google round trip. */
function takeSignInError(): string | null {
  const url = new URL(window.location.href)
  const signin = url.searchParams.get('signin')
  if (signin !== 'failed' && signin !== 'different') return null
  const error = url.searchParams.get('error') ?? ''
  url.searchParams.delete('signin')
  url.searchParams.delete('error')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  if (signin === 'different' || /already_linked/i.test(error)) {
    return 'That Google account belongs to a different player. Sign out of this device first to switch.'
  }
  return "Google sign-in didn't finish. Your player is safe on this device. Try again any time."
}

const shortDate = (d: string | number) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const GoogleMark = () => (
  <svg className="pa-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.07-1.1-.16-1.6H12z" />
  </svg>
)

const PasskeyMark = () => (
  <svg className="pa-btn-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="4" />
    <path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9" />
    <circle cx="18" cy="13.5" r="2.5" />
    <path d="M18 16v5l1.5-1.2M18 19h1.5" />
  </svg>
)

export function PlayerAccount() {
  const player = usePlayer()
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const [linked, setLinked] = useState<SignInMethods | null>(null)
  const [nudge, setNudge] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [addingEmail, setAddingEmail] = useState(false)
  /** A change was refused until the player confirms it's them. */
  const [confirming, setConfirming] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const isAnonymous = player?.isAnonymous ?? false
  const canSave = Boolean(methods?.enabled && (methods.passkey || methods.google || methods.email))

  useEffect(() => {
    void fetchAuthMethods().then(setMethods)
  }, [])

  // Saved players: show which ways in are linked.
  const refreshLinked = useCallback(() => {
    if (player && !player.isAnonymous && !player.isGuest) {
      void listSignInMethods().then(setLinked).catch(() => setLinked(null))
    }
  }, [player])
  useEffect(refreshLinked, [refreshLinked])

  // Gentle nudge after a meaningful moment (anonymous players only, ≤ 1/day).
  useEffect(() => {
    if (!isAnonymous || !canSave) return
    const stopPlaytime = trackPlaytime()
    const stopMoments = onMeaningfulMoment(() => {
      if (!canPromptNow() || dialogRef.current?.open) return
      recordPrompted()
      setNudge(true)
    })
    return () => {
      stopPlaytime()
      stopMoments()
    }
  }, [isAnonymous, canSave])

  const open = useCallback(() => {
    setNudge(false)
    setStatus(null)
    setAddingEmail(false)
    setConfirming(false)
    refreshLinked()
    dialogRef.current?.showModal()
  }, [refreshLinked])

  const close = useCallback(() => dialogRef.current?.close(), [])

  // Back from a Google round trip: reopen the panel with a note.
  useEffect(() => {
    if (!methods?.enabled) return
    const err = takeSignInError()
    const confirmed = takeRecheckReturn()
    if (err) {
      dialogRef.current?.showModal()
      setStatus({ tone: 'error', text: err })
    } else if (confirmed) {
      dialogRef.current?.showModal()
      setStatus({ tone: 'success', text: 'Confirmed. You can change how you sign in for the next 5 minutes.' })
    }
  }, [methods])

  // Light dismiss fallback for browsers without <dialog closedby> (Safari).
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return
    const onClick = (e: MouseEvent) => {
      if (e.target !== dialog) return
      const r = dialog.getBoundingClientRect()
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right
      if (!inside) dialog.close()
    }
    dialog.addEventListener('click', onClick)
    return () => dialog.removeEventListener('click', onClick)
  }, [])

  const run = useCallback(async (kind: Exclude<Busy, null>, action: () => Promise<AuthResult>, success?: string) => {
    setBusy(kind)
    setStatus(null)
    try {
      const res = await action()
      if (res.ok) {
        if (success) setStatus({ tone: 'success', text: success })
        refreshLinked()
      } else if (res.needsConfirm) {
        setAddingEmail(false)
        setConfirming(true)
      } else {
        setStatus({ tone: res.cancelled ? 'info' : 'error', text: res.message })
      }
    } catch {
      setStatus({ tone: 'error', text: 'Something went wrong. Your player is safe. Please try again.' })
    } finally {
      setBusy(null)
    }
  }, [refreshLinked])

  // Guests (auth unreachable) and servers with no methods: nothing to show.
  if (!player || player.isGuest || !canSave) return null

  const passkeys = linked?.passkeys ?? []
  const hasPasskey = passkeys.length > 0
  const hasGoogle = linked?.google ?? false
  const email = linked?.email ?? null
  const characters = player.characters
  const emailDone = (message: string) => {
    setAddingEmail(false)
    setStatus({ tone: 'success', text: message })
    refreshLinked()
  }
  const confirmed = (message = 'Confirmed. Now try that again: you have 5 minutes.') => {
    setConfirming(false)
    setStatus({ tone: 'success', text: message })
    refreshLinked()
  }
  const needConfirm = () => {
    setAddingEmail(false)
    setConfirming(true)
  }

  return (
    <>
      <button
        type="button"
        id="player-account-chip"
        className={`pa-chip${isAnonymous ? '' : ' pa-chip--saved'}${nudge ? ' pa-chip--glow' : ''}`}
        onClick={open}
        aria-haspopup="dialog"
        title={isAnonymous ? 'Save your player to keep it on every device' : 'Your player'}
      >
        <span className="pa-orb" style={{ '--pa-color': player.color } as CSSProperties} aria-hidden="true" />
        <span className="pa-chip-label">{isAnonymous ? 'Save your player' : 'Saved'}</span>
      </button>

      {nudge && (
        <div className="pa-nudge" role="status">
          <p className="pa-nudge-text">
            <strong>Keep what you've made.</strong> Your player only lives on this device right now.
          </p>
          <div className="pa-nudge-actions">
            <button type="button" id="player-nudge-save" className="pa-btn pa-btn--primary pa-btn--sm" onClick={open}>
              Save my player
            </button>
            <button type="button" id="player-nudge-dismiss" className="pa-btn pa-btn--ghost pa-btn--sm" onClick={() => setNudge(false)}>
              Not now
            </button>
          </div>
        </div>
      )}

      <dialog
        ref={dialogRef}
        id="player-account-dialog"
        className="pa-dialog"
        aria-labelledby="pa-title"
        // closedby: light dismiss + Esc (React passes unknown lowercase attrs through)
        {...{ closedby: 'any' }}
      >
        <div className="pa-panel">
          <button type="button" className="pa-close" onClick={close} aria-label="Close">×</button>

          <div className="pa-hero">
            <span className="pa-orb pa-orb--lg" style={{ '--pa-color': player.color } as CSSProperties} aria-hidden="true" />
            <h2 id="pa-title" className="pa-title">{isAnonymous ? 'Save your player' : 'Your player'}</h2>
            <p className="pa-sub">
              {isAnonymous
                ? 'Keep your worlds and cards on every device. No password needed. You can keep playing either way.'
                : 'Your player is saved. Sign in on any device to pick up where you left off.'}
            </p>
          </div>

          {isAnonymous ? (
            <div className="pa-actions">
              {methods?.passkey && (
                <button
                  type="button"
                  id="player-save-passkey"
                  className="pa-btn pa-btn--primary"
                  disabled={busy !== null}
                  onClick={() => run('passkey-save', saveWithPasskey, 'Saved! Your player now has a passkey.')}
                >
                  <PasskeyMark />
                  {busy === 'passkey-save' ? 'Waiting for your device…' : 'Save with a passkey'}
                </button>
              )}
              {methods?.google && (
                <button
                  type="button"
                  id="player-google"
                  className="pa-btn pa-btn--light"
                  disabled={busy !== null}
                  onClick={() => run('google', continueWithGoogle)}
                >
                  <GoogleMark />
                  {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
                </button>
              )}
              {methods?.passkey && (
                <p className="pa-hint">Face ID, fingerprint, or your screen lock. Works with your phone too.</p>
              )}

              {methods?.email && (
                <>
                  {(methods.passkey || methods.google) && <div className="pa-divider"><span>or use your email</span></div>}
                  <EmailSignIn mode="save" disabled={busy !== null} onDone={emailDone} />
                </>
              )}

              {methods?.passkey && (
                <div className="pa-divider"><span>Already saved on another device?</span></div>
              )}
              {methods?.passkey && (
                <button
                  type="button"
                  id="player-signin-passkey"
                  className="pa-btn pa-btn--ghost"
                  disabled={busy !== null}
                  onClick={() => run('passkey-signin', signInWithPasskey)}
                >
                  {busy === 'passkey-signin' ? 'Waiting for your device…' : 'Sign in with a passkey'}
                </button>
              )}
            </div>
          ) : (
            <div className="pa-actions">
              {characters.length > 1 && (
                <div className="pa-characters" role="group" aria-label="Your characters">
                  <p className="pa-characters-title">Your characters</p>
                  <ul className="pa-character-list">
                    {characters.map((id, i) => {
                      const playing = id === player.playerId
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            id={`player-character-${i}`}
                            className={`pa-character${playing ? ' is-playing' : ''}`}
                            disabled={busy !== null || playing}
                            aria-pressed={playing}
                            title={playing ? 'Playing on this device' : 'Play as this character'}
                            onClick={() => run('switch', () => switchCharacter(id))}
                          >
                            <span className="pa-orb" style={{ '--pa-color': colorForPlayer(id) } as CSSProperties} aria-hidden="true" />
                            <span className="pa-character-label">{playing ? 'Playing' : 'Play'}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              {confirming ? (
                <div className="pa-confirm" role="group" aria-labelledby="pa-confirm-title">
                  <p id="pa-confirm-title" className="pa-confirm-title">Confirm it's you</p>
                  <p className="pa-hint pa-hint--left">
                    Before changing how you sign in, use one of your ways in on this device. Keeps your player safe if someone else is holding it.
                  </p>
                  {hasPasskey && methods?.passkey && (
                    <button
                      type="button"
                      id="player-confirm-passkey"
                      className="pa-btn pa-btn--primary"
                      disabled={busy !== null}
                      onClick={() => run('confirm', async () => {
                        const r = await confirmWithPasskey()
                        if (r.ok) confirmed()
                        return r
                      })}
                    >
                      <PasskeyMark />
                      {busy === 'confirm' ? 'Waiting for your device…' : 'Confirm with a passkey'}
                    </button>
                  )}
                  {hasGoogle && methods?.google && (
                    <button
                      type="button"
                      id="player-confirm-google"
                      className="pa-btn pa-btn--light"
                      disabled={busy !== null}
                      onClick={() => run('google', confirmWithGoogle)}
                    >
                      <GoogleMark />
                      {busy === 'google' ? 'Opening Google…' : 'Confirm with Google'}
                    </button>
                  )}
                  {email && methods?.email && (
                    <EmailSignIn mode="confirm" fixedEmail={email} disabled={busy !== null} onDone={confirmed} />
                  )}
                  <button type="button" id="player-confirm-cancel" className="pa-btn pa-btn--quiet" disabled={busy !== null} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <ul className="pa-linked" aria-label="Ways to sign in">
                    {methods?.passkey && passkeys.map((pk, i) => (
                      <li key={pk.id} className="is-on">
                        <PasskeyMark />
                        <span className="pa-linked-label" title={`Added ${shortDate(pk.createdAt)}`}>
                          {pk.name || 'Passkey'}
                          <span className="pa-linked-sub"> · {shortDate(pk.createdAt)}</span>
                        </span>
                        <button
                          type="button"
                          id={`player-remove-passkey-${i}`}
                          className="pa-link pa-link--danger"
                          disabled={busy !== null}
                          onClick={() => run(`remove-${pk.id}`, () => removePasskey(pk.id), 'Passkey removed.')}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {methods?.passkey && !hasPasskey && (
                      <li>
                        <PasskeyMark />
                        <span>Passkey</span>
                        <button
                          type="button"
                          id="player-add-passkey"
                          className="pa-link"
                          disabled={busy !== null}
                          onClick={() => run('passkey-save', saveWithPasskey, 'Passkey added.')}
                        >
                          Add
                        </button>
                      </li>
                    )}
                    {methods?.google && (
                      <li className={hasGoogle ? 'is-on' : ''}>
                        <GoogleMark />
                        <span>Google</span>
                        {hasGoogle ? (
                          <button
                            type="button"
                            id="player-remove-google"
                            className="pa-link pa-link--danger"
                            disabled={busy !== null}
                            onClick={() => run('remove-google', removeGoogle, 'Google removed.')}
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            id="player-add-google"
                            className="pa-link"
                            disabled={busy !== null}
                            onClick={() => run('google', continueWithGoogle)}
                          >
                            Add
                          </button>
                        )}
                      </li>
                    )}
                    {methods?.email && (
                      <li className={email ? 'is-on' : ''}>
                        <svg className="pa-btn-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="5" width="18" height="14" rx="3" />
                          <path d="m4 7 8 6 8-6" />
                        </svg>
                        <span className="pa-linked-label" title={email ?? undefined}>{email ?? 'Email'}</span>
                        <button
                          type="button"
                          id="player-add-email"
                          className="pa-link"
                          disabled={busy !== null}
                          aria-expanded={addingEmail}
                          onClick={() => setAddingEmail(!addingEmail)}
                        >
                          {addingEmail ? 'Cancel' : email ? 'Change' : 'Add'}
                        </button>
                      </li>
                    )}
                    {linked?.password && (
                      <li className="is-on">
                        <svg className="pa-btn-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="10" width="16" height="10" rx="2.5" />
                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                        </svg>
                        <span>Password</span>
                        <button
                          type="button"
                          id="player-remove-password"
                          className="pa-link pa-link--danger"
                          disabled={busy !== null}
                          onClick={() => run('remove-password', removePassword, 'Password removed. Sign in with a code instead.')}
                        >
                          Remove
                        </button>
                      </li>
                    )}
                  </ul>
                  {addingEmail && (
                    <EmailSignIn mode="add" disabled={busy !== null} onDone={emailDone} onNeedsConfirm={needConfirm} />
                  )}
                  {hasPasskey && methods?.passkey && (
                    <button
                      type="button"
                      id="player-add-another-passkey"
                      className="pa-btn pa-btn--ghost"
                      disabled={busy !== null}
                      onClick={() => run('passkey-save', saveWithPasskey, 'Passkey added on this device.')}
                    >
                      Add a passkey on this device
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                id="player-signout"
                className="pa-btn pa-btn--quiet"
                disabled={busy !== null}
                onClick={() => {
                  setBusy('signout')
                  void signOutOfDevice()
                }}
              >
                Sign out of this device
              </button>
              <p className="pa-hint">To use a different player here, sign out first.</p>
            </div>
          )}

          <p className={`pa-status${status ? ` pa-status--${status.tone}` : ''}`} role="status" aria-live="polite">
            {status?.text ?? ''}
          </p>

          <p className="pa-legal">
            <a href="/privacy.html" target="_blank" rel="noopener" id="pa-privacy-link">Privacy</a>
            {' · '}
            <a href="/terms.html" target="_blank" rel="noopener" id="pa-terms-link">Terms</a>
          </p>
        </div>
      </dialog>
    </>
  )
}

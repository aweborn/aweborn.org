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
  continueWithGoogle,
  fetchAuthMethods,
  getPlayerSnapshot,
  listSignInMethods,
  saveWithPasskey,
  signInWithPasskey,
  signOutOfDevice,
  subscribePlayer,
  type AuthMethods,
  type AuthResult,
} from '../lib/player'
import { canPromptNow, onMeaningfulMoment, recordPrompted, trackPlaytime } from '../lib/onramp'

type Busy = null | 'passkey-save' | 'passkey-signin' | 'google' | 'signout'

function usePlayer() {
  return useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
}

/** Read and clear `?signin=failed&error=…` left by a failed Google round trip. */
function takeSignInError(): string | null {
  const url = new URL(window.location.href)
  if (url.searchParams.get('signin') !== 'failed') return null
  url.searchParams.delete('signin')
  url.searchParams.delete('error')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return "Google sign-in didn't finish. Your player is safe on this device. Try again any time."
}

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
  const [linked, setLinked] = useState<{ passkeys: number; google: boolean } | null>(null)
  const [nudge, setNudge] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const isAnonymous = player?.isAnonymous ?? false
  const canSave = Boolean(methods?.enabled && (methods.passkey || methods.google))

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
    refreshLinked()
    dialogRef.current?.showModal()
  }, [refreshLinked])

  const close = useCallback(() => dialogRef.current?.close(), [])

  // Back from a failed Google round trip: reopen the panel with a kind note.
  useEffect(() => {
    if (!methods?.enabled) return
    const err = takeSignInError()
    if (err) {
      dialogRef.current?.showModal()
      setStatus({ tone: 'error', text: err })
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

  const hasPasskey = (linked?.passkeys ?? 0) > 0
  const hasGoogle = linked?.google ?? false

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
                ? 'Keep your worlds and cards on every device. No password, no email needed. You can keep playing either way.'
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
              <ul className="pa-linked" aria-label="Ways to sign in">
                {methods?.passkey && (
                  <li className={hasPasskey ? 'is-on' : ''}>
                    <PasskeyMark />
                    <span>Passkey{(linked?.passkeys ?? 0) > 1 ? `s (${linked?.passkeys})` : ''}</span>
                    {hasPasskey ? (
                      <span className="pa-check" aria-label="linked">✓</span>
                    ) : (
                      <button
                        type="button"
                        id="player-add-passkey"
                        className="pa-link"
                        disabled={busy !== null}
                        onClick={() => run('passkey-save', saveWithPasskey, 'Passkey added.')}
                      >
                        Add
                      </button>
                    )}
                  </li>
                )}
                {methods?.google && (
                  <li className={hasGoogle ? 'is-on' : ''}>
                    <GoogleMark />
                    <span>Google</span>
                    {hasGoogle ? (
                      <span className="pa-check" aria-label="linked">✓</span>
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
              </ul>
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

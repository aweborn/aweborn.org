import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'

/**
 * Gen AI is for signed-in players (Alex, 2026-10-20). Guests explore, enter
 * worlds, place blocks and Library models freely; making something out of
 * nothing but thought draws on the shared mana pool, so it needs a player
 * who has signed in (or saved). This file holds the check and the "sealed"
 * invitation shown instead of the Create / Plan panels.
 *
 * The server enforces the same rule (403 `sign_in_required`); this is the UX.
 */

/** Ask PlayerAccount to open its sign-in dialog. */
export const OPEN_ACCOUNT_EVENT = 'aweborn:open-account'
export function openAccount(): void {
  window.dispatchEvent(new CustomEvent(OPEN_ACCOUNT_EVENT))
}

/** True when this player may channel mana (signed in / saved). */
export function useCanChannel(): { canChannel: boolean; authReachable: boolean; ready: boolean } {
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  return {
    canChannel: Boolean(player && !player.isAnonymous && !player.isGuest),
    authReachable: Boolean(player && !player.isGuest),
    ready: player !== null,
  }
}

interface SealProps {
  /** Which power the player reached for. */
  kind: 'create' | 'plan'
  onClose: () => void
}

const COPY = {
  create: { title: 'Make from thought', verb: 'Speak a thing into being' },
  plan: { title: 'Dream a world', verb: 'Shape whole lands from a sentence' },
} as const

/**
 * The sealed invitation: portrait-first bottom sheet, a centred card on wide
 * screens. Esc, the ✕, the backdrop or "Keep exploring" close it.
 */
export function ManaSeal({ kind, onClose }: SealProps) {
  const { authReachable } = useCanChannel()
  const primaryRef = useRef<HTMLButtonElement>(null)
  const copy = COPY[kind]

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Portalled: a transformed parent (.create-panel) would trap a fixed overlay.
  return createPortal(
    <div className="mana-seal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="mana-seal" role="dialog" aria-modal="true" aria-labelledby="mana-seal-title">
        <button id="mana-seal-close" className="mana-seal-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="mana-seal-sigil" aria-hidden="true">
          <span className="mana-seal-ring" />
          <span className="mana-seal-ring mana-seal-ring--inner" />
          <span className="mana-seal-core">✦</span>
        </div>
        <p className="mana-seal-eyebrow">{copy.verb}</p>
        <h2 id="mana-seal-title" className="mana-seal-title">{copy.title}</h2>
        <p className="mana-seal-body">
          Creating out of nothing but thought is the most powerful thing in Aweborn. Every creation is woven from{' '}
          <strong>mana</strong>: one pool, given by players, shared by everyone. To draw on it, sign in.
        </p>
        {authReachable ? (
          <button
            id="mana-seal-signin"
            ref={primaryRef}
            className="mana-seal-cta"
            type="button"
            onClick={() => {
              onClose()
              openAccount()
            }}
          >
            Sign in to channel mana
          </button>
        ) : (
          <p className="mana-seal-offline">Sign-in can’t be reached right now. Try again in a moment.</p>
        )}
        <button id="mana-seal-explore" className="mana-seal-secondary" type="button" onClick={onClose}>
          Keep exploring
        </button>
        <p className="mana-seal-note">Until then, worlds are open to you: walk them, place blocks and anything from the Library.</p>
      </section>
    </div>,
    document.body,
  )
}

/**
 * Aweborn: "Delete my player…", at the bottom of the saved player's panel.
 *
 * Alex, 2026-11-24: "Make sure there is an are-you-sure prompt, and it says that it will
 * destroy everything." So before anything happens this says, in plain words, what is
 * destroyed (everything about the player: it cannot be undone) and what stays and why
 * (what they wrote, things other people use, and what the law makes us keep, all with
 * the player taken out), as
 * `public/privacy.html` promises and the server's `erase-player.ts` does. If the two
 * ever differ, the page and the server are right and this text is the bug.
 *
 * The destructive button stays off until the word is typed, and the server also wants a
 * sign-in on this device in the last 5 minutes (the panel's own "Confirm it's you").
 * No pleading either way: one plain way out ("Keep my player"), one plain way through.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { DELETE_WORD, deleteMyPlayer, loadDeleteStanding, startOverAfterDelete, type DeleteStanding } from '../lib/deletePlayer'
import './DeletePlayer.css'

/** The entry: last thing in the panel, set apart from signing out. */
export function DeletePlayerEntry({ disabled, onOpen }: { disabled?: boolean; onOpen: () => void }) {
  return (
    <div className="dp-entry">
      <button type="button" id="player-delete-open" className="dp-open" disabled={disabled} onClick={onOpen}>
        Delete my player…
      </button>
    </div>
  )
}

const yourCharacters = (n: number) => (n <= 1 ? 'Your character' : n === 2 ? 'Both your characters' : `All ${n} of your characters`)

/** The short screen after a delete (the page has already started over as a fresh guest underneath). */
export function PlayerDeletedNotice({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="dp dp-done" id="player-deleted" role="status" aria-live="polite">
      <h2 className="dp-title">Your player is deleted</h2>
      <p className="dp-lead">Your sign-in, your characters and everything linked to them are gone. You’re a new guest now, and you can keep exploring.</p>
      <div className="dp-actions">
        <button type="button" id="player-deleted-continue" className="pa-btn pa-btn--primary" onClick={onContinue}>
          Continue as a guest
        </button>
      </div>
    </div>
  )
}

export function DeletePlayer({ onCancel, onNeedsConfirm }: {
  /** Back to the panel, nothing changed. */
  onCancel: () => void
  /** The server wants "Confirm it's you" first; the panel shows that step, then comes back here. */
  onNeedsConfirm: () => void
}) {
  const uid = useId()
  const [standing, setStanding] = useState<DeleteStanding | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let alive = true
    void loadDeleteStanding().then((s) => {
      if (!alive) return
      setStanding(s)
      setLoaded(true)
    })
    titleRef.current?.focus()
    return () => { alive = false }
  }, [])

  const word = standing?.word ?? DELETE_WORD
  const matches = typed.trim().toUpperCase() === word
  const needsConfirm = loaded && standing !== null && !standing.fresh
  const characters = standing?.characters ?? 1
  const worlds = standing?.worlds ?? 0

  async function onDelete() {
    if (!matches || busy) return
    setBusy(true)
    setError(null)
    const r = await deleteMyPlayer(word)
    if (r.ok) {
      // Start over as a fresh guest at once; the page that comes back says "Your player is deleted"
      setDone(true)
      await startOverAfterDelete()
      return
    }
    setBusy(false)
    if (r.needsConfirm) {
      setStanding((s) => (s ? { ...s, fresh: false } : s))
      return
    }
    setError(r.message)
  }

  if (done) return <p className="dp-lead" role="status" aria-live="polite">Your player is deleted.</p>

  return (
    <form
      className="dp"
      id="player-delete"
      aria-labelledby={`${uid}-title`}
      onSubmit={(e) => {
        e.preventDefault()
        void onDelete()
      }}
    >
      <h2 id={`${uid}-title`} className="dp-title" tabIndex={-1} ref={titleRef}>Delete your player?</h2>
      <p className="dp-lead" id="player-delete-lead">
        This destroys <strong>everything</strong> about your player, on every device. <strong>It cannot be undone</strong>, and we can’t bring any of it back.
      </p>

      <section className="dp-group dp-group--gone" aria-labelledby={`${uid}-gone`}>
        <h3 id={`${uid}-gone`}>What is destroyed</h3>
        <ul id="player-delete-gone">
          <li><strong>Your sign-in</strong>: your email, passkeys, password and Google link, and every device that is signed in</li>
          <li><strong>{yourCharacters(characters)}</strong>, with {characters === 1 ? 'its name' : 'their names'}</li>
          <li><strong>Your progress and awe</strong></li>
          <li><strong>Your World Index</strong>: every world you found</li>
          <li>Your 18+ choice, your asks to build, your mutes, and what characters with a mind remember about you</li>
        </ul>
      </section>

      <section className="dp-group" aria-labelledby={`${uid}-stays`}>
        <h3 id={`${uid}-stays`}>What stays, and why</h3>
        <ul id="player-delete-stays">
          <li>
            <strong>What you wrote in world chat and to the planner stays, without your name.</strong> A world keeps its whole story, so your lines
            stay where they are, shown as from “A former player” (in a world’s story, as the same numbered maker). If your words themselves say who you are, they still will.
          </li>
          <li>
            <strong>Worlds you made and things you placed</strong> stay for the people who built there, with your name removed.
            {worlds > 0 && <> {worlds === 1 ? 'The world you made' : `The ${worlds} worlds you made`} will have no creator; {worlds === 1 ? 'its' : 'their'} builders keep building.</>}
            {' '}You can’t get them back later.
          </li>
          <li><strong>What you shared in the Library</strong> (creations, minds, games) stays for the worlds that use it, without your name.</li>
          <li><strong>Replays</strong> of matches you played stay for the other players, with an anonymous “Player” where you were.</li>
          <li>
            <strong>Money records</strong>: donations and card orders stay in our accounts and in the public ledger as amounts and dates, because the law requires it, with no link to your player.
            Cards you’ve paid for that are still on their way are still mailed.
          </li>
          <li><strong>Our research archive</strong> of requests to AI stays under a random research ID; its link to your player is deleted.</li>
        </ul>
      </section>

      <p className="dp-note">
        Backups are gone within 90 days. A name you chose to show with a donation isn’t linked to your player, so we can’t remove it automatically: email privacy@aweborn.org.{' '}
        <a href="/privacy.html#delete-your-player" target="_blank" rel="noopener" id="player-delete-privacy">Privacy: deleting your player</a>
      </p>

      {needsConfirm ? (
        <>
          <p className="dp-lead" id="player-delete-needs-confirm">First, confirm it’s you with one of your ways in. Then you’ll come back here. Nothing is deleted yet.</p>
          <div className="dp-actions">
            <button type="button" id="player-delete-confirm-first" className="pa-btn pa-btn--light" onClick={onNeedsConfirm}>
              Confirm it’s you
            </button>
            <button type="button" id="player-delete-cancel" className="pa-btn pa-btn--ghost" onClick={onCancel}>
              Keep my player
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="pa-field">
            <label htmlFor={`${uid}-word`} className="pa-label">
              To delete your player, type <span className="dp-word">{word}</span>
            </label>
            <input
              id={`${uid}-word`}
              name="player-delete-word"
              data-testid="player-delete-word"
              className="pa-input dp-input"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={busy || !loaded}
              aria-describedby="player-delete-lead"
            />
          </div>
          <p className="dp-status" role="status" aria-live="polite" id="player-delete-status">{error ?? ''}</p>
          <div className="dp-actions">
            <button type="submit" id="player-delete-submit" className="pa-btn dp-delete" disabled={!matches || busy || !loaded}>
              {busy ? 'Deleting…' : 'Delete my player forever'}
            </button>
            <button type="button" id="player-delete-cancel" className="pa-btn pa-btn--ghost" disabled={busy} onClick={onCancel}>
              Keep my player
            </button>
          </div>
        </>
      )}
    </form>
  )
}

/**
 * Aweborn — the 18+ door, in the saved player's panel.
 *
 * A toggle and nothing else (Alex, 2026-11-24): no date of birth, no form. Turning it
 * on is the player's own statement that they are 18 or older. A real age check comes
 * only where a state's or a country's law requires one, and isn't built yet.
 *
 * Phase 10 Q10b: turning it on also makes the player's match play research data, with
 * no separate form, so that is said right here, where it can be read before the tap
 * (Privacy promises it).
 */

import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import { getDoorSnapshot, loadDoor, setDoor, subscribeDoor } from '../lib/door'

export function AdultDoor({ disabled }: { disabled?: boolean }) {
  const uid = useId()
  const door = useSyncExternalStore(subscribeDoor, getDoorSnapshot, getDoorSnapshot)
  const [fresh, setFresh] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ask again when the panel opens: the switch may have been flipped on another screen
  useEffect(() => {
    let alive = true
    void loadDoor().then(() => { if (alive) setFresh(true) })
    return () => { alive = false }
  }, [])
  const on = fresh && door.loaded ? door.show : null

  async function onSwitch() {
    if (disabled || busy || on === null) return
    setBusy(true)
    setError(null)
    const r = await setDoor(!on)
    setBusy(false)
    if (!r.ok) setError(r.message)
  }

  return (
    <div className="pa-door" role="group" aria-labelledby={`${uid}-title`}>
      <div className="pa-door-row">
        <div className="pa-door-text">
          <p id={`${uid}-title`} className="pa-characters-title">18+ content</p>
          <p className="pa-hint pa-hint--left">{on ? 'On' : 'Off'} · for players 18 or older</p>
        </div>
        <button
          type="button"
          id="player-door-switch"
          className={`pa-switch${on ? ' is-on' : ''}`}
          role="switch"
          aria-checked={on ?? false}
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-note`}
          disabled={disabled || busy || on === null}
          onClick={() => void onSwitch()}
        >
          <span className="pa-switch-knob" aria-hidden="true" />
        </button>
      </div>
      <p id={`${uid}-note`} className="pa-door-note">
        {on ? 'You can enter and make 18+ worlds. How you play in matches is part of Aweborn’s research' : 'Lets you enter and make 18+ worlds. Turning this on also makes how you play in matches part of Aweborn’s research'}
        , under a random research ID, never your name.{' '}
        <a href="/privacy.html#match-research" target="_blank" rel="noopener" id="player-door-privacy">How research works</a>
      </p>
      {error && <p className="pa-email-status pa-status--error" role="status" aria-live="polite">{error}</p>}
    </div>
  )
}

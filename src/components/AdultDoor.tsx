/**
 * Aweborn — the 18+ door, in the saved player's panel.
 *
 * Decision 3 of the age grill (Phase 07): signed in, a date of birth, and *Show 18+*.
 * Phase 10 Q10b: turning it on also makes the player's match play research data, with
 * no separate form, so that is said right here, before the choice (Privacy promises it).
 * 18+ worlds aren't built yet; the text says that too rather than promising content.
 */

import { useEffect, useId, useState, type FormEvent } from 'react'
import { birthdateOf, getDoor, setDoor, type DoorState } from '../lib/door'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function AdultDoor({ disabled }: { disabled?: boolean }) {
  const uid = useId()
  const [door, setDoorState] = useState<DoorState | null>(null)
  const [asking, setAsking] = useState(false)
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The server refused an under-18 date: the switch rests until the panel is opened again. */
  const [held, setHeld] = useState(false)

  useEffect(() => {
    let alive = true
    void getDoor().then((d) => { if (alive) setDoorState(d) })
    return () => { alive = false }
  }, [])

  const on = door?.show ?? false
  const off = disabled || busy || door === null
  const birthdate = birthdateOf(year, month, day)

  async function send(show: boolean, date?: string) {
    setBusy(true)
    setError(null)
    const r = await setDoor(show, date)
    setBusy(false)
    if (r.ok) {
      setDoorState({ confirmed: r.confirmed, show: r.show })
      setAsking(false)
      setDay(''); setMonth(''); setYear('')
      return
    }
    if (r.code === 'birthdate_needed') { setAsking(true); return }
    if (r.code === 'under_age') { setHeld(true); setAsking(false); setDay(''); setMonth(''); setYear('') }
    setError(r.message)
  }

  function onSwitch() {
    if (off || held) return
    if (on) void send(false)
    else if (door?.confirmed) void send(true)
    else { setError(null); setAsking(!asking) }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy || !birthdate) return
    void send(true, birthdate)
  }

  return (
    <div className="pa-door" role="group" aria-labelledby={`${uid}-title`}>
      <div className="pa-door-row">
        <div className="pa-door-text">
          <p id={`${uid}-title`} className="pa-characters-title">18+ content</p>
          <p id={`${uid}-state`} className="pa-hint pa-hint--left">
            {on
              ? 'On. How you play in matches is part of Aweborn’s research.'
              : held
                ? 'Off.'
                : 'Off. For players who are 18 or older.'}
          </p>
        </div>
        <button
          type="button"
          id="player-door-switch"
          className={`pa-switch${on ? ' is-on' : ''}`}
          role="switch"
          aria-checked={on}
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-state`}
          aria-expanded={!on && !door?.confirmed ? asking : undefined}
          disabled={off || held}
          onClick={onSwitch}
        >
          <span className="pa-switch-knob" aria-hidden="true" />
        </button>
      </div>

      {asking && !on && (
        <form className="pa-door-form" onSubmit={onSubmit}>
          <ul className="pa-door-notes">
            <li>18+ worlds aren’t open yet. You’ll be ready when they are.</li>
            <li>
              <strong>Turning this on makes how you play in matches part of Aweborn’s research</strong>, under a random
              research ID, never your name. There’s no separate research form.{' '}
              <a href="/privacy.html#match-research" target="_blank" rel="noopener" id="player-door-privacy">How research works</a>
            </li>
            <li>You can turn it off here any time. Your matches then stop counting for research.</li>
          </ul>
          <fieldset className="pa-door-date" disabled={busy}>
            <legend className="pa-label">Your date of birth</legend>
            <div className="pa-door-fields">
              <label className="pa-door-field pa-door-field--month">
                <span className="pa-label">Month</span>
                <select id={`${uid}-month`} className="pa-input" autoComplete="bday-month" required value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="" disabled>Month</option>
                  {MONTHS.map((name, i) => <option key={name} value={String(i + 1)}>{name}</option>)}
                </select>
              </label>
              <label className="pa-door-field">
                <span className="pa-label">Day</span>
                <input id={`${uid}-day`} className="pa-input" type="text" inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} placeholder="DD"
                  autoComplete="bday-day" required value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="pa-door-field">
                <span className="pa-label">Year</span>
                <input id={`${uid}-year`} className="pa-input" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="YYYY"
                  autoComplete="bday-year" required value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <p className="pa-hint pa-hint--left">We check the date and don’t keep it.</p>
          </fieldset>
          <button type="submit" id="player-door-confirm" className="pa-btn pa-btn--primary" disabled={busy || !birthdate}>
            {busy ? 'Checking…' : 'Turn on 18+'}
          </button>
          <button type="button" id="player-door-cancel" className="pa-link pa-link--quiet" disabled={busy} onClick={() => { setAsking(false); setError(null) }}>
            Cancel
          </button>
        </form>
      )}
      {error && <p className="pa-email-status pa-status--error" role="status" aria-live="polite">{error}</p>}
    </div>
  )
}

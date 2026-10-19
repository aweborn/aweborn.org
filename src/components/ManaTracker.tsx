import { useEffect, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useManaTracker, refreshMana, type UsageStat } from '../stores/manaTrackerStore'

const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toString())
const ago = (at: number) => {
  const m = Math.max(0, Math.round((Date.now() - at) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

function Bar({ value, max, tone }: { value: number; max: number; tone: 'me' | 'world' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <span className={`mana-bar mana-bar--${tone}`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  )
}

function Avg({ label, s }: { label: string; s: UsageStat }) {
  return (
    <div className="mana-avg">
      <span>{label}</span>
      <b>{s.count ? `≈${fmt(s.average)}` : '–'}</b>
      <i>{s.count} this week</i>
    </div>
  )
}

/**
 * Personal mana tracker: what's left of your allowance today, what's in
 * flight, your averages, and the world-wide pool. Refreshes while open and
 * whenever something spends mana (`refreshMana()`).
 */
export function ManaTracker() {
  const [open, setOpen] = useState(false)
  const status = useManaTracker((s) => s.status)
  const universe = useUniverseStore((s) => s.mana)

  useEffect(() => {
    void refreshMana()
    const id = setInterval(() => void refreshMana(), open ? 10_000 : 45_000)
    return () => clearInterval(id)
  }, [open])

  // A guest (no session) has no personal allowance to show
  if (!status) return null

  const low = status.cap > 0 && status.remaining < status.cap * 0.15
  const creative = universe?.creative ?? status.pool.creative
  const reserved = universe?.reserved ?? 0

  return (
    <div className={`mana-tracker${open ? ' is-open' : ''}${low ? ' is-low' : ''}`}>
      <button
        id="mana-pill"
        className="mana-pill"
        type="button"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); void refreshMana() }}
        title="Your mana for today"
      >
        <span className="mana-pill-icon">✦</span>
        <span className="mana-pill-num">{fmt(status.remaining)}</span>
        <span className="mana-pill-label">mana left</span>
        {status.held > 0 && <span className="mana-pill-held">{fmt(status.held)} in flight</span>}
      </button>

      {open && (
        <section className="mana-panel" aria-label="Mana tracker">
          <h3>Your mana · 24 h</h3>
          <div className="mana-row">
            <span>Allowance</span>
            <b>{fmt(status.spent)} / {fmt(status.cap)} used</b>
          </div>
          <Bar value={status.spent} max={status.cap} tone="me" />
          <p className="mana-note">
            You can draw {fmt(status.remaining)} right now
            {status.remaining < status.cap - status.spent - 0.5 ? ' (the world’s flow is the limit)' : ''}. It returns as older draws leave the 24 h window.
          </p>
          {status.guest && (
            <p className="mana-note mana-note--guest">
              A starter allowance, enough for about one model. Save your player to make more.
            </p>
          )}

          <div className="mana-avgs">
            <Avg label="Per planner turn" s={status.week.plan} />
            <Avg label="Per model" s={status.week.model} />
          </div>

          <h3>The world</h3>
          <div className="mana-row">
            <span>Today’s flow</span>
            <b>{fmt(status.flowSpent)} / {fmt(status.flow)} used</b>
          </div>
          <Bar value={status.flowSpent} max={status.flow} tone="world" />
          <div className="mana-row">
            <span>Creative pool</span>
            <b>{fmt(creative)}{reserved > 0 ? ` · ${fmt(reserved)} held` : ''}</b>
          </div>
          <div className="mana-row">
            <span>Makers sharing the flow</span>
            <b>{Math.max(1, status.activePlayers)}</b>
          </div>

          {status.recent.length > 0 && (
            <>
              <h3>Recent</h3>
              <ul className="mana-recent">
                {status.recent.map((r, i) => (
                  <li key={i}>
                    <span>{r.kind === 'plan' ? 'planner turn' : 'model'}</span>
                    <b>−{fmt(r.amount)}</b>
                    <i>{ago(r.at)}</i>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}

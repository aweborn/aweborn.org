import { useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useManaTracker, refreshMana, type UsageStat } from '../stores/manaTrackerStore'
import { useSheet } from '../stores/sheetStore'
import { openAccount } from './ManaSeal'
import { subscribePlayer } from '../lib/player'
import { useSkyStore } from '../stores/skyStore'
import { FUNCTION_COLORS, FUNCTION_LABELS, NATURES, PURPOSE_LABELS } from '@aweborn/shared/sky'

/** Hold duration (ms) on the place/mana pill inside a world to leave back to space (docs/mobile-ui/SPEC.md). */
const HOLD_LEAVE_MS = 600
/** A hold released after this long (ms) counts as an aborted hold, not a tap. */
const HOLD_ABORT_MS = 220

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
 * Personal mana tracker + (on touch) the top-right Place · Mana pill with
 * 0.6 s hold-to-leave inside worlds (docs/mobile-ui/SPEC.md).
 */
export function ManaTracker() {
  const [open, setOpen] = useSheet('mana')
  const status = useManaTracker((s) => s.status)
  const universe = useUniverseStore((s) => s.mana)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const worlds = useUniverseStore((s) => s.worlds)
  const isInWorld = activeWorldId !== null
  const worldName = activeWorldId ? (worlds.get(activeWorldId)?.name ?? activeWorldId) : null
  const skyFlow = useSkyStore((s) => s.flow)

  const pillRef = useRef<HTMLButtonElement | null>(null)
  const holdRef = useRef<{ id: number; t0: number; raf: number; fired: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  const stopHold = useCallback(() => {
    const h = holdRef.current
    if (h) {
      cancelAnimationFrame(h.raf)
      holdRef.current = null
    }
    const el = pillRef.current
    if (el) {
      el.style.setProperty('--hold-p', '0')
      el.classList.remove('is-holding')
    }
  }, [])

  useEffect(() => {
    void refreshMana()
    const id = setInterval(() => void refreshMana(), open ? 10_000 : 45_000)
    return () => clearInterval(id)
  }, [open])

  // Signing in (or out) changes the allowance: refresh right away.
  useEffect(() => subscribePlayer(() => void refreshMana()), [])

  // Entering or leaving a world closes the mana sheet and resets any active hold.
  useEffect(() => {
    setOpen(false)
    stopHold()
  }, [activeWorldId, setOpen, stopHold])

  useEffect(() => () => stopHold(), [stopHold])

  const isSealed = !status || status.guest

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isInWorld || e.button !== 0) return
    stopHold()
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic events may lack pointerId */ }
    const t0 = performance.now()
    el.classList.add('is-holding')
    const state = { id: e.pointerId, t0, raf: 0, fired: false }
    const step = (now: number) => {
      if (holdRef.current !== state) return
      const p = Math.min(1, (now - t0) / HOLD_LEAVE_MS)
      el.style.setProperty('--hold-p', p.toFixed(3))
      if (p >= 1) {
        state.fired = true
        suppressClickRef.current = true
        stopHold()
        setOpen(false)
        useUniverseStore.getState().exitWorld()
      } else {
        state.raf = requestAnimationFrame(step)
      }
    }
    state.raf = requestAnimationFrame(step)
    holdRef.current = state
  }, [isInWorld, setOpen, stopHold])

  const onPointerEnd = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const h = holdRef.current
    if (!h || h.id !== e.pointerId) return
    const heldMs = performance.now() - h.t0
    const abortTap = !h.fired && e.type !== 'lostpointercapture' && heldMs >= HOLD_ABORT_MS
    if (abortTap) suppressClickRef.current = true
    stopHold()
  }, [stopHold])

  const onClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (isSealed) {
      openAccount()
    } else {
      setOpen((o) => !o)
      void refreshMana()
    }
  }, [isSealed, setOpen])

  const low = !isSealed && status.cap > 0 && status.remaining < status.cap * 0.15
  const creative = !isSealed ? (universe?.creative ?? status.pool.creative) : 0
  const reserved = universe?.reserved ?? 0

  return (
    <div className={`mana-tracker${isSealed ? ' is-sealed' : ''}${open && !isSealed ? ' is-open' : ''}${low ? ' is-low' : ''}`}>
      <button
        ref={pillRef}
        id="mana-pill"
        className={`mana-pill${isInWorld ? ' mana-pill--in-world' : ''}`}
        type="button"
        aria-expanded={isSealed ? undefined : open}
        aria-label={
          isInWorld
            ? `${worldName ?? 'World'}, ${isSealed ? 'sign in to channel mana' : `${fmt(status.remaining)} mana left`}. Tap for mana and account, hold to leave world.`
            : `Universe, ${isSealed ? 'sign in to channel mana' : `${fmt(status.remaining)} mana left`}.`
        }
        onPointerDown={onPointerDown}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onClick={onClick}
        title={isInWorld ? 'Tap for mana · Hold 0.6 s to leave world' : isSealed ? 'Sign in to make things from thought' : 'Your mana for today'}
      >
        <span className="mana-pill-hold" aria-hidden="true" />
        <span className="mana-pill-row">
          <span className="mana-pill-place">
            <span className="mana-pill-place-icon" aria-hidden="true">{isInWorld ? '🌍' : '✦'}</span>
            <span id="mana-pill-place-name" className="mana-pill-place-name">{isInWorld ? worldName : 'Universe'}</span>
            <span className="mana-pill-sep" aria-hidden="true">·</span>
          </span>
          <span className="mana-pill-icon" aria-hidden="true">✦</span>
          {isSealed ? (
            <span className="mana-pill-label">
              Sign in<span className="mana-pill-wide"> to channel mana</span>
            </span>
          ) : (
            <>
              <span className="mana-pill-num">{fmt(status.remaining)}</span>
              <span className="mana-pill-label mana-pill-desktop-only">mana left</span>
              {status.held > 0 && <span className="mana-pill-held">{fmt(status.held)} in flight</span>}
            </>
          )}
        </span>
        {isInWorld && <span className="mana-pill-leave-sub" aria-hidden="true">hold to leave</span>}
      </button>

      {open && !isSealed && (
        <section id="mana-panel" className="mana-panel" aria-label="Mana tracker">
          <div className="mana-panel-head">
            <h3>Your mana · 24 h</h3>
            <button id="mana-panel-close" type="button" className="mana-panel-close" onClick={() => setOpen(false)} aria-label="Close mana panel">✕</button>
          </div>
          <div className="mana-row">
            <span>Allowance</span>
            <b>{fmt(status.spent)} / {fmt(status.cap)} used</b>
          </div>
          <Bar value={status.spent} max={status.cap} tone="me" />
          <p className="mana-note">
            You can draw {fmt(status.remaining)} right now
            {status.remaining < status.cap - status.spent - 0.5 ? ' (the world’s flow is the limit)' : ''}. It returns as older draws leave the 24 h window.
          </p>
          {typeof status.solar === 'number' && Math.abs(status.solar - 1) >= 0.005 && (
            <p className="mana-note mana-note--solar" id="mana-solar-note">
              {status.solar > 1 ? '☀' : '☾'} Daylight ×{status.solar.toFixed(2)}: your cap follows your local sun (up to +10 % at noon, −10 % at midnight).
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

          {skyFlow && (skyFlow.lines.length > 0 || skyFlow.shortfall > 0) && (
            <>
              <h3>Stars leaving the universe · 24 h</h3>
              <ul className="sky-legend" id="sky-legend">
                {[...skyFlow.lines]
                  .sort((a, b) => b.amount - a.amount)
                  .slice(0, 6)
                  .map((l) => (
                    <li key={`${l.fn}|${l.purpose}|${l.nature}`} title={`${FUNCTION_LABELS[l.fn]} · ${NATURES[l.nature]}`}>
                      <span className="sky-legend-dot" style={{ '--star-color': FUNCTION_COLORS[l.fn] } as CSSProperties} aria-hidden="true" />
                      <span className="sky-legend-what">
                        {PURPOSE_LABELS[l.purpose]}
                        <i>{NATURES[l.nature].replace(/\s*\(.*\)$/, '')}</i>
                      </span>
                      <b>{fmt(l.amount)}</b>
                    </li>
                  ))}
                {skyFlow.shortfall > 0 && (
                  <li title="The creative share covered bills the rest of the pool couldn't">
                    <span className="sky-legend-dot sky-legend-dot--shortfall" style={{ '--star-color': FUNCTION_COLORS.program } as CSSProperties} aria-hidden="true" />
                    <span className="sky-legend-what">
                      Shortfall
                      <i>creative share covered bills</i>
                    </span>
                    <b>{fmt(skyFlow.shortfall)}</b>
                  </li>
                )}
              </ul>
              <p className="mana-note">
                <span className="sky-key" style={{ '--star-color': FUNCTION_COLORS.program } as CSSProperties}>gold</span> programs ·{' '}
                <span className="sky-key" style={{ '--star-color': FUNCTION_COLORS.management } as CSSProperties}>blue</span> management ·{' '}
                <span className="sky-key" style={{ '--star-color': FUNCTION_COLORS.fundraising } as CSSProperties}>silver</span> fundraising.{' '}
                <a href="/giving.html#sky" target="_blank" rel="noopener" id="sky-legend-giving-link">How the sky works</a>
              </p>
            </>
          )}

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

          <button
            id="mana-panel-account"
            type="button"
            className="mana-panel-account"
            onClick={() => { setOpen(false); openAccount() }}
          >
            <span>Player &amp; account</span>
            <span aria-hidden="true">›</span>
          </button>
        </section>
      )}
    </div>
  )
}

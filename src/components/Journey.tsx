import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { CHAPTERS, CHAPTER_UNLOCKS, WARP_CHAPTER } from '@aweborn/shared/progress'
import { useProgressStore } from '../stores/progressStore'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'
import { inputManager } from '../systems/InputManager'
import { useSheet } from '../stores/sheetStore'

/**
 * Your journey (Rough Draft M3, 2026-10-27): awe = the character's experience.
 *
 *   JourneyChip    desktop, top left under the World Index chip
 *   JourneyRow     ••• More → Me (touch)
 *   Journey        the panel: level + awe bar, the chapter ladder with the
 *                  current chapter's steps, and what each chapter unlocks
 *   ProgressToast  "Level 4" / "Chapter 2 · Pilot" when one is gained
 */

const fmt = (n: number) => Math.round(n).toLocaleString()

function useLevelBar() {
  const view = useProgressStore((s) => s.view)
  if (!view) return null
  const span = Math.max(1, view.nextLevelXp - view.levelXp)
  const into = Math.min(span, Math.max(0, view.xp - view.levelXp))
  return { view, span, into, pct: (into / span) * 100 }
}

export function JourneyChip() {
  const bar = useLevelBar()
  const setOpen = useProgressStore((s) => s.setOpen)
  if (!bar) return null
  const { view, pct } = bar
  return (
    <button
      type="button"
      id="journey-chip"
      className="jr-chip"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-label={`Your journey: level ${view.level}, chapter ${view.chapter}, ${view.chapterName}`}
    >
      <span className="jr-chip-star" aria-hidden="true">✦</span>
      <span className="jr-chip-level">Level {view.level}</span>
      <span className="jr-chip-bar" aria-hidden="true">
        <span className="jr-chip-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="jr-chip-chapter">{view.chapterName}</span>
    </button>
  )
}

/** ••• More → Me. */
export function JourneyRow() {
  const view = useProgressStore((s) => s.view)
  const setOpen = useProgressStore((s) => s.setOpen)
  const [, setMore] = useSheet('more')
  if (!view) return null
  return (
    <button id="more-journey" type="button" className="more-row" onClick={() => { setMore(false); setOpen(true) }}>
      <span className="more-icon jr-row-icon" aria-hidden="true">✦</span>
      <span className="more-row-text">
        <span className="more-row-title">Your journey · Level {view.level}</span>
        <span className="more-row-sub">Chapter {view.chapter}: {view.chapterName}</span>
      </span>
      <span className="more-chev" aria-hidden="true">›</span>
    </button>
  )
}

export function Journey() {
  const open = useProgressStore((s) => s.open)
  const setOpen = useProgressStore((s) => s.setOpen)
  const bar = useLevelBar()
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      inputManager.setEnabled(false)
    } else if (!open && d.open) {
      d.close()
    }
  }, [open])

  const onClose = useCallback(() => {
    inputManager.setEnabled(true)
    setOpen(false)
  }, [setOpen])

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

  const view = bar?.view
  const gate = view && view.mastered < view.nextLevelMastered
  const unsaved = !!player?.isAnonymous && !!view && view.chapter >= 4 && view.chapter <= 5

  return (
    <dialog
      ref={dialogRef}
      id="journey-dialog"
      className="pa-dialog jr-dialog"
      aria-labelledby="journey-title"
      onClose={onClose}
      {...{ closedby: 'any' }}
    >
      <div className="pa-panel jr-panel">
        <button type="button" id="journey-close" className="pa-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <h2 id="journey-title" className="jr-title">Your journey</h2>
        <p className="jr-sub">Awe is your experience. It grows as you explore, make and share.</p>

        {!view || !bar ? (
          <p className="jr-empty">Your journey appears once you’re connected to the universe.</p>
        ) : (
          <>
            <section className="jr-level" aria-label="Level">
              <div className="jr-level-head">
                <span className="jr-level-badge">
                  <span className="jr-level-word">Level</span>
                  <span className="jr-level-num">{view.level}</span>
                </span>
                <span className="jr-level-xp">{fmt(view.xp)} awe</span>
              </div>
              <progress id="journey-xp" className="jr-progress" value={bar.into} max={bar.span} aria-labelledby="journey-xp-label" />
              <p id="journey-xp-label" className="jr-level-next">
                {fmt(bar.into)} / {fmt(bar.span)} awe to level {view.level + 1}
              </p>
              {gate && (
                <p className="jr-gate">
                  Level {view.level + 1} also needs {view.nextLevelMastered} mastered skill{view.nextLevelMastered === 1 ? '' : 's'} (you have {view.mastered}). Use a skill 3 times to master it.
                </p>
              )}
            </section>

            <ol className="jr-chapters" aria-label="Chapters">
              {CHAPTERS.map((ch) => {
                const state = ch.n < view.chapter ? 'done' : ch.n === view.chapter ? 'current' : 'locked'
                const unlock = CHAPTER_UNLOCKS[ch.n]
                return (
                  <li key={ch.n} className={`jr-ch jr-ch--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                    <span className="jr-ch-num" aria-hidden="true">{state === 'done' ? '✓' : ch.n}</span>
                    <div className="jr-ch-body">
                      <span className="jr-ch-name">
                        {ch.name}
                        {state === 'done' && <span className="visually-hidden"> (done)</span>}
                      </span>
                      {unlock && <span className="jr-ch-unlock">{state === 'locked' ? 'Unlocks: ' : ''}{unlock}</span>}
                      {state === 'current' && ch.n < WARP_CHAPTER && view.steps.length > 0 && (
                        <ul className="jr-steps">
                          {view.steps.map((s) => {
                            const done = s.have >= s.need
                            return (
                              <li key={s.id} className={done ? 'jr-step jr-step--done' : 'jr-step'}>
                                <span className="jr-step-mark" aria-hidden="true">{done ? '✓' : '○'}</span>
                                <span className="jr-step-label">{s.label}</span>
                                {s.need > 1 && <span className="jr-step-count">{fmt(s.have)} / {fmt(s.need)}</span>}
                                {done && <span className="visually-hidden"> (done)</span>}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {state === 'current' && ch.n === WARP_CHAPTER && (
                        <span className="jr-ch-unlock">Every level from here adds 50 mana a day.</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>

            {unsaved && (
              <p className="jr-note">Making with mana needs a saved player: open ••• More → Save your player.</p>
            )}
            <p className="jr-ways">
              Earn awe by visiting worlds for the first time (double with company), sighting new ones, mastering skills,
              flying far, finishing creations, and when other people visit a world you made.
            </p>
          </>
        )}
      </div>
    </dialog>
  )
}

const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

export function ProgressToast() {
  const toast = useProgressStore((s) => s.toast)
  const dismiss = useProgressStore((s) => s.dismissToast)
  const setOpen = useProgressStore((s) => s.setOpen)
  const view = useProgressStore((s) => s.view)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !supportsPopover) return
    if (toast && !el.matches(':popover-open')) el.showPopover()
    else if (!toast && el.matches(':popover-open')) el.hidePopover()
  }, [toast])

  const unlock = toast?.kind === 'chapter' ? CHAPTER_UNLOCKS[toast.chapter] : undefined
  const next = view?.steps.find((s) => s.have < s.need)
  const sub = unlock ?? (toast?.kind === 'chapter' && next ? `Next: ${next.label}` : 'Your awe grows')
  return (
    <div
      ref={ref}
      id="progress-toast"
      className={`jr-toast${!supportsPopover && toast ? ' is-open' : ''}`}
      role="status"
      {...(supportsPopover ? { popover: 'manual' } : {})}
    >
      {toast && (
        <>
          <span className="jr-toast-star" aria-hidden="true">✦</span>
          <span className="jr-toast-text">
            <span className="jr-toast-title">
              {toast.kind === 'chapter' ? `Chapter ${toast.chapter} · ${toast.chapterName}` : `Level ${toast.level}`}
            </span>
            <span className="jr-toast-sub">{sub}</span>
          </span>
          <button type="button" id="progress-toast-open" className="jr-toast-btn" onClick={() => { dismiss(); setOpen(true) }}>
            See
          </button>
          <button type="button" id="progress-toast-close" className="jr-toast-close" onClick={dismiss} aria-label="Dismiss">×</button>
        </>
      )}
    </div>
  )
}

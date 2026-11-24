import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GameBox, Vec3 } from '@aweborn/shared/game'
import { interiorController } from '../../systems/InteriorController'

/**
 * The Game tab's small controls (Phase 10): steppers, pickers, switches and a
 * tap-twice button. Everything a creator sets is picked or stepped, never typed, and
 * every target is at least 44 px (AGENTS.md → portrait rule 2).
 */

/** Where the player stands, rounded to half a metre (boxes snap, so two marks line up). `drop` lowers it to the floor under their feet. */
export function here(drop = 0): Vec3 {
  const s = interiorController.state
  const r = (v: number) => Math.round(v * 2) / 2
  return [r(s.x), r(s.y - drop), r(s.z)]
}

export const fmtSize = (b: GameBox) => `${b.size[0]} × ${b.size[2]} m, ${b.size[1]} m tall`

/** A step that grows with the number, so 1 and 600 are both a few taps away. */
export const stepFor = (v: number) => (Math.abs(v) >= 100 ? 25 : Math.abs(v) >= 20 ? 5 : 1)

export function Stepper({ id, label, value, text, step = 1, stepDown, min, max, onChange }: {
  id: string; label: string; value: number; text?: string; step?: number; stepDown?: number; min: number; max: number; onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)))
  return (
    <div className="game-row">
      <span className="game-row-label" id={`${id}-label`}>{label}</span>
      <span className="game-stepper" role="group" aria-labelledby={`${id}-label`}>
        <button id={`${id}-less`} type="button" className="game-step" disabled={value <= min} onClick={() => set(value - (stepDown ?? step))} aria-label={`Less: ${label}`}>−</button>
        <output className="game-step-value" aria-live="polite">{text ?? value}</output>
        <button id={`${id}-more`} type="button" className="game-step" disabled={value >= max} onClick={() => set(value + step)} aria-label={`More: ${label}`}>+</button>
      </span>
    </div>
  )
}

/** A stepper for a free-ranging whole number (card amounts): the step follows the size of the number. */
export function NumberStepper({ id, label, value, text, min, max, onChange }: {
  id: string; label: string; value: number; text?: string; min: number; max: number; onChange: (v: number) => void
}) {
  return <Stepper id={id} label={label} value={value} text={text} step={stepFor(value)} stepDown={stepFor(value - 1)} min={min} max={max} onChange={onChange} />
}

export function Segmented<T extends string>({ id, label, value, options, onChange }: {
  id: string; label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void
}) {
  return (
    <div className="game-row game-row--wrap">
      <span className="game-row-label" id={`${id}-label`}>{label}</span>
      <span className="game-seg" role="group" aria-labelledby={`${id}-label`}>
        {options.map(([v, text]) => (
          <button key={v} id={`${id}-${v}`} type="button" className={`game-seg-btn${value === v ? ' is-on' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </span>
    </div>
  )
}

/** Pick one from a list: the phone's own picker (a `<select>`), 16 px so iOS doesn't zoom. */
export function Picker<T extends string>({ id, label, value, options, onChange, bare }: {
  id: string; label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void
  /** No visible label (the label still names it for screen readers). */
  bare?: boolean
}) {
  const select = (
    <select id={id} className="game-select" value={value} aria-label={bare ? label : undefined} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  )
  if (bare) return select
  return (
    <label className="game-row game-pick" htmlFor={id}>
      <span className="game-row-label">{label}</span>
      {select}
    </label>
  )
}

export function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="game-row game-toggle" htmlFor={id}>
      <span className="game-row-label">{label}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Width / depth / height of a marked box. */
export function SizeSteppers({ id, box, xz, height, onChange }: {
  id: string; box: GameBox; xz: readonly [number, number]; height: readonly [number, number]; onChange: (size: Vec3) => void
}) {
  const [w, h, d] = box.size
  const step = xz[1] > 100 ? 4 : 1
  return (
    <>
      <Stepper id={`${id}-w`} label="Width" value={w} text={`${w} m`} step={step} min={xz[0]} max={xz[1]} onChange={(v) => onChange([v, h, d])} />
      <Stepper id={`${id}-d`} label="Depth" value={d} text={`${d} m`} step={step} min={xz[0]} max={xz[1]} onChange={(v) => onChange([w, h, v])} />
      <Stepper id={`${id}-h`} label="Height" value={h} text={`${h} m`} step={step > 1 ? 2 : 1} min={height[0]} max={height[1]} onChange={(v) => onChange([w, v, d])} />
    </>
  )
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="game-section">
      <h3 className="game-section-title">{title}</h3>
      {hint && <p className="game-hint">{hint}</p>}
      {children}
    </section>
  )
}

/** Asks again on the first tap (`sure`), acts on the second. */
export function ConfirmButton({ id, label, sure, disabled, className = '', onConfirm }: { id: string; label: string; sure: string; disabled?: boolean; className?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <button
      id={id}
      type="button"
      className={`game-btn${armed ? ' game-btn--danger' : ''} ${className}`}
      disabled={disabled}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current)
        if (armed) { setArmed(false); onConfirm(); return }
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 3500)
      }}
    >
      {armed ? sure : label}
    </button>
  )
}

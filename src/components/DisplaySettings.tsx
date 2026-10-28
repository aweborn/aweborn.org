import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import {
  useQualityStore,
  QUALITY_TIERS,
  activeTierIndex,
  type QualitySetting,
} from '../stores/qualityStore'
import { SIGHT_DISTANCE } from '../stores/worldIndexStore'
import { SoundControl } from './SoundControl'

/**
 * Display settings: a gear under the FPS counter that opens a small glass
 * panel with one quality slider (Auto · Low · Medium · High · Ultra) and
 * sound (mute + volume, Rough Draft M2).
 *
 * Slider position 0 = Auto, 1..4 = fixed tiers 0..3.
 */

const STOPS = ['Auto', ...QUALITY_TIERS.map((t) => t.name)]

function toSlider(s: QualitySetting): number {
  return s === 'auto' ? 0 : s + 1
}

function fromSlider(v: number): QualitySetting {
  return v === 0 ? 'auto' : ((v - 1) as QualitySetting)
}

export function DisplaySettings() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="display-settings" ref={rootRef}>
      <button
        id="display-settings-toggle"
        type="button"
        className={`display-settings-toggle${open ? ' display-settings-toggle--open' : ''}`}
        aria-expanded={open}
        aria-controls="display-settings-panel"
        aria-label="Display settings"
        title="Display settings"
        onClick={(e) => {
          setOpen((o) => !o)
          // Mouse click: hand the keyboard back to flight (Space would re-toggle the button).
          if (e.detail > 0) e.currentTarget.blur()
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
            transform="translate(-1 0)"
          />
        </svg>
      </button>

      {open && (
        <div id="display-settings-panel" className="display-settings-panel" role="group" aria-label="Display settings">
          <div className="display-settings-title">Display</div>
          <QualityControl />
          <div className="display-settings-title display-settings-title--sub">Sound</div>
          <SoundControl idPrefix="display" label="Volume" />
        </div>
      )}
    </div>
  )
}

/** The quality slider + what it changes. Desktop: inside the gear panel; touch: ••• More → Settings. */
export function QualityControl() {
  const setting = useQualityStore((s) => s.setting)
  const tierIndex = useQualityStore((s) => activeTierIndex(s))
  const setSetting = useQualityStore((s) => s.setSetting)
  const tier = QUALITY_TIERS[tierIndex]
  const sliderId = useId()

  const value = toSlider(setting)
  const label = setting === 'auto' ? `Auto · ${tier.name}` : tier.name

  return (
    <>
      <label htmlFor={sliderId} className="display-settings-label">
        <span>Quality</span>
        <span className="display-settings-value">{label}</span>
      </label>
      <input
        id={sliderId}
        className="quality-slider"
        type="range"
        min={0}
        max={STOPS.length - 1}
        step={1}
        value={value}
        aria-valuetext={label}
        style={{ '--control-value': `${(value / (STOPS.length - 1)) * 100}%` } as CSSProperties}
        onChange={(e) => setSetting(fromSlider(Number(e.target.value)))}
        // Mouse/touch: give the keys back to flight. Keyboard users keep focus.
        onPointerUp={(e) => e.currentTarget.blur()}
      />
      <div className="quality-stops" aria-hidden="true">
        {STOPS.map((s, i) => (
          <span key={s} className={i === value ? 'quality-stop--active' : undefined}>{s}</span>
        ))}
      </div>

      <dl className="display-settings-stats">
        <div><dt>View distance</dt><dd>{tier.fogFar.toLocaleString()} u</dd></div>
        <div><dt>Resolution</dt><dd>{Math.min(tier.dpr, window.devicePixelRatio || 1)}×</dd></div>
        <div><dt>Glow</dt><dd>{tier.bloom ? 'On' : 'Off'}</dd></div>
      </dl>

      <p className="display-settings-note">
        {setting === 'auto' && 'Auto adjusts to your frame rate. '}
        Worlds still count as sighted at {SIGHT_DISTANCE} u on every setting.
      </p>
    </>
  )
}

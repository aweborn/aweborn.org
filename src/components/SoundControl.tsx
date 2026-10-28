import { type CSSProperties } from 'react'
import { poolBand, poolLevel, type PoolBand } from '@aweborn/shared/mana-level'
import { useAudioSettings } from '../audio/audioSettings'
import { useUniverseStore } from '../stores/universeStore'

/**
 * Sound: mute + volume, and a line on what the universe sounds like right now
 * (the ambience follows the pool, so "silent" can be the pool, not a bug).
 * Desktop: the gear panel. Touch: ••• More → Settings.
 */

const BAND_NOTE: Record<PoolBand, string> = {
  high: 'The pool is full: a warm hum fills the universe.',
  medium: 'The pool is healthy: a gentle hum.',
  low: 'The pool is low: near-silence, a distant tone now and then.',
  critical: 'The pool is nearly empty: the universe has gone quiet.',
}

export function SoundControl({ idPrefix, label: title = 'Sound' }: { idPrefix: string; label?: string }) {
  const muted = useAudioSettings((s) => s.muted)
  const volume = useAudioSettings((s) => s.volume)
  const setMuted = useAudioSettings((s) => s.setMuted)
  const setVolume = useAudioSettings((s) => s.setVolume)
  const band = useUniverseStore((s) => (s.mana ? poolBand(s.mana.level ?? poolLevel(s.mana.creative, 0)) : null))
  const sliderId = `${idPrefix}-sound-volume`

  const pct = muted ? 0 : Math.round(volume * 100)
  const label = muted ? 'Muted' : `${pct}%`

  return (
    <div className="sound-control">
      <div className="display-settings-label">
        <label htmlFor={sliderId}>{title}</label>
        <span className="display-settings-value">{label}</span>
      </div>
      <div className="sound-row">
        <button
          type="button"
          id={`${idPrefix}-sound-mute`}
          className="sound-mute"
          aria-pressed={muted}
          aria-label="Mute"
          title={muted ? 'Sound off' : 'Mute'}
          onClick={(e) => {
            setMuted(!muted)
            if (e.detail > 0) e.currentTarget.blur()
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M4 9.5h3.2L12 5.2v13.6l-4.8-4.3H4z" />
            {muted ? (
              <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            ) : (
              <>
                <path d="M15 9a4.2 4.2 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                {pct > 50 && <path d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />}
              </>
            )}
          </svg>
        </button>
        <input
          id={sliderId}
          className="quality-slider sound-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          aria-valuetext={label}
          style={{ '--control-value': `${pct}%` } as CSSProperties}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          // Mouse/touch: give the keys back to flight. Keyboard users keep focus.
          onPointerUp={(e) => e.currentTarget.blur()}
        />
      </div>
      <p className="display-settings-note">{band ? BAND_NOTE[band] : 'The universe’s hum follows the pool of mana.'}</p>
    </div>
  )
}

import { type CSSProperties } from 'react'
import { poolBand, poolLevel, type PoolBand } from '@aweborn/shared/mana-level'
import { useAudioSettings } from '../audio/audioSettings'
import { useUniverseStore } from '../stores/universeStore'

/**
 * Sound: one mute, and two volumes (Music · Sounds, 2026-11-03), plus a line on
 * how the music sounds right now (the pool shapes how full it is).
 * Desktop: the gear panel. Touch: ••• More → Settings.
 */

const BAND_NOTE: Record<PoolBand, string> = {
  high: 'The pool is full: the music is lush and full.',
  medium: 'The pool is healthy: the music is calm.',
  low: 'The pool is low: the music thins to a few voices.',
  critical: 'The pool is nearly empty: one faint voice still sings.',
}

function Level({ id, name, value, muted, onChange }: { id: string; name: string; value: number; muted: boolean; onChange: (v: number) => void }) {
  const pct = Math.round(value * 100)
  const shown = muted ? 0 : pct
  const text = muted ? 'Muted' : `${pct}%`
  return (
    <div className="sound-level">
      <label htmlFor={id} className="sound-level-name">{name}</label>
      <input
        id={id}
        className="quality-slider sound-volume"
        type="range"
        min={0}
        max={100}
        step={5}
        value={shown}
        aria-valuetext={text}
        style={{ '--control-value': `${shown}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        // Mouse/touch: give the keys back to flight. Keyboard users keep focus.
        onPointerUp={(e) => e.currentTarget.blur()}
      />
      <span className="display-settings-value sound-level-value">{text}</span>
    </div>
  )
}

export function SoundControl({ idPrefix, label: title = 'Sound' }: { idPrefix: string; label?: string }) {
  const muted = useAudioSettings((s) => s.muted)
  const musicVol = useAudioSettings((s) => s.music)
  const soundsVol = useAudioSettings((s) => s.sounds)
  const setMuted = useAudioSettings((s) => s.setMuted)
  const setMusic = useAudioSettings((s) => s.setMusic)
  const setSounds = useAudioSettings((s) => s.setSounds)
  const band = useUniverseStore((s) => (s.mana ? poolBand(s.mana.level ?? poolLevel(s.mana.creative, 0)) : null))
  const loud = Math.max(musicVol, soundsVol)

  return (
    <div className="sound-control">
      <div className="display-settings-label sound-head">
        <span>{title}</span>
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
                {loud > 0.5 && <path d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />}
              </>
            )}
          </svg>
        </button>
      </div>
      <Level id={`${idPrefix}-music-volume`} name="Music" value={musicVol} muted={muted} onChange={setMusic} />
      <Level id={`${idPrefix}-sound-volume`} name="Sounds" value={soundsVol} muted={muted} onChange={setSounds} />
      <p className="display-settings-note">{band ? BAND_NOTE[band] : 'The universe’s music follows the pool of mana.'}</p>
    </div>
  )
}

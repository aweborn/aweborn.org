import { poolBand, poolLevel } from '@aweborn/shared/mana-level'
import { useUniverseStore } from '../stores/universeStore'
import { useWaveStore } from '../stores/waveStore'
import { useAudioSettings } from './audioSettings'
import { audio } from './engine'

let started = false

/**
 * Wire the sound engine to the game (Rough Draft M2). Call once on boot.
 * Creation, discovery and warp call `audio` directly where they happen.
 */
export function startAudio(): void {
  if (started) return
  started = true

  // Browsers need a gesture before sound: every tap/key retries (cheap no-op once running).
  const unlock = () => audio.unlock()
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  window.addEventListener('touchend', unlock, { capture: true, passive: true })
  window.addEventListener('keydown', unlock, { capture: true })

  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden))
  audio.setHidden(document.hidden)

  const applySettings = (s: { muted: boolean; volume: number }) => audio.setSettings(s.muted, s.volume)
  applySettings(useAudioSettings.getState())
  useAudioSettings.subscribe(applySettings)

  // The pool's level sets the ambience. Older servers don't publish `level`:
  // fall back to the creative share against the floor.
  let lastMana: unknown = null
  let lastWorld: string | null | undefined
  const onUniverse = (s: ReturnType<typeof useUniverseStore.getState>) => {
    if (s.mana && s.mana !== lastMana) {
      lastMana = s.mana
      audio.setBand(poolBand(s.mana.level ?? poolLevel(s.mana.creative, 0)))
    }
    if (s.activeWorldId !== lastWorld) {
      lastWorld = s.activeWorldId
      audio.setInSpace(!s.activeWorldId)
    }
  }
  onUniverse(useUniverseStore.getState())
  useUniverseStore.subscribe(onUniverse)

  // Every gift's wave, for everyone online.
  let lastSeq = useWaveStore.getState().seq
  useWaveStore.subscribe((s) => {
    if (s.seq === lastSeq) return
    lastSeq = s.seq
    audio.wave()
  })

  // A faint tick on buttons and tabs.
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('button, [role="tab"], [role="switch"]')
      if (el && !el.closest('[data-silent]')) audio.tick()
    },
    { capture: true },
  )

  ;(window as unknown as { awebornAudio: typeof audio }).awebornAudio = audio
}

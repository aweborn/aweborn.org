import { poolBand, poolLevel } from '@aweborn/shared/mana-level'
import { useUniverseStore } from '../stores/universeStore'
import { useWaveStore } from '../stores/waveStore'
import { useAudioSettings } from './audioSettings'
import { audio } from './engine'
import { music } from './music/director'
import { CHORDS, LEAD_VOICES, seedFromId } from '@aweborn/shared/music'

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

  const applySettings = (s: { muted: boolean; music: number; sounds: number }) => audio.setSettings(s.muted, s.music, s.sounds)
  applySettings(useAudioSettings.getState())
  useAudioSettings.subscribe(applySettings)

  // The pool's level shapes the music and creation sounds. Older servers don't
  // publish `level`: fall back to the creative share against the floor.
  let lastMana: unknown = null
  const onUniverse = (s: ReturnType<typeof useUniverseStore.getState>) => {
    if (s.mana && s.mana !== lastMana) {
      lastMana = s.mana
      audio.setBand(poolBand(s.mana.level ?? poolLevel(s.mana.creative, 0)))
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
  ;(window as unknown as { awebornMusic: typeof musicConsole }).awebornMusic = musicConsole
}

/**
 * Console previews for the music (Alex listens; agents only read meters):
 *   awebornMusic.status()          what's playing
 *   awebornMusic.band('critical')  pool level: high · medium · low · critical
 *   awebornMusic.sun(-1)           midnight … noon (+1)
 *   awebornMusic.edge(1)           the Frontier edge / Ghost feel (0 … 1)
 *   awebornMusic.home(1)           the home theme (as near Origin)
 *   awebornMusic.company(3)        players nearby (0 … 4)
 *   awebornMusic.speed(1)          flying fast (0 … 1)
 *   awebornMusic.world('any-id')   hear a world's seeded music as if inside it (null = stop)
 *   awebornMusic.seed('any-id')    see a world's seed (key, lead, swell, pace, mood)
 *   awebornMusic.render({...})     bounce to a WAV file (seconds, band, sun, world, edge, company…)
 *   awebornMusic.reset()           back to the game's own values
 */
const musicConsole = {
  status: () => music.status(),
  band: (b: 'high' | 'medium' | 'low' | 'critical') => { music.overrides.band = b; return music.status() },
  sun: (v: number) => { music.overrides.sun = Math.max(-1, Math.min(1, v)); return music.status() },
  edge: (v: number) => { music.overrides.unresolved = Math.max(0, Math.min(1, v)); return music.status() },
  home: (v: number) => { music.overrides.home = Math.max(0, Math.min(1, v)); return music.status() },
  company: (n: number) => { music.overrides.company = Math.max(0, Math.min(4, n)); return music.status() },
  speed: (v: number) => { music.overrides.speed = Math.max(0, Math.min(1, v)); return music.status() },
  world: (id: string | null) => { music.previewWorld = id; return music.status() },
  seed: (id: string) => seedFromId(id),
  /** Bounce to a WAV and download it, e.g. `render({ seconds: 90, band: 'high', sun: -1 })` or `render({ world: id })`. */
  render: async (o: import('./music/render').RenderOptions = {}) => (await import('./music/render')).downloadMusic(o),
  reset: () => { music.overrides = {}; music.previewWorld = null; return music.status() },
  chords: Object.keys(CHORDS),
  leads: LEAD_VOICES,
}

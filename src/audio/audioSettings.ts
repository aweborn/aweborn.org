import { create } from 'zustand'

/**
 * Sound settings (Rough Draft M2). Device-local, like display quality:
 * nothing leaves the browser.
 */

const KEY = 'aweborn.audio'

export interface AudioSettings {
  muted: boolean
  /** 0…1, perceptual (the engine squares it). */
  volume: number
}

const DEFAULTS: AudioSettings = { muted: false, volume: 0.7 }

function read(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<AudioSettings>
    return {
      muted: typeof v.muted === 'boolean' ? v.muted : DEFAULTS.muted,
      volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : DEFAULTS.volume,
    }
  } catch {
    return DEFAULTS
  }
}

interface AudioSettingsState extends AudioSettings {
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
}

export const useAudioSettings = create<AudioSettingsState>((set, get) => {
  const save = () => {
    const { muted, volume } = get()
    try { localStorage.setItem(KEY, JSON.stringify({ muted, volume })) } catch { /* storage blocked */ }
  }
  return {
    ...read(),
    setMuted: (muted) => { set({ muted }); save() },
    setVolume: (volume) => {
      const v = Math.min(1, Math.max(0, volume))
      // Dragging the slider up from zero unmutes, like a phone.
      set(v > 0 && get().muted ? { volume: v, muted: false } : { volume: v })
      save()
    },
  }
})

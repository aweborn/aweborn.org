import { create } from 'zustand'

/**
 * Sound settings (Rough Draft M2; split into Music + Sounds 2026-11-03).
 * Device-local, like display quality: nothing leaves the browser.
 */

const KEY = 'aweborn.audio'

export interface AudioSettings {
  muted: boolean
  /** 0…1, perceptual (the engine squares it): the always-on music, worlds' music and ambient sound. */
  music: number
  /** 0…1: everything else (creation, warp, bells, players' sound orbs, voices). */
  sounds: number
}

const DEFAULTS: AudioSettings = { muted: false, music: 0.6, sounds: 0.7 }

const unit = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback)

function read(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<AudioSettings> & { volume?: number }
    // Before the split there was one `volume`: it becomes Sounds, and Music starts from it too
    const legacy = unit(v.volume, DEFAULTS.sounds)
    return {
      muted: typeof v.muted === 'boolean' ? v.muted : DEFAULTS.muted,
      music: unit(v.music, v.volume !== undefined ? Math.min(legacy, DEFAULTS.music) : DEFAULTS.music),
      sounds: unit(v.sounds, legacy),
    }
  } catch {
    return DEFAULTS
  }
}

interface AudioSettingsState extends AudioSettings {
  setMuted: (muted: boolean) => void
  setMusic: (v: number) => void
  setSounds: (v: number) => void
}

export const useAudioSettings = create<AudioSettingsState>((set, get) => {
  const save = () => {
    const { muted, music, sounds } = get()
    try { localStorage.setItem(KEY, JSON.stringify({ muted, music, sounds })) } catch { /* storage blocked */ }
  }
  const setLevel = (key: 'music' | 'sounds') => (volume: number) => {
    const v = Math.min(1, Math.max(0, volume))
    // Dragging a slider up from zero unmutes, like a phone.
    set(v > 0 && get().muted ? { [key]: v, muted: false } : { [key]: v })
    save()
  }
  return {
    ...read(),
    setMuted: (muted) => { set({ muted }); save() },
    setMusic: setLevel('music'),
    setSounds: setLevel('sounds'),
  }
})

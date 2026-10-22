import { create } from 'zustand'

/**
 * Small HUD preferences. `showFps`: phones hide the FPS counter unless the
 * player turns it on in ••• More → Settings (desktop always shows it).
 */
const KEY_FPS = 'aweborn.showFps'

function readFps(): boolean {
  try { return localStorage.getItem(KEY_FPS) === '1' } catch { return false }
}

interface HudPrefsState {
  showFps: boolean
  setShowFps: (on: boolean) => void
}

export const useHudPrefsStore = create<HudPrefsState>((set) => ({
  showFps: readFps(),
  setShowFps: (on) => {
    try { localStorage.setItem(KEY_FPS, on ? '1' : '0') } catch { /* storage blocked */ }
    set({ showFps: on })
  },
}))

/** Opens the gift (donation) modal from anywhere; App listens for it. */
export const OPEN_GIVE_EVENT = 'aweborn:open-give'
export function openGive(): void {
  window.dispatchEvent(new Event(OPEN_GIVE_EVENT))
}

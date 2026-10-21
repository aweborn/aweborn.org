import { create } from 'zustand'

/**
 * Display quality (render distance, resolution, glow).
 *
 * Only *render* distance scales with quality. Sighting (World Index,
 * `SIGHT_DISTANCE` = 100 u) is a game rule and never changes, so a strong
 * machine sees farther but discovers nothing sooner.
 *
 * `setting` is the player's choice: `'auto'` or a fixed tier. In Auto, the
 * scene's PerformanceMonitor moves `autoTier` up while frames are fast and
 * down when they drop. After a drop, the tier it fell from becomes a ceiling
 * for the session, so Auto settles instead of see-sawing.
 */

export interface QualityTier {
  name: string
  /** Max device-pixel ratio (capped by the screen's own ratio). */
  dpr: number
  fogNear: number
  fogFar: number
  /** Camera far plane. */
  cameraFar: number
  /** Billboard LOD out to here; batched points beyond. */
  mediumDist: number
  bloom: boolean
  stars: number
  /** In-world terrain is drawn this many 32 m chunks out from the player (fog hides the edge). */
  worldChunks: number
  /**
   * Real point lights shared by the nearest planets (a fixed pool that moves).
   * Fixed per tier on purpose: in three.js a change in light count recompiles
   * every lit shader (a visible hitch), so the count only changes with the tier.
   */
  planetLights: number
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'Low', dpr: 1, fogNear: 30, fogFar: 200, cameraFar: 400, mediumDist: 150, bloom: false, stars: 1500, worldChunks: 3, planetLights: 0 },
  { name: 'Medium', dpr: 1.25, fogNear: 30, fogFar: 250, cameraFar: 500, mediumDist: 200, bloom: true, stars: 3000, worldChunks: 4, planetLights: 2 },
  { name: 'High', dpr: 1.5, fogNear: 60, fogFar: 600, cameraFar: 1000, mediumDist: 400, bloom: true, stars: 5000, worldChunks: 5, planetLights: 4 },
  { name: 'Ultra', dpr: 2, fogNear: 120, fogFar: 1500, cameraFar: 2500, mediumDist: 800, bloom: true, stars: 8000, worldChunks: 6, planetLights: 8 },
]

export type QualitySetting = 'auto' | 0 | 1 | 2 | 3
const MAX_TIER = QUALITY_TIERS.length - 1

const KEY_SETTING = 'aweborn.quality'
const KEY_AUTO = 'aweborn.quality.auto'

function readSetting(): QualitySetting {
  try {
    const v = localStorage.getItem(KEY_SETTING)
    if (v === null || v === 'auto') return 'auto'
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0 && n <= MAX_TIER) return n as QualitySetting
  } catch { /* storage blocked */ }
  return 'auto'
}

function readAutoTier(): number {
  try {
    const n = Number(localStorage.getItem(KEY_AUTO))
    if (localStorage.getItem(KEY_AUTO) !== null && Number.isInteger(n) && n >= 0 && n <= MAX_TIER) return n
  } catch { /* storage blocked */ }
  return 1 // Medium: what everyone got before settings existed
}

function save(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* storage blocked */ }
}

interface QualityState {
  setting: QualitySetting
  autoTier: number
  /** Auto never climbs to this tier again this session (it dropped from it). */
  autoCeiling: number
  setSetting: (s: QualitySetting) => void
  autoIncline: () => void
  autoDecline: () => void
}

export const useQualityStore = create<QualityState>((set, get) => ({
  setting: readSetting(),
  autoTier: readAutoTier(),
  autoCeiling: MAX_TIER + 1,

  setSetting: (setting) => {
    save(KEY_SETTING, String(setting))
    set({ setting })
  },

  autoIncline: () => {
    const { setting, autoTier, autoCeiling } = get()
    if (setting !== 'auto') return
    const next = autoTier + 1
    if (next > MAX_TIER || next >= autoCeiling) return
    save(KEY_AUTO, String(next))
    set({ autoTier: next })
  },

  autoDecline: () => {
    const { setting, autoTier } = get()
    if (setting !== 'auto' || autoTier === 0) return
    const next = autoTier - 1
    save(KEY_AUTO, String(next))
    set({ autoTier: next, autoCeiling: autoTier })
  },
}))

/** The tier index in effect right now. */
export function activeTierIndex(s: Pick<QualityState, 'setting' | 'autoTier'>): number {
  return s.setting === 'auto' ? s.autoTier : s.setting
}

/** Hook: the tier in effect right now. */
export function useQualityTier(): QualityTier {
  return useQualityStore((s) => QUALITY_TIERS[activeTierIndex(s)])
}

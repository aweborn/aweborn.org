/**
 * Aweborn — Star Mod Slots
 *
 * Manages the 4 cosmetic mod slot states for the player's star-orb.
 * Tap the key to cycle to the next option.
 *
 * Mod slots:
 *  U = Trail:   comet, sparkle, ribbon, helix, none
 *  I = Aura:    glow, pulse, rings, flame, none
 *  O = Shape:   sphere, crystal, spiral, spike, jellyfish
 *  P = Emote:   wave, SOS, beacon, celebration
 *
 * State is persisted to sessionStorage so it survives page refreshes.
 */

import { inputManager } from './InputManager'

// ── Types ────────────────────────────────────────────────────────────

export type TrailStyle = 'comet' | 'sparkle' | 'ribbon' | 'helix' | 'none'
export type AuraStyle = 'glow' | 'pulse' | 'rings' | 'flame' | 'none'
export type ShapeStyle = 'sphere' | 'crystal' | 'spiral' | 'spike' | 'jellyfish'
export type EmoteStyle = 'wave' | 'sos' | 'beacon' | 'celebration'

export interface ModSlotState {
  trail: TrailStyle
  aura: AuraStyle
  shape: ShapeStyle
  emote: EmoteStyle | null // null = no active emote
  emoteTriggered: boolean  // true for one frame when emote is triggered
}

// ── Options (cycle order) ────────────────────────────────────────────

const TRAIL_OPTIONS: TrailStyle[] = ['comet', 'sparkle', 'ribbon', 'helix', 'none']
const AURA_OPTIONS: AuraStyle[] = ['glow', 'pulse', 'rings', 'flame', 'none']
const SHAPE_OPTIONS: ShapeStyle[] = ['sphere', 'crystal', 'spiral', 'spike', 'jellyfish']
const EMOTE_OPTIONS: EmoteStyle[] = ['wave', 'sos', 'beacon', 'celebration']

// ── Storage ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'aweborn:modSlots'

function loadFromStorage(): Partial<ModSlotState> {
  try {
    const data = sessionStorage.getItem(STORAGE_KEY)
    if (data) return JSON.parse(data)
  } catch {
    // Ignore parse errors
  }
  return {}
}

function saveToStorage(state: ModSlotState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      trail: state.trail,
      aura: state.aura,
      shape: state.shape,
    }))
  } catch {
    // Ignore storage errors
  }
}

// ── Star Mod Slots Manager ───────────────────────────────────────────

class StarModSlots {
  private _state: ModSlotState

  constructor() {
    const saved = loadFromStorage()
    this._state = {
      trail: (saved.trail as TrailStyle) || 'comet',
      aura: (saved.aura as AuraStyle) || 'glow',
      shape: (saved.shape as ShapeStyle) || 'sphere',
      emote: null,
      emoteTriggered: false,
    }
  }

  /**
   * Update mod slots for one frame. Checks for key presses
   * and cycles the corresponding slot.
   */
  update(): void {
    const events = inputManager.getEvents()
    this._state.emoteTriggered = false

    if (events.justPressed.has('modTrail')) {
      this._cycleTrail()
    }
    if (events.justPressed.has('modAura')) {
      this._cycleAura()
    }
    if (events.justPressed.has('modShape')) {
      this._cycleShape()
    }
    if (events.justPressed.has('modEmote')) {
      this._triggerEmote()
    }
  }

  /** Get current mod slot state. */
  getState(): Readonly<ModSlotState> {
    return this._state
  }

  // ── Cycling ──

  private _cycleTrail(): void {
    const idx = TRAIL_OPTIONS.indexOf(this._state.trail)
    this._state.trail = TRAIL_OPTIONS[(idx + 1) % TRAIL_OPTIONS.length]
    saveToStorage(this._state)
  }

  private _cycleAura(): void {
    const idx = AURA_OPTIONS.indexOf(this._state.aura)
    this._state.aura = AURA_OPTIONS[(idx + 1) % AURA_OPTIONS.length]
    saveToStorage(this._state)
  }

  private _cycleShape(): void {
    const idx = SHAPE_OPTIONS.indexOf(this._state.shape)
    this._state.shape = SHAPE_OPTIONS[(idx + 1) % SHAPE_OPTIONS.length]
    saveToStorage(this._state)
  }

  private _triggerEmote(): void {
    const idx = this._state.emote ? EMOTE_OPTIONS.indexOf(this._state.emote) : -1
    this._state.emote = EMOTE_OPTIONS[(idx + 1) % EMOTE_OPTIONS.length]
    this._state.emoteTriggered = true
  }
}

/** Singleton star mod slots manager. */
export const starModSlots = new StarModSlots()

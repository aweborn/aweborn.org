/**
 * Aweborn — Input Manager
 *
 * Unified keyboard-first input system. Captures key events and exposes
 * an action state object. All other input methods (gamepad, touch)
 * translate to this action map.
 *
 * Two contexts:
 *  - UNIVERSE: flying through the star map
 *  - WORLD:    inside a world interior
 *
 * Usage:
 *   import { inputManager, useInput } from '../systems/InputManager'
 *   const actions = useInput()  // in a React component
 *   // or
 *   inputManager.getActions()   // outside React
 */

// ── Action Types ─────────────────────────────────────────────────────

export type InputContext = 'universe' | 'world'

/**
 * All possible player actions.
 * The same physical keys map to different semantic actions
 * depending on the context.
 */
export interface ActionState {
  // ── Navigation (Left Hand) ──
  thrust: boolean        // V
  brake: boolean         // Space
  pitchUp: boolean       // W
  pitchDown: boolean     // E
  yawLeft: boolean       // Q
  yawRight: boolean      // R
  rollLeft: boolean      // A
  rollRight: boolean     // F
  reverse: boolean       // S
  strafe: boolean        // D

  // ── Camera ──
  cameraClose: boolean   // 1
  cameraMedium: boolean  // 2
  cameraFar: boolean     // 3
  cameraCinematic: boolean // 4
  lockBehind: boolean    // Z
  freeLook: boolean      // X
  lookBehind: boolean    // C
  autoOrient: boolean    // T

  // ── Interaction (Right Hand) ──
  interact: boolean      // N
  lockOn: boolean        // J
  warp: boolean          // K
  scan: boolean          // L

  // ── Star Mod Slots ──
  modTrail: boolean      // U
  modAura: boolean       // I
  modShape: boolean      // O
  modEmote: boolean      // P

  // ── System ──
  escape: boolean        // Escape
}

/** A snapshot of which actions were just pressed this frame. */
export interface ActionEvents {
  justPressed: Set<keyof ActionState>
  justReleased: Set<keyof ActionState>
}

// ── Key → Action Mapping ─────────────────────────────────────────────

/**
 * Maps physical keys to action names.
 * In WORLD context, the same keys map to different semantic meanings
 * but we keep the same action names — the FlightController / WorldController
 * interprets them differently.
 */
const KEY_TO_ACTION: Record<string, keyof ActionState> = {
  // Left hand — navigation
  KeyV: 'thrust',
  Space: 'brake',
  KeyW: 'pitchUp',
  KeyE: 'pitchDown',
  KeyQ: 'yawLeft',
  KeyR: 'yawRight',
  KeyA: 'rollLeft',
  KeyF: 'rollRight',
  KeyS: 'reverse',
  KeyD: 'strafe',

  // Camera
  Digit1: 'cameraClose',
  Digit2: 'cameraMedium',
  Digit3: 'cameraFar',
  Digit4: 'cameraCinematic',
  KeyZ: 'lockBehind',
  KeyX: 'freeLook',
  KeyC: 'lookBehind',
  KeyT: 'autoOrient',

  // Right hand — interaction
  KeyN: 'interact',
  KeyJ: 'lockOn',
  KeyK: 'warp',
  KeyL: 'scan',

  // Star mod slots
  KeyU: 'modTrail',
  KeyI: 'modAura',
  KeyO: 'modShape',
  KeyP: 'modEmote',

  // System
  Escape: 'escape',
}

/** Keys that should prevent default browser behavior when pressed. */
const PREVENT_DEFAULT_KEYS = new Set([
  'Space',    // Prevent page scroll
  'KeyW', 'KeyE', 'KeyQ', 'KeyR', 'KeyA', 'KeyF', 'KeyS', 'KeyD',
  'KeyV', 'KeyN', 'KeyJ', 'KeyK', 'KeyL',
  'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyZ', 'KeyX', 'KeyC', 'KeyT',
  'Digit1', 'Digit2', 'Digit3', 'Digit4',
])

// ── Input Manager Singleton ──────────────────────────────────────────

function createEmptyState(): ActionState {
  return {
    thrust: false,
    brake: false,
    pitchUp: false,
    pitchDown: false,
    yawLeft: false,
    yawRight: false,
    rollLeft: false,
    rollRight: false,
    reverse: false,
    strafe: false,
    cameraClose: false,
    cameraMedium: false,
    cameraFar: false,
    cameraCinematic: false,
    lockBehind: false,
    freeLook: false,
    lookBehind: false,
    autoOrient: false,
    interact: false,
    lockOn: false,
    warp: false,
    scan: false,
    modTrail: false,
    modAura: false,
    modShape: false,
    modEmote: false,
    escape: false,
  }
}

class InputManager {
  private _state: ActionState = createEmptyState()
  private _prevState: ActionState = createEmptyState()
  private _context: InputContext = 'universe'
  private _enabled = true
  private _initialized = false
  private _justPressed = new Set<keyof ActionState>()
  private _justReleased = new Set<keyof ActionState>()

  /** Bind keyboard listeners. Call once on app mount. */
  init(): void {
    if (this._initialized) return
    this._initialized = true

    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    // Prevent stuck keys when window loses focus
    window.addEventListener('blur', this._onBlur)
  }

  /** Clean up listeners. */
  destroy(): void {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('blur', this._onBlur)
    this._initialized = false
  }

  /** Get the current held-state for all actions. */
  getActions(): Readonly<ActionState> {
    return this._state
  }

  /** Get just-pressed / just-released events for this frame. */
  getEvents(): ActionEvents {
    return {
      justPressed: this._justPressed,
      justReleased: this._justReleased,
    }
  }

  /** Call at the START of each frame to compute press/release edges. */
  beginFrame(): void {
    this._justPressed.clear()
    this._justReleased.clear()

    for (const key of Object.keys(this._state) as (keyof ActionState)[]) {
      if (this._state[key] && !this._prevState[key]) {
        this._justPressed.add(key)
      }
      if (!this._state[key] && this._prevState[key]) {
        this._justReleased.add(key)
      }
    }

    // Copy current → prev for next frame
    Object.assign(this._prevState, this._state)
  }

  /** Switch input context (universe flight ↔ world interior). */
  setContext(ctx: InputContext): void {
    this._context = ctx
    // Reset all held keys on context switch to prevent sticky inputs
    this._state = createEmptyState()
  }

  getContext(): InputContext {
    return this._context
  }

  /** Enable/disable input processing (e.g., when modals are open). */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled
    if (!enabled) {
      this._state = createEmptyState()
    }
  }

  isEnabled(): boolean {
    return this._enabled
  }

  /**
   * Set an action state from an external adapter (touch/gamepad).
   * This allows non-keyboard input sources to inject actions.
   */
  setAction(action: keyof ActionState, value: boolean): void {
    if (!this._enabled) return
    this._state[action] = value
  }

  /** Clear all action states — used by adapters on disconnect/cleanup. */
  clearAllActions(): void {
    this._state = createEmptyState()
  }

  // ── Private handlers ──

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (!this._enabled) return
    // Don't capture when user is typing in an input/textarea
    if (this._isTypingTarget(e.target)) return

    const action = KEY_TO_ACTION[e.code]
    if (action) {
      if (PREVENT_DEFAULT_KEYS.has(e.code)) {
        e.preventDefault()
      }
      this._state[action] = true
    }
  }

  private _onKeyUp = (e: KeyboardEvent): void => {
    if (!this._enabled) return

    const action = KEY_TO_ACTION[e.code]
    if (action) {
      this._state[action] = false
    }
  }

  private _onBlur = (): void => {
    // Release all keys when window loses focus
    this._state = createEmptyState()
  }

  /** Check if the event target is an input field. */
  private _isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
  }
}

/** Singleton input manager — shared across all systems. */
export const inputManager = new InputManager()

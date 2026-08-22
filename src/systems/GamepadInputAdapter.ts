/**
 * Aweborn — Gamepad Input Adapter
 *
 * Translates Gamepad API input to the InputManager action map.
 * Auto-detects gamepad connection and polls at 60Hz.
 *
 * Mapping per ROADMAP:
 *  - Left Stick X → Q/R (yaw)
 *  - Left Stick Y → W/E (pitch)
 *  - RT → V (thrust, analog pressure)
 *  - LT → Space (brake, analog)
 *  - LB/RB → A/F (roll)
 *  - A/Cross → N (interact)
 *  - Y/Triangle → J (lock-on)
 *  - X/Square (hold) → K (warp)
 *  - D-pad → U/I/O/P (mod slots)
 */

import { inputManager } from './InputManager'

// ── Standard Gamepad Button Indices ──────────────────────────────────

const BUTTON = {
  A: 0,         // A / Cross
  B: 1,         // B / Circle
  X: 2,         // X / Square
  Y: 3,         // Y / Triangle
  LB: 4,        // Left bumper
  RB: 5,        // Right bumper
  LT: 6,        // Left trigger
  RT: 7,        // Right trigger
  BACK: 8,
  START: 9,
  L3: 10,       // Left stick press
  R3: 11,       // Right stick press
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const

// ── Tuning ───────────────────────────────────────────────────────────

/** Analog stick deadzone. */
const STICK_DEADZONE = 0.15
/** Trigger deadzone. */
const TRIGGER_DEADZONE = 0.1

// ── Gamepad Input Adapter ────────────────────────────────────────────

class GamepadInputAdapter {
  private _active = false
  private _gamepadIndex: number | null = null
  private _pollId: number | null = null

  /** Check if a gamepad is currently connected. */
  static isConnected(): boolean {
    const gamepads = navigator.getGamepads()
    for (const gp of gamepads) {
      if (gp && gp.connected) return true
    }
    return false
  }

  /** Activate gamepad polling and event listeners. */
  activate(): void {
    if (this._active) return
    this._active = true

    window.addEventListener('gamepadconnected', this._onConnected)
    window.addEventListener('gamepaddisconnected', this._onDisconnected)

    // Check for already-connected gamepads
    const gamepads = navigator.getGamepads()
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]?.connected) {
        this._gamepadIndex = i
        break
      }
    }

    // Start polling
    this._startPolling()
  }

  /** Deactivate gamepad support. */
  deactivate(): void {
    if (!this._active) return
    this._active = false

    window.removeEventListener('gamepadconnected', this._onConnected)
    window.removeEventListener('gamepaddisconnected', this._onDisconnected)

    this._stopPolling()
    inputManager.clearAllActions()
    this._gamepadIndex = null
  }

  isActive(): boolean {
    return this._active
  }

  isConnected(): boolean {
    return this._gamepadIndex !== null
  }

  // ── Event handlers ──

  private _onConnected = (e: GamepadEvent): void => {
    this._gamepadIndex = e.gamepad.index
  }

  private _onDisconnected = (e: GamepadEvent): void => {
    if (this._gamepadIndex === e.gamepad.index) {
      this._gamepadIndex = null
      inputManager.clearAllActions()
    }
  }

  // ── Polling ──

  private _startPolling(): void {
    const poll = () => {
      if (!this._active) return
      this._readGamepad()
      this._pollId = requestAnimationFrame(poll)
    }
    this._pollId = requestAnimationFrame(poll)
  }

  private _stopPolling(): void {
    if (this._pollId !== null) {
      cancelAnimationFrame(this._pollId)
      this._pollId = null
    }
  }

  private _readGamepad(): void {
    if (this._gamepadIndex === null) return

    const gamepads = navigator.getGamepads()
    const gp = gamepads[this._gamepadIndex]
    if (!gp || !gp.connected) {
      this._gamepadIndex = null
      return
    }

    // ── Sticks ──
    const lx = this._applyDeadzone(gp.axes[0] ?? 0, STICK_DEADZONE)
    const ly = this._applyDeadzone(gp.axes[1] ?? 0, STICK_DEADZONE)

    // Left stick X → yaw (Q/R)
    inputManager.setAction('yawLeft', lx < -STICK_DEADZONE)
    inputManager.setAction('yawRight', lx > STICK_DEADZONE)

    // Left stick Y → pitch (W/E)
    inputManager.setAction('pitchUp', ly < -STICK_DEADZONE)
    inputManager.setAction('pitchDown', ly > STICK_DEADZONE)

    // ── Triggers ──
    const rt = gp.buttons[BUTTON.RT]?.value ?? 0
    const lt = gp.buttons[BUTTON.LT]?.value ?? 0

    // RT → thrust (analog)
    inputManager.setAction('thrust', rt > TRIGGER_DEADZONE)

    // LT → brake (analog)
    inputManager.setAction('brake', lt > TRIGGER_DEADZONE)

    // ── Bumpers → roll ──
    inputManager.setAction('rollLeft', gp.buttons[BUTTON.LB]?.pressed ?? false)
    inputManager.setAction('rollRight', gp.buttons[BUTTON.RB]?.pressed ?? false)

    // ── Face buttons ──
    inputManager.setAction('interact', gp.buttons[BUTTON.A]?.pressed ?? false)
    inputManager.setAction('lockOn', gp.buttons[BUTTON.Y]?.pressed ?? false)
    inputManager.setAction('warp', gp.buttons[BUTTON.X]?.pressed ?? false)
    inputManager.setAction('scan', gp.buttons[BUTTON.B]?.pressed ?? false)

    // ── D-pad → mod slots ──
    inputManager.setAction('modTrail', gp.buttons[BUTTON.DPAD_UP]?.pressed ?? false)
    inputManager.setAction('modAura', gp.buttons[BUTTON.DPAD_RIGHT]?.pressed ?? false)
    inputManager.setAction('modShape', gp.buttons[BUTTON.DPAD_DOWN]?.pressed ?? false)
    inputManager.setAction('modEmote', gp.buttons[BUTTON.DPAD_LEFT]?.pressed ?? false)

    // ── System ──
    inputManager.setAction('escape', gp.buttons[BUTTON.BACK]?.pressed ?? false)
  }

  private _applyDeadzone(value: number, deadzone: number): number {
    if (Math.abs(value) < deadzone) return 0
    const sign = value > 0 ? 1 : -1
    return sign * (Math.abs(value) - deadzone) / (1 - deadzone)
  }
}

/** Singleton gamepad adapter. */
export const gamepadInputAdapter = new GamepadInputAdapter()

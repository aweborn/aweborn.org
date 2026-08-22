/**
 * Aweborn — Touch Input Adapter
 *
 * Translates multi-touch events to the InputManager action map.
 * Designed for mobile: left thumb steers, right thumb thrusts.
 *
 * Touch zones:
 *  - Left 40%: virtual joystick → Q/R (yaw) + W/E (pitch)
 *  - Right 40%: hold → V (thrust)
 *  - Two-finger tap → Space (brake)
 *
 * Also renders a virtual joystick overlay via CSS.
 */

import { inputManager } from './InputManager'

// ── Tuning ───────────────────────────────────────────────────────────

/** Joystick deadzone (fraction of max displacement). */
const DEADZONE = 0.15
/** Max joystick displacement in pixels. */
const MAX_DISPLACEMENT = 60
/** Screen fraction for left zone (from left edge). */
const LEFT_ZONE_FRACTION = 0.4
/** Screen fraction for right zone (from right edge). */
const RIGHT_ZONE_FRACTION = 0.4

// ── Touch Input Adapter ──────────────────────────────────────────────

export class TouchInputAdapter {
  private _active = false
  private _leftTouchId: number | null = null
  private _rightTouchId: number | null = null
  private _leftOrigin = { x: 0, y: 0 }
  private _joystickElement: HTMLDivElement | null = null
  private _joystickKnob: HTMLDivElement | null = null
  private _overlayElement: HTMLDivElement | null = null

  /** Check if the device supports touch. */
  static isSupported(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }

  /** Activate touch input. Creates the visual joystick overlay. */
  activate(): void {
    if (this._active) return
    this._active = true

    this._createOverlay()
    window.addEventListener('touchstart', this._onTouchStart, { passive: false })
    window.addEventListener('touchmove', this._onTouchMove, { passive: false })
    window.addEventListener('touchend', this._onTouchEnd, { passive: false })
    window.addEventListener('touchcancel', this._onTouchEnd, { passive: false })
  }

  /** Deactivate touch input. Removes the joystick overlay. */
  deactivate(): void {
    if (!this._active) return
    this._active = false

    this._removeOverlay()
    window.removeEventListener('touchstart', this._onTouchStart)
    window.removeEventListener('touchmove', this._onTouchMove)
    window.removeEventListener('touchend', this._onTouchEnd)
    window.removeEventListener('touchcancel', this._onTouchEnd)

    inputManager.clearAllActions()
  }

  isActive(): boolean {
    return this._active
  }

  // ── Touch handlers ──

  private _onTouchStart = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]
      const x = touch.clientX
      const screenWidth = window.innerWidth

      // Two-finger tap = brake
      if (e.touches.length >= 2) {
        inputManager.setAction('brake', true)
        e.preventDefault()
        continue
      }

      // Left zone: start joystick
      if (x < screenWidth * LEFT_ZONE_FRACTION && this._leftTouchId === null) {
        this._leftTouchId = touch.identifier
        this._leftOrigin = { x: touch.clientX, y: touch.clientY }
        this._showJoystick(touch.clientX, touch.clientY)
        e.preventDefault()
      }

      // Right zone: thrust
      if (x > screenWidth * (1 - RIGHT_ZONE_FRACTION) && this._rightTouchId === null) {
        this._rightTouchId = touch.identifier
        inputManager.setAction('thrust', true)
        e.preventDefault()
      }
    }
  }

  private _onTouchMove = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]

      // Left joystick movement
      if (touch.identifier === this._leftTouchId) {
        const dx = touch.clientX - this._leftOrigin.x
        const dy = touch.clientY - this._leftOrigin.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const clampedDist = Math.min(dist, MAX_DISPLACEMENT)
        const normalizedDist = clampedDist / MAX_DISPLACEMENT

        if (normalizedDist > DEADZONE) {
          const angle = Math.atan2(dy, dx)
          const nx = Math.cos(angle) * normalizedDist
          const ny = Math.sin(angle) * normalizedDist

          // Horizontal → yaw (Q/R)
          inputManager.setAction('yawLeft', nx < -DEADZONE)
          inputManager.setAction('yawRight', nx > DEADZONE)

          // Vertical → pitch (W/E)
          inputManager.setAction('pitchUp', ny < -DEADZONE)
          inputManager.setAction('pitchDown', ny > DEADZONE)
        } else {
          inputManager.setAction('yawLeft', false)
          inputManager.setAction('yawRight', false)
          inputManager.setAction('pitchUp', false)
          inputManager.setAction('pitchDown', false)
        }

        // Update visual joystick position
        this._updateJoystick(
          Math.cos(Math.atan2(dy, dx)) * clampedDist,
          Math.sin(Math.atan2(dy, dx)) * clampedDist,
        )

        e.preventDefault()
      }
    }
  }

  private _onTouchEnd = (e: TouchEvent): void => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]

      // Left joystick released
      if (touch.identifier === this._leftTouchId) {
        this._leftTouchId = null
        inputManager.setAction('yawLeft', false)
        inputManager.setAction('yawRight', false)
        inputManager.setAction('pitchUp', false)
        inputManager.setAction('pitchDown', false)
        this._hideJoystick()
      }

      // Right thrust released
      if (touch.identifier === this._rightTouchId) {
        this._rightTouchId = null
        inputManager.setAction('thrust', false)
      }
    }

    // Release brake when fewer than 2 fingers
    if (e.touches.length < 2) {
      inputManager.setAction('brake', false)
    }
  }

  // ── Visual joystick overlay ──

  private _createOverlay(): void {
    this._overlayElement = document.createElement('div')
    this._overlayElement.className = 'touch-overlay'

    this._joystickElement = document.createElement('div')
    this._joystickElement.className = 'touch-joystick-base'
    this._joystickElement.style.display = 'none'

    this._joystickKnob = document.createElement('div')
    this._joystickKnob.className = 'touch-joystick-knob'

    this._joystickElement.appendChild(this._joystickKnob)
    this._overlayElement.appendChild(this._joystickElement)
    document.body.appendChild(this._overlayElement)
  }

  private _removeOverlay(): void {
    if (this._overlayElement) {
      document.body.removeChild(this._overlayElement)
      this._overlayElement = null
      this._joystickElement = null
      this._joystickKnob = null
    }
  }

  private _showJoystick(x: number, y: number): void {
    if (!this._joystickElement) return
    this._joystickElement.style.display = 'block'
    this._joystickElement.style.left = `${x - 40}px`
    this._joystickElement.style.top = `${y - 40}px`
  }

  private _hideJoystick(): void {
    if (!this._joystickElement) return
    this._joystickElement.style.display = 'none'
  }

  private _updateJoystick(dx: number, dy: number): void {
    if (!this._joystickKnob) return
    this._joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`
  }
}

/** Singleton touch adapter. */
export const touchInputAdapter = new TouchInputAdapter()

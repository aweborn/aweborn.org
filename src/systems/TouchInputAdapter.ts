/**
 * Aweborn — Touch Input Adapter
 *
 * Translates multi-touch input to the InputManager action map.
 * Designed for phones: left thumb steers, right thumb thrusts,
 * and on-screen buttons cover what the keyboard has and touch doesn't.
 *
 * Touch zones (only touches that land on the 3D canvas; UI buttons
 * keep working because their touches never reach these handlers):
 *  - Fixed analog stick, bottom-left (space: yaw / pitch; world: walk /
 *    strafe, push it to the rim → sprint). Its base never moves: touch
 *    anywhere near it and the knob follows the thumb, clamped to the rim
 *    (Alex, 2026-10-22: "the base seems to move around while I'm moving the knob").
 *  - Space, a quick tap anywhere else: lock onto the planet under the finger
 *    (tapTargeting.ts; the LOCK button is gone, 2026-10-22)
 *  - World, anywhere else: drag → look (turn / look up-down)
 *
 * On-screen buttons:
 *  - Space: THRUST (hold; slide down on it = brake) · DRIVE / NEUTRAL (G) · and, only
 *    when they'd do something, WARP (hold, K; while locked on) and ENTER (N; near a world)
 *  - World: JUMP (big, right thumb; hold in the air = jetpack) · KICK (N); hold the
 *    top-right place pill (0.6 s) to return to space
 *  The dock between the thumbs is React (TouchDock.tsx).
 *  Layout spec: docs/mobile-ui/SPEC.md (grill 2026-10-21).
 *
 * Uses Pointer Events so every finger is tracked on its own by
 * `pointerId` — steer, thrust and press a button all at once.
 * It never calls preventDefault on canvas touches: `touch-action: none`
 * on the canvas stops scrolling/zooming, and taps still become clicks.
 *
 * History: the 2026-08 version listened to `touchstart` on `window`
 * and preventDefault'ed every touch in the side zones (which killed
 * taps on buttons), turned a 2nd finger into "brake" (no steer +
 * thrust), and drove a digital stick. See Phase 04 → Mobile Play
 * Optimization.
 */

import { inputManager, shapeAxis, type ActionState } from './InputManager'
import { flightController } from './FlightController'
import { useUniverseStore } from '../stores/universeStore'
import { TURN_RATE, LOOK_RATE } from '@aweborn/shared/sim/interior'
import { warpSystem } from './WarpSystem'
import { pickWorldAt, sceneHints } from './tapTargeting'

// ── Tuning ───────────────────────────────────────────────────────────

/** Stick radius = this fraction of the short screen side, clamped below. */
const STICK_RADIUS_FRACTION = 0.16
const STICK_RADIUS_MIN = 56
const STICK_RADIUS_MAX = 80
/** A touch this far from the stick's centre (× radius) still grabs it. */
const STICK_GRAB = 1.5
/** Radial deadzone (fraction of stick radius). */
const STICK_DEADZONE = 0.1
/** Response curve exponent: >1 = small moves turn slowly. */
const STICK_EXPONENT = 1.8
/** Smoothing time constant (s) for the stick output. Kills finger jitter. */
const STICK_SMOOTHING_TAU = 0.05
/** Shortest press a tap button holds its action, so a quick tap spans a frame. */
const MIN_PULSE_MS = 90
/** THRUST button: slide this far down from where the thumb landed to switch to brake. */
const BRAKE_PULL_PX = 36
/** …and come back above this to resume thrust (hysteresis, no flicker). */
const BRAKE_RELEASE_PX = 24
/** Ring starts reddening after this much pull (px). */
const BRAKE_TINT_START_PX = 6
/** How often to check for open modals / world state (ms). */
const UI_POLL_MS = 200
/** World: stick past this fraction of its radius = sprint. */
const SPRINT_AT = 0.92
/** World: drag-to-look sensitivity (radians of view per CSS px of finger travel). */
const LOOK_RAD_PER_PX = 0.0055
/** Space: a touch this short and this still is a tap (lock onto the planet under it). */
const TAP_MAX_MS = 350
const TAP_MAX_MOVE_PX = 12

type StickState = {
  id: number
  originX: number
  originY: number
  radius: number
  /** Target (unsmoothed) axis values. */
  targetYaw: number
  targetPitch: number
}

type ButtonSpec = {
  id: string
  label: string
  action: keyof ActionState
  className: string
  ariaLabel: string
}

const BUTTONS: ButtonSpec[] = [
  // World only: the big right-thumb button (space has THRUST in this spot)
  { id: 'touch-btn-brake', label: 'JUMP', action: 'brake', className: 'touch-btn touch-btn--brake', ariaLabel: 'Jump (hold in the air for jetpack)' },
  { id: 'touch-btn-warp', label: 'WARP', action: 'warp', className: 'touch-btn touch-btn--warp', ariaLabel: 'Warp (hold to charge, release to leap)' },
  { id: 'touch-btn-enter', label: 'ENTER', action: 'interact', className: 'touch-btn touch-btn--enter', ariaLabel: 'Enter the nearby world' },
]

// ── Touch Input Adapter ──────────────────────────────────────────────

export class TouchInputAdapter {
  private _active = false
  private _stick: StickState | null = null
  private _rightStick: StickState | null = null
  private _thrustId: number | null = null
  /** Where the thrust thumb landed (y), for pull-back-to-brake. */
  private _thrustAnchorY = 0
  private _thrustBraking = false
  private _smoothYaw = 0
  private _smoothPitch = 0
  private _smoothLookYaw = 0
  private _smoothLookPitch = 0
  private _rafId: number | null = null
  private _lastTick = 0
  private _lastUiPoll = 0
  private _inWorld = false
  private _releaseTimers = new Map<keyof ActionState, number>()
  /** World: the finger dragging the view, and travel since the last frame. */
  private _look: { id: number; x: number; y: number } | null = null
  private _lookDX = 0
  private _lookDY = 0
  /** World: the stick (not the keyboard) is holding sprint. */
  private _stickSprint = false
  /** Space: a finger that may turn out to be a tap (tap a planet = lock on). */
  private _tap: { id: number; x: number; y: number; t: number } | null = null
  /** Contextual buttons' last shown state (null = not rendered yet). */
  private _warpShown: boolean | null = null
  private _enterShown: boolean | null = null
  private _warpBtn: HTMLButtonElement | null = null
  private _enterBtn: HTMLButtonElement | null = null

  private _overlay: HTMLDivElement | null = null
  private _stickBase: HTMLDivElement | null = null
  private _stickKnob: HTMLDivElement | null = null
  private _stickLabel: HTMLSpanElement | null = null
  private _rightStickBase: HTMLDivElement | null = null
  private _rightStickKnob: HTMLDivElement | null = null
  private _stickR = 0
  private _thrustBtn: HTMLButtonElement | null = null
  private _modeButton: HTMLButtonElement | null = null
  private _modeIsNeutral: boolean | null = null
  private _toast: HTMLDivElement | null = null
  private _toastTimer: number | null = null

  /** Touch-first device (primary pointer is a finger), not a touchscreen laptop. */
  static isSupported(): boolean {
    if (typeof window === 'undefined') return false
    if (window.matchMedia?.('(pointer: coarse)').matches) return true
    return navigator.maxTouchPoints > 0 && !window.matchMedia?.('(any-pointer: fine)').matches
  }

  /** Activate touch input. Creates the on-screen controls. */
  activate(): void {
    if (this._active) return
    this._active = true

    document.documentElement.classList.add('touch-ui')
    this._createOverlay()

    window.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerup', this._onPointerUp)
    window.addEventListener('pointercancel', this._onPointerUp)
    window.addEventListener('blur', this._releaseAll)
    document.addEventListener('visibilitychange', this._onVisibility)
    // iOS Safari pinch-zoom on non-canvas UI
    document.addEventListener('gesturestart', this._preventGesture as EventListener, { passive: false })

    this._lastTick = performance.now()
    this._rafId = requestAnimationFrame(this._tick)
  }

  /** Deactivate touch input. Removes the overlay. */
  deactivate(): void {
    if (!this._active) return
    this._active = false

    window.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerUp)
    window.removeEventListener('blur', this._releaseAll)
    document.removeEventListener('visibilitychange', this._onVisibility)
    document.removeEventListener('gesturestart', this._preventGesture as EventListener)

    if (this._rafId !== null) cancelAnimationFrame(this._rafId)
    this._rafId = null
    for (const t of this._releaseTimers.values()) clearTimeout(t)
    this._releaseTimers.clear()

    this._removeOverlay()
    document.documentElement.classList.remove('touch-ui')
    this._stick = null
    this._rightStick = null
    this._thrustId = null
    inputManager.clearAllActions()
  }

  isActive(): boolean {
    return this._active
  }

  // ── Canvas touches (sticks + tap/drag) ──

  /** Only touches that land on the 3D scene drive flight. */
  private _isSceneTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.canvas-container') !== null
  }

  private _onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this._isSceneTarget(e.target)) return

    // Left stick sits still (CSS places it); a touch on or near it grabs it
    const c = this._stickCenter(this._stickBase)
    if (this._stick === null && c && Math.hypot(e.clientX - c.x, e.clientY - c.y) <= c.r * STICK_GRAB) {
      this._stick = { id: e.pointerId, originX: c.x, originY: c.y, radius: c.r, targetYaw: 0, targetPitch: 0 }
      this._showStick()
      this._moveStick(e.clientX, e.clientY)
      return
    }

    // Right stick (world interior only: camera look / rotate)
    const rc = this._inWorld ? this._stickCenter(this._rightStickBase) : null
    if (this._rightStick === null && rc && Math.hypot(e.clientX - rc.x, e.clientY - rc.y) <= rc.r * STICK_GRAB) {
      this._rightStick = { id: e.pointerId, originX: rc.x, originY: rc.y, radius: rc.r, targetYaw: 0, targetPitch: 0 }
      this._showRightStick()
      this._moveRightStick(e.clientX, e.clientY)
      return
    }

    if (this._inWorld && this._look === null) {
      this._look = { id: e.pointerId, x: e.clientX, y: e.clientY }
    } else if (!this._inWorld && this._tap === null) {
      this._tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
    }
  }

  private _onPointerMove = (e: PointerEvent): void => {
    if (this._tap && e.pointerId === this._tap.id && Math.hypot(e.clientX - this._tap.x, e.clientY - this._tap.y) > TAP_MAX_MOVE_PX) {
      this._tap = null // a drag, not a tap
    }
    if (this._stick && e.pointerId === this._stick.id) {
      this._moveStick(e.clientX, e.clientY)
    } else if (this._rightStick && e.pointerId === this._rightStick.id) {
      this._moveRightStick(e.clientX, e.clientY)
    } else if (this._look && e.pointerId === this._look.id) {
      this._lookDX += e.clientX - this._look.x
      this._lookDY += e.clientY - this._look.y
      this._look.x = e.clientX
      this._look.y = e.clientY
    }
  }

  private _onPointerUp = (e: PointerEvent): void => {
    if (this._tap && e.pointerId === this._tap.id) {
      const tap = this._tap
      this._tap = null
      if (e.type === 'pointerup' && performance.now() - tap.t <= TAP_MAX_MS) {
        const id = pickWorldAt(e.clientX, e.clientY)
        if (id) warpSystem.lockOnto(id)
      }
    }
    if (this._stick && e.pointerId === this._stick.id) {
      this._stick = null
      // Instant stop on release, same as letting go of a key
      this._smoothYaw = 0
      this._smoothPitch = 0
      this._zeroStickAxes()
      this._setStickSprint(false)
      this._hideStick()
    }
    if (this._rightStick && e.pointerId === this._rightStick.id) {
      this._rightStick = null
      this._smoothLookYaw = 0
      this._smoothLookPitch = 0
      this._zeroRightStickAxes()
      this._hideRightStick()
    }
    if (this._look && e.pointerId === this._look.id) {
      this._look = null
      this._lookDX = 0
      this._lookDY = 0
      inputManager.setAxis('yaw', 0, 'touch')
      inputManager.setAxis('pitch', 0, 'touch')
    }
  }

  private _zeroStickAxes(): void {
    inputManager.setAxis('yaw', 0, 'touch')
    inputManager.setAxis('pitch', 0, 'touch')
    inputManager.setAxis('moveX', 0, 'touch')
    inputManager.setAxis('moveY', 0, 'touch')
  }

  private _zeroRightStickAxes(): void {
    inputManager.setAxis('lookYaw', 0, 'touch')
    inputManager.setAxis('lookPitch', 0, 'touch')
  }

  /** World: sprint while the stick is pushed to its rim (never cancels a held K key). */
  private _setStickSprint(on: boolean): void {
    if (on === this._stickSprint) return
    this._stickSprint = on
    inputManager.setAction('warp', on)
    this._stickBase?.classList.toggle('touch-joystick-base--sprint', on)
  }

  /** Slide the thumb down on THRUST to brake; slide back up to thrust again. */
  private _updateThrustPull(y: number): void {
    const pull = y - this._thrustAnchorY
    if (!this._thrustBraking && pull >= BRAKE_PULL_PX) {
      this._thrustBraking = true
      inputManager.setAction('thrust', false)
      inputManager.setAction('brake', true)
      this._thrustBtn?.classList.add('touch-btn--braking')
    } else if (this._thrustBraking && pull < BRAKE_RELEASE_PX) {
      this._endThrustBrake()
      inputManager.setAction('thrust', true)
    }
    const t = clamp((pull - BRAKE_TINT_START_PX) / (BRAKE_PULL_PX - BRAKE_TINT_START_PX), 0, 1)
    this._thrustBtn?.style.setProperty('--pull', t.toFixed(3))
  }

  private _endThrustBrake(): void {
    if (!this._thrustBraking) return
    this._thrustBraking = false
    this._thrustBtn?.classList.remove('touch-btn--braking')
    inputManager.setAction('brake', false)
  }

  /** THRUST: its own finger (pointer capture), so steering and other buttons work at once. */
  private _bindThrust(el: HTMLButtonElement): void {
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this._thrustId) return
      this._thrustId = null
      inputManager.setAction('thrust', false)
      this._endThrustBrake()
      el.classList.remove('touch-btn--pressed')
      el.style.setProperty('--pull', '0')
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this._thrustId !== null) return
      this._thrustId = e.pointerId
      this._thrustAnchorY = e.clientY
      this._thrustBraking = false
      try { el.setPointerCapture(e.pointerId) } catch { /* already gone */ }
      el.classList.add('touch-btn--pressed')
      inputManager.setAction('thrust', true)
    })
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this._thrustId) this._updateThrustPull(e.clientY)
    })
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private _moveStick(x: number, y: number): void {
    const s = this._stick
    if (!s) return
    let dx = x - s.originX
    let dy = y - s.originY
    let dist = Math.hypot(dx, dy)

    // Fixed base: past the rim the knob stays on the rim (full deflection)
    if (dist > s.radius) {
      dx = (dx / dist) * s.radius
      dy = (dy / dist) * s.radius
      dist = s.radius
    }

    const shaped = shapeAxis(dist / s.radius, STICK_DEADZONE, STICK_EXPONENT)
    if (dist > 0 && shaped > 0) {
      s.targetYaw = (dx / dist) * shaped
      s.targetPitch = -(dy / dist) * shaped // screen up = nose up (world: forward)
    } else {
      s.targetYaw = 0
      s.targetPitch = 0
    }
    if (this._inWorld) this._setStickSprint(dist >= s.radius * SPRINT_AT)

    if (this._stickKnob) this._stickKnob.style.transform = `translate(${dx}px, ${dy}px)`
  }

  private _moveRightStick(x: number, y: number): void {
    const s = this._rightStick
    if (!s) return
    let dx = x - s.originX
    let dy = y - s.originY
    let dist = Math.hypot(dx, dy)

    if (dist > s.radius) {
      dx = (dx / dist) * s.radius
      dy = (dy / dist) * s.radius
      dist = s.radius
    }

    const shaped = shapeAxis(dist / s.radius, STICK_DEADZONE, STICK_EXPONENT)
    if (dist > 0 && shaped > 0) {
      s.targetYaw = (dx / dist) * shaped
      s.targetPitch = -(dy / dist) * shaped // screen up = look up
    } else {
      s.targetYaw = 0
      s.targetPitch = 0
    }

    if (this._rightStickKnob) this._rightStickKnob.style.transform = `translate(${dx}px, ${dy}px)`
  }

  /** Centre and radius of a stick as laid out by CSS (null while hidden). */
  private _stickCenter(base: HTMLDivElement | null): { x: number; y: number; r: number } | null {
    const r = base?.getBoundingClientRect()
    if (!r || r.width === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }
  }

  private _stickRadius(): number {
    const short = Math.min(window.innerWidth, window.innerHeight)
    return clamp(Math.round(short * STICK_RADIUS_FRACTION), STICK_RADIUS_MIN, STICK_RADIUS_MAX)
  }

  /** CSS sizes the stick from --stick-r; keep it in step with the screen (rotation). */
  private _syncStickSize(): void {
    const r = this._stickRadius()
    if (r === this._stickR || !this._overlay) return
    this._stickR = r
    this._overlay.style.setProperty('--stick-r', `${r}px`)
  }

  // ── Per-frame: smoothing + UI state ──

  private _tick = (now: number): void => {
    if (!this._active) return
    const dt = Math.min((now - this._lastTick) / 1000, 0.1)
    this._lastTick = now

    if (this._stick) {
      const k = 1 - Math.exp(-dt / STICK_SMOOTHING_TAU)
      this._smoothYaw += (this._stick.targetYaw - this._smoothYaw) * k
      this._smoothPitch += (this._stick.targetPitch - this._smoothPitch) * k
      // World: the stick walks (x = strafe, y = forward); space: it steers
      inputManager.setAxis(this._inWorld ? 'moveX' : 'yaw', this._smoothYaw, 'touch')
      inputManager.setAxis(this._inWorld ? 'moveY' : 'pitch', this._smoothPitch, 'touch')
    }

    if (this._rightStick) {
      const k = 1 - Math.exp(-dt / STICK_SMOOTHING_TAU)
      this._smoothLookYaw += (this._rightStick.targetYaw - this._smoothLookYaw) * k
      this._smoothLookPitch += (this._rightStick.targetPitch - this._smoothLookPitch) * k
      inputManager.setAxis('lookYaw', this._smoothLookYaw, 'touch')
      inputManager.setAxis('lookPitch', this._smoothLookPitch, 'touch')
    }

    // World drag-look: turn this frame's finger travel into the sim's turn/look rate
    // (the interior sim takes rates, so a frame's rotation = rate × RATE × dt).
    if (this._look && dt > 0) {
      const turn = (this._lookDX * LOOK_RAD_PER_PX) / (TURN_RATE * dt)
      const look = (-this._lookDY * LOOK_RAD_PER_PX) / (LOOK_RATE * dt) // drag up = look up
      inputManager.setAxis('yaw', turn, 'touch')
      inputManager.setAxis('pitch', look, 'touch')
      this._lookDX = 0
      this._lookDY = 0
    }

    // DRIVE/NEUTRAL label follows the real state (the G key can flip it too)
    const neutral = flightController.isGravityEnabled()
    if (neutral !== this._modeIsNeutral) this._renderMode(neutral)

    // Contextual buttons (space): WARP while locked on (or charging), ENTER near a world
    if (!this._inWorld) {
      const phase = warpSystem.getState().phase
      this._showContextual('warp', phase === 'locked' || phase === 'charging')
      this._showContextual('enter', sceneHints.canEnter)
    }

    if (now - this._lastUiPoll > UI_POLL_MS) {
      this._lastUiPoll = now
      this._syncVisibility()
    }

    this._rafId = requestAnimationFrame(this._tick)
  }

  /** Space's contextual buttons fade in only when they'd do something (SPEC: "only when actionable"). */
  private _showContextual(which: 'warp' | 'enter', on: boolean): void {
    const btn = which === 'warp' ? this._warpBtn : this._enterBtn
    const shown = which === 'warp' ? this._warpShown : this._enterShown
    if (!btn || on === shown) return
    if (which === 'warp') this._warpShown = on
    else this._enterShown = on
    btn.classList.toggle('touch-btn--off', !on)
    btn.setAttribute('aria-hidden', String(!on))
    btn.tabIndex = on ? 0 : -1
  }

  /** Inside worlds: walking layout (JUMP big under the thumb, KICK above it); hide behind modals. */
  private _syncVisibility(): void {
    if (!this._overlay) return
    this._syncStickSize()
    const inWorld = useUniverseStore.getState().activeWorldId !== null
    const modalOpen = document.querySelector('dialog[open], .modal-backdrop') !== null
    if (inWorld !== this._inWorld) {
      // The thumbs mean different things now: drop whatever they were holding
      this._releaseAll()
      this._inWorld = inWorld
      // KICK (the same button) is always there inside a world; space re-decides both
      this._enterBtn?.classList.remove('touch-btn--off')
      this._enterBtn?.removeAttribute('aria-hidden')
      this._enterShown = null
      this._warpShown = null
      const enter = this._overlay.querySelector<HTMLButtonElement>('#touch-btn-enter')
      if (enter) {
        enter.textContent = inWorld ? 'KICK' : 'ENTER'
        enter.setAttribute('aria-label', inWorld ? 'Kick the object in front of you' : 'Enter the nearby world')
      }
      if (this._stickLabel) this._stickLabel.textContent = inWorld ? 'MOVE' : 'STEER'
    }
    this._overlay.classList.toggle('touch-overlay--in-world', inWorld)
    this._overlay.classList.toggle('touch-overlay--hidden', modalOpen)
  }

  private _releaseAll = (): void => {
    this._stick = null
    this._rightStick = null
    this._tap = null
    this._look = null
    this._lookDX = 0
    this._lookDY = 0
    this._stickSprint = false
    this._stickBase?.classList.remove('touch-joystick-base--sprint')
    this._thrustId = null
    this._thrustBraking = false
    this._thrustBtn?.classList.remove('touch-btn--braking')
    this._thrustBtn?.style.setProperty('--pull', '0')
    this._smoothYaw = 0
    this._smoothPitch = 0
    this._smoothLookYaw = 0
    this._smoothLookPitch = 0
    this._hideStick()
    this._hideRightStick()
    inputManager.clearAllActions()
    this._overlay?.querySelectorAll('.touch-btn--pressed').forEach((el) => el.classList.remove('touch-btn--pressed'))
  }

  private _onVisibility = (): void => {
    if (document.hidden) this._releaseAll()
  }

  private _preventGesture = (e: Event): void => {
    e.preventDefault()
  }

  // ── On-screen buttons ──

  /**
   * Wire a button to an action. Each button tracks its own finger
   * (pointer capture), so it works while the other thumbs are down.
   */
  private _bindButton(el: HTMLButtonElement, action: keyof ActionState): void {
    let pressId: number | null = null
    let downAt = 0

    const release = () => {
      if (pressId === null) return
      pressId = null
      el.classList.remove('touch-btn--pressed')
      const wait = Math.max(0, MIN_PULSE_MS - (performance.now() - downAt))
      const prev = this._releaseTimers.get(action)
      if (prev !== undefined) clearTimeout(prev)
      this._releaseTimers.set(action, window.setTimeout(() => {
        this._releaseTimers.delete(action)
        if (action === 'brake' && this._thrustBraking) return // thumb still pulling back
        inputManager.setAction(action, false)
      }, wait))
    }

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (pressId !== null) return
      pressId = e.pointerId
      downAt = performance.now()
      try { el.setPointerCapture(e.pointerId) } catch { /* already gone */ }
      el.classList.add('touch-btn--pressed')
      const prev = this._releaseTimers.get(action)
      if (prev !== undefined) { clearTimeout(prev); this._releaseTimers.delete(action) }
      inputManager.setAction(action, true)
    })
    el.addEventListener('pointerup', (e) => { if (e.pointerId === pressId) release() })
    el.addEventListener('pointercancel', (e) => { if (e.pointerId === pressId) release() })
    el.addEventListener('lostpointercapture', (e) => { if (e.pointerId === pressId) release() })
    // Keyboard / assistive activation (Enter/Space on a focused button)
    el.addEventListener('click', (e) => {
      if (e.detail !== 0) return // real pointer clicks are handled above
      downAt = performance.now()
      pressId = -1
      inputManager.setAction(action, true)
      release()
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private _makeButton(spec: ButtonSpec): HTMLButtonElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.id = spec.id
    el.className = spec.className
    el.textContent = spec.label
    el.setAttribute('aria-label', spec.ariaLabel)
    this._bindButton(el, spec.action)
    return el
  }

  private _renderMode(neutral: boolean): void {
    this._modeIsNeutral = neutral
    if (!this._modeButton) return
    this._modeButton.textContent = neutral ? '◉ NEUTRAL' : '⬡ DRIVE'
    this._modeButton.classList.toggle('touch-mode-toggle--neutral', neutral)
    this._modeButton.setAttribute('aria-label', `Flight mode: ${neutral ? 'Neutral (gravity on)' : 'Drive'}. Tap to switch.`)
  }

  // ── Overlay DOM ──

  private _createOverlay(): void {
    const overlay = document.createElement('div')
    overlay.className = 'touch-overlay'

    // Fixed sticks: CSS places and sizes them (--stick-r); only the knobs move
    // (by transform, no CSS transition = no lag/jitter). Always visible, so they
    // are their own hints.
    const base = document.createElement('div')
    base.id = 'touch-stick-left'
    base.className = 'touch-joystick-base touch-joystick-base--left'
    const label = document.createElement('span')
    label.className = 'touch-joystick-label'
    label.textContent = 'STEER'
    const knob = document.createElement('div')
    knob.className = 'touch-joystick-knob'
    base.append(label, knob)

    const rightBase = document.createElement('div')
    rightBase.id = 'touch-stick-right'
    rightBase.className = 'touch-joystick-base touch-joystick-base--right'
    const rightLabel = document.createElement('span')
    rightLabel.className = 'touch-joystick-label'
    rightLabel.textContent = 'LOOK'
    const rightKnob = document.createElement('div')
    rightKnob.className = 'touch-joystick-knob'
    rightBase.append(rightLabel, rightKnob)

    // Action buttons (surrounding the right joystick)
    const cluster = document.createElement('div')
    cluster.className = 'touch-actions'
    for (const spec of BUTTONS) cluster.appendChild(this._makeButton(spec))

    // THRUST (space): the big right-thumb button; slide down on it to brake
    const thrust = document.createElement('button')
    thrust.type = 'button'
    thrust.id = 'touch-btn-thrust'
    thrust.className = 'touch-btn touch-btn--thrust'
    thrust.innerHTML = 'THRUST<span class="touch-btn-sub" aria-hidden="true">↓ brake</span>'
    thrust.setAttribute('aria-label', 'Thrust (hold; slide down to brake)')
    this._bindThrust(thrust)
    cluster.appendChild(thrust)

    // Mode toggle (top of the right-thumb cluster)
    const mode = document.createElement('button')
    mode.type = 'button'
    mode.id = 'touch-btn-mode'
    mode.className = 'touch-mode-toggle'
    this._bindButton(mode, 'gravityToggle')
    cluster.prepend(mode)

    overlay.append(base, rightBase, cluster)

    // Fullscreen lives in ••• More (2026-10-22); the toast here explains the
    // iPhone case. Not needed when already running as an installed app.
    if (!isStandalone()) {
      const toast = document.createElement('div')
      toast.className = 'touch-toast'
      toast.setAttribute('role', 'status')
      overlay.append(toast)
      this._toast = toast
    }

    document.body.appendChild(overlay)

    this._overlay = overlay
    this._stickBase = base
    this._stickKnob = knob
    this._stickLabel = label
    this._rightStickBase = rightBase
    this._rightStickKnob = rightKnob
    this._stickR = 0
    this._thrustBtn = thrust
    this._warpBtn = cluster.querySelector<HTMLButtonElement>('#touch-btn-warp')
    this._enterBtn = cluster.querySelector<HTMLButtonElement>('#touch-btn-enter')
    this._warpShown = null
    this._enterShown = null
    this._modeButton = mode
    this._modeIsNeutral = null
    this._renderMode(flightController.isGravityEnabled())
    this._syncVisibility()
  }

  // ── Fullscreen ──

  /** Enter / leave full screen (••• More → Settings). */
  toggleFullscreen = async (): Promise<void> => {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }

    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => { })
      return
    }

    if (!fullscreenSupported()) {
      // iPhone Safari: pages can't go fullscreen; an installed web app can.
      this._showToast('For full screen: tap Share, then “Add to Home Screen”, and open Aweborn from there.')
      return
    }

    try {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' })
      else await root.webkitRequestFullscreen?.()
      // No orientation lock any more: the layout is portrait-first (AGENTS.md).
    } catch {
      this._showToast('Full screen isn’t available here.')
    }
  }

  private _showToast(text: string): void {
    if (!this._toast) return
    this._toast.textContent = text
    this._toast.classList.add('touch-toast--visible')
    if (this._toastTimer !== null) clearTimeout(this._toastTimer)
    this._toastTimer = window.setTimeout(() => {
      this._toast?.classList.remove('touch-toast--visible')
      this._toastTimer = null
    }, 5000)
  }

  private _removeOverlay(): void {
    if (this._toastTimer !== null) clearTimeout(this._toastTimer)
    this._toastTimer = null
    this._overlay?.remove()
    this._overlay = null
    this._toast = null
    this._stickBase = null
    this._stickKnob = null
    this._stickLabel = null
    this._rightStickBase = null
    this._rightStickKnob = null
    this._thrustBtn = null
    this._warpBtn = null
    this._enterBtn = null
    this._modeButton = null
  }

  private _showStick(): void {
    this._stickBase?.classList.add('touch-joystick-base--active')
    this._overlay?.classList.add('touch-overlay--steering')
  }

  private _hideStick(): void {
    this._stickBase?.classList.remove('touch-joystick-base--active')
    if (this._stickKnob) this._stickKnob.style.transform = 'translate(0px, 0px)'
    this._overlay?.classList.remove('touch-overlay--steering')
  }

  private _showRightStick(): void {
    this._rightStickBase?.classList.add('touch-joystick-base--active')
    this._overlay?.classList.add('touch-overlay--looking')
  }

  private _hideRightStick(): void {
    this._rightStickBase?.classList.remove('touch-joystick-base--active')
    if (this._rightStickKnob) this._rightStickKnob.style.transform = 'translate(0px, 0px)'
    this._overlay?.classList.remove('touch-overlay--looking')
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Element fullscreen exists (Android Chrome, iPad, desktop; not iPhone Safari). */
function fullscreenSupported(): boolean {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean }
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)
}

/** The page is in element fullscreen right now. */
export function isFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element }
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement)
}

/** Launched from the home screen as an installed web app (already fullscreen-ish). */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Singleton touch adapter. */
export const touchInputAdapter = new TouchInputAdapter()

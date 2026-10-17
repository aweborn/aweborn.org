/**
 * Aweborn — Touch Input Adapter
 *
 * Translates multi-touch input to the InputManager action map.
 * Designed for phones: left thumb steers, right thumb thrusts,
 * and on-screen buttons cover what the keyboard has and touch doesn't.
 *
 * Touch zones (only touches that land on the 3D canvas; UI buttons
 * keep working because their touches never reach these handlers):
 *  - Left half:  floating analog stick → yaw / pitch axes
 *  - Right half: hold → thrust; pull the thumb back (down) → brake
 *
 * On-screen buttons:
 *  - BRAKE (hold, Space) · LOCK (J) · WARP (hold, K) · ENTER (N)
 *  - DRIVE / NEUTRAL (G) · EXIT (Escape, inside a world)
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

// ── Tuning ───────────────────────────────────────────────────────────

/** Stick radius = this fraction of the short screen side, clamped below. */
const STICK_RADIUS_FRACTION = 0.16
const STICK_RADIUS_MIN = 56
const STICK_RADIUS_MAX = 80
/** Radial deadzone (fraction of stick radius). */
const STICK_DEADZONE = 0.1
/** Response curve exponent: >1 = small moves turn slowly. */
const STICK_EXPONENT = 1.8
/** Smoothing time constant (s) for the stick output. Kills finger jitter. */
const STICK_SMOOTHING_TAU = 0.05
/** Shortest press a tap button holds its action, so a quick tap spans a frame. */
const MIN_PULSE_MS = 90
/** Thrust thumb: pull this far down from where it landed to switch to brake. */
const BRAKE_PULL_PX = 36
/** …and come back above this to resume thrust (hysteresis, no flicker). */
const BRAKE_RELEASE_PX = 24
/** Ring starts reddening after this much pull (px). */
const BRAKE_TINT_START_PX = 6
/** How often to check for open modals / world state (ms). */
const UI_POLL_MS = 200

const svgIcon = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
const FULLSCREEN_ENTER_ICON = svgIcon('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5')
const FULLSCREEN_EXIT_ICON = svgIcon('M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5')

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
  { id: 'touch-btn-brake', label: 'BRAKE', action: 'brake', className: 'touch-btn touch-btn--brake', ariaLabel: 'Brake (hold)' },
  { id: 'touch-btn-warp', label: 'WARP', action: 'warp', className: 'touch-btn touch-btn--warp', ariaLabel: 'Warp (hold to charge, release to leap)' },
  { id: 'touch-btn-lock', label: 'LOCK', action: 'lockOn', className: 'touch-btn touch-btn--lock', ariaLabel: 'Lock on to a world (tap again to cycle)' },
  { id: 'touch-btn-enter', label: 'ENTER', action: 'interact', className: 'touch-btn touch-btn--enter', ariaLabel: 'Enter the nearby world' },
]

// ── Touch Input Adapter ──────────────────────────────────────────────

export class TouchInputAdapter {
  private _active = false
  private _stick: StickState | null = null
  private _thrustId: number | null = null
  /** Where the thrust thumb landed (y), for pull-back-to-brake. */
  private _thrustAnchorY = 0
  private _thrustBraking = false
  private _smoothYaw = 0
  private _smoothPitch = 0
  private _rafId: number | null = null
  private _lastTick = 0
  private _lastUiPoll = 0
  private _inWorld = false
  private _releaseTimers = new Map<keyof ActionState, number>()

  private _overlay: HTMLDivElement | null = null
  private _stickBase: HTMLDivElement | null = null
  private _stickKnob: HTMLDivElement | null = null
  private _thrustRing: HTMLDivElement | null = null
  private _modeButton: HTMLButtonElement | null = null
  private _modeIsNeutral: boolean | null = null
  private _fullscreenButton: HTMLButtonElement | null = null
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
    this._thrustId = null
    inputManager.clearAllActions()
  }

  isActive(): boolean {
    return this._active
  }

  // ── Canvas touches (stick + thrust) ──

  /** Only touches that land on the 3D scene drive flight. */
  private _isSceneTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.canvas-container') !== null
  }

  private _onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || !this._isSceneTarget(e.target)) return

    const leftHalf = e.clientX < window.innerWidth / 2

    if (leftHalf && this._stick === null) {
      const radius = this._stickRadius()
      // Keep the whole stick on screen
      const margin = radius + 8
      const originX = clamp(e.clientX, margin, window.innerWidth - margin)
      const originY = clamp(e.clientY, margin, window.innerHeight - margin)
      this._stick = { id: e.pointerId, originX, originY, radius, targetYaw: 0, targetPitch: 0 }
      this._showStick()
      this._moveStick(e.clientX, e.clientY)
      return
    }

    if (!leftHalf && this._thrustId === null) {
      this._thrustId = e.pointerId
      this._thrustAnchorY = e.clientY
      this._thrustBraking = false
      inputManager.setAction('thrust', true)
      this._showThrust(e.clientX, e.clientY)
    }
  }

  private _onPointerMove = (e: PointerEvent): void => {
    if (this._stick && e.pointerId === this._stick.id) {
      this._moveStick(e.clientX, e.clientY)
    } else if (e.pointerId === this._thrustId) {
      this._updateThrustPull(e.clientY)
      this._showThrust(e.clientX, e.clientY)
    }
  }

  private _onPointerUp = (e: PointerEvent): void => {
    if (this._stick && e.pointerId === this._stick.id) {
      this._stick = null
      // Instant stop on release, same as letting go of a key
      this._smoothYaw = 0
      this._smoothPitch = 0
      inputManager.setAxis('yaw', 0, 'touch')
      inputManager.setAxis('pitch', 0, 'touch')
      this._hideStick()
    }
    if (e.pointerId === this._thrustId) {
      this._thrustId = null
      inputManager.setAction('thrust', false)
      this._endThrustBrake()
      this._hideThrust()
    }
  }

  /**
   * Pull the thrust thumb back (down) to brake; push it back up to thrust.
   * Inside a world the pull walks backward instead (brake = jump there).
   */
  private _updateThrustPull(y: number): void {
    const pull = y - this._thrustAnchorY
    const pullAction = this._inWorld ? 'reverse' : 'brake'
    if (!this._thrustBraking && pull >= BRAKE_PULL_PX) {
      this._thrustBraking = true
      inputManager.setAction('thrust', false)
      inputManager.setAction(pullAction, true)
      this._thrustRing?.classList.add('touch-thrust-ring--braking')
    } else if (this._thrustBraking && pull < BRAKE_RELEASE_PX) {
      this._endThrustBrake()
      inputManager.setAction('thrust', true)
    }
    const t = clamp((pull - BRAKE_TINT_START_PX) / (BRAKE_PULL_PX - BRAKE_TINT_START_PX), 0, 1)
    this._thrustRing?.style.setProperty('--pull', t.toFixed(3))
  }

  private _endThrustBrake(): void {
    if (!this._thrustBraking) return
    this._thrustBraking = false
    this._thrustRing?.classList.remove('touch-thrust-ring--braking')
    inputManager.setAction('reverse', false)
    // Don't cancel a brake the BRAKE button is still holding
    const buttonHeld = this._overlay?.querySelector('#touch-btn-brake.touch-btn--pressed') !== null
    if (!buttonHeld) inputManager.setAction('brake', false)
  }

  private _moveStick(x: number, y: number): void {
    const s = this._stick
    if (!s) return
    let dx = x - s.originX
    let dy = y - s.originY
    let dist = Math.hypot(dx, dy)

    // Floating origin: if the thumb runs past the rim, drag the base along
    if (dist > s.radius) {
      const excess = dist - s.radius
      s.originX += (dx / dist) * excess
      s.originY += (dy / dist) * excess
      dx = x - s.originX
      dy = y - s.originY
      dist = s.radius
    }

    const shaped = shapeAxis(dist / s.radius, STICK_DEADZONE, STICK_EXPONENT)
    if (dist > 0 && shaped > 0) {
      s.targetYaw = (dx / dist) * shaped
      s.targetPitch = -(dy / dist) * shaped // screen up = nose up
    } else {
      s.targetYaw = 0
      s.targetPitch = 0
    }

    if (this._stickBase && this._stickKnob) {
      this._stickBase.style.transform = `translate(${s.originX - s.radius}px, ${s.originY - s.radius}px)`
      this._stickKnob.style.transform = `translate(${dx}px, ${dy}px)`
    }
  }

  private _stickRadius(): number {
    const short = Math.min(window.innerWidth, window.innerHeight)
    return clamp(Math.round(short * STICK_RADIUS_FRACTION), STICK_RADIUS_MIN, STICK_RADIUS_MAX)
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
      inputManager.setAxis('yaw', this._smoothYaw, 'touch')
      inputManager.setAxis('pitch', this._smoothPitch, 'touch')
    }

    // DRIVE/NEUTRAL label follows the real state (the G key can flip it too)
    const neutral = flightController.isGravityEnabled()
    if (neutral !== this._modeIsNeutral) this._renderMode(neutral)

    if (now - this._lastUiPoll > UI_POLL_MS) {
      this._lastUiPoll = now
      this._syncVisibility()
    }

    this._rafId = requestAnimationFrame(this._tick)
  }

  /** Inside worlds: relabel for walking (BRAKE→JUMP, WARP→SPRINT); hide behind modals. */
  private _syncVisibility(): void {
    if (!this._overlay) return
    const inWorld = useUniverseStore.getState().activeWorldId !== null
    const modalOpen = document.querySelector('dialog[open], .modal-backdrop') !== null
    if (inWorld !== this._inWorld) {
      this._inWorld = inWorld
      const label = (id: string, text: string, aria: string) => {
        const el = this._overlay?.querySelector<HTMLButtonElement>(`#${id}`)
        if (el) { el.textContent = text; el.setAttribute('aria-label', aria) }
      }
      if (inWorld) {
        label('touch-btn-brake', 'JUMP', 'Jump (hold in the air for jetpack)')
        label('touch-btn-warp', 'SPRINT', 'Sprint (hold)')
      } else {
        label('touch-btn-brake', 'BRAKE', 'Brake (hold)')
        label('touch-btn-warp', 'WARP', 'Warp (hold to charge, release to leap)')
      }
    }
    this._overlay.classList.toggle('touch-overlay--in-world', inWorld)
    this._overlay.classList.toggle('touch-overlay--hidden', modalOpen)
  }

  private _releaseAll = (): void => {
    this._stick = null
    this._thrustId = null
    this._thrustBraking = false
    this._thrustRing?.classList.remove('touch-thrust-ring--braking')
    this._smoothYaw = 0
    this._smoothPitch = 0
    this._hideStick()
    this._hideThrust()
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

    // Idle hints so first-time players know where the thumbs go
    const steerHint = document.createElement('div')
    steerHint.className = 'touch-hint touch-hint--steer'
    steerHint.textContent = 'STEER'
    const thrustHint = document.createElement('div')
    thrustHint.className = 'touch-hint touch-hint--thrust'
    thrustHint.innerHTML = 'HOLD TO THRUST<br><span class="touch-hint-sub">PULL BACK TO BRAKE</span>'

    // Stick (positioned with transforms; no CSS transition = no lag/jitter)
    const base = document.createElement('div')
    base.className = 'touch-joystick-base'
    const knob = document.createElement('div')
    knob.className = 'touch-joystick-knob'
    base.appendChild(knob)

    const ring = document.createElement('div')
    ring.className = 'touch-thrust-ring'

    // Action buttons (right thumb)
    const cluster = document.createElement('div')
    cluster.className = 'touch-actions'
    for (const spec of BUTTONS) cluster.appendChild(this._makeButton(spec))

    // Mode toggle (top of the right-thumb cluster)
    const mode = document.createElement('button')
    mode.type = 'button'
    mode.id = 'touch-btn-mode'
    mode.className = 'touch-mode-toggle'
    this._bindButton(mode, 'gravityToggle')
    cluster.prepend(mode)

    // Exit (inside worlds)
    const exit = this._makeButton({
      id: 'touch-btn-exit', label: '✕ EXIT', action: 'escape',
      className: 'touch-btn touch-btn--exit', ariaLabel: 'Exit world',
    })

    overlay.append(steerHint, thrustHint, base, ring, cluster, exit)

    // Fullscreen (hidden when already running as an installed app)
    if (!isStandalone()) {
      const fs = document.createElement('button')
      fs.type = 'button'
      fs.id = 'touch-btn-fullscreen'
      fs.className = 'touch-fullscreen'
      fs.addEventListener('click', this._onFullscreenClick)
      document.addEventListener('fullscreenchange', this._renderFullscreen)
      document.addEventListener('webkitfullscreenchange', this._renderFullscreen)
      overlay.append(fs)
      this._fullscreenButton = fs

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
    this._thrustRing = ring
    this._modeButton = mode
    this._modeIsNeutral = null
    this._renderMode(flightController.isGravityEnabled())
    this._renderFullscreen()
    this._syncVisibility()
  }

  // ── Fullscreen ──

  private _onFullscreenClick = async (): Promise<void> => {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
    const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }

    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch(() => {})
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
      // Android: also pin landscape while fullscreen (not supported everywhere)
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      await orientation?.lock?.('landscape').catch(() => {})
    } catch {
      this._showToast('Full screen isn’t available here.')
    }
  }

  private _renderFullscreen = (): void => {
    const btn = this._fullscreenButton
    if (!btn) return
    const doc = document as Document & { webkitFullscreenElement?: Element }
    const on = !!(doc.fullscreenElement || doc.webkitFullscreenElement)
    btn.innerHTML = on ? FULLSCREEN_EXIT_ICON : FULLSCREEN_ENTER_ICON
    btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen')
    btn.classList.toggle('touch-fullscreen--on', on)
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
    document.removeEventListener('fullscreenchange', this._renderFullscreen)
    document.removeEventListener('webkitfullscreenchange', this._renderFullscreen)
    if (this._toastTimer !== null) clearTimeout(this._toastTimer)
    this._toastTimer = null
    this._overlay?.remove()
    this._overlay = null
    this._fullscreenButton = null
    this._toast = null
    this._stickBase = null
    this._stickKnob = null
    this._thrustRing = null
    this._modeButton = null
  }

  private _showStick(): void {
    if (!this._stickBase || !this._stick) return
    const size = this._stick.radius * 2
    this._stickBase.style.width = `${size}px`
    this._stickBase.style.height = `${size}px`
    this._stickBase.classList.add('touch-joystick-base--active')
    this._overlay?.classList.add('touch-overlay--steering')
  }

  private _hideStick(): void {
    this._stickBase?.classList.remove('touch-joystick-base--active')
    if (this._stickKnob) this._stickKnob.style.transform = 'translate(0px, 0px)'
    this._overlay?.classList.remove('touch-overlay--steering')
  }

  private _showThrust(x: number, y: number): void {
    if (!this._thrustRing) return
    this._thrustRing.style.transform = `translate(${x}px, ${y}px)`
    this._thrustRing.classList.add('touch-thrust-ring--active')
    this._overlay?.classList.add('touch-overlay--thrusting')
  }

  private _hideThrust(): void {
    this._thrustRing?.classList.remove('touch-thrust-ring--active', 'touch-thrust-ring--braking')
    this._thrustRing?.style.setProperty('--pull', '0')
    this._overlay?.classList.remove('touch-overlay--thrusting')
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

/** Launched from the home screen as an installed web app (already fullscreen-ish). */
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Singleton touch adapter. */
export const touchInputAdapter = new TouchInputAdapter()

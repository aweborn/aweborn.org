/**
 * Aweborn — Flight Controller
 *
 * Client adapter over the shared deterministic flight simulation
 * (`shared/sim/flight.ts`, Phase 09 9A). The physics itself (DRIVE /
 * NEUTRAL, gravity wells, slingshots, the beginner leash) lives there so
 * the server can run the very same step for authority and offline replay.
 *
 * This class:
 *  - turns the InputManager's actions into a quantized `InputFrame`
 *  - keeps the THREE.js view of the player (`position`, `velocity`,
 *    `quaternion`) that the camera, warp and teleport read and write
 *  - runs one fixed 60 Hz `stepFlight` per call to `step()`
 *
 * Two navigation modes (see shared/sim/flight.ts for the numbers):
 *
 *  DRIVE (default, gravity disabled):
 *   - Oracle movement — unaffected by gravity entirely
 *   - Instant velocity on key press (snappy, direct), hard cap 60 u/s
 *   - Beginner-friendly: no gravitational drift
 *
 *  NEUTRAL (gravity enabled):
 *   - Full gravitational physics, acceleration-based thrust
 *   - Very light space drag (coast with momentum), soft cap ~80 u/s
 *   - Enables slingshot gameplay around gravity wells
 *
 * Usage (Scene.tsx, once per fixed tick):
 *   const info = flightController.step(flightController.sampleInput(), simWorld)
 *   const { position, velocity, quaternion } = flightController.getState()
 */

import * as THREE from 'three'
import { inputManager } from './InputManager'
import {
  stepFlight, initialFlightState, newStepInfo, quantizeAxis, IN,
  type InputFrame, type StepInfo,
} from '@aweborn/shared/sim/flight'
import type { SimWorld } from '@aweborn/shared/sim/gravity'

// ── Flight State ─────────────────────────────────────────────────────

export type NavigationMode = 'drive' | 'neutral'

export interface FlightState {
  position: THREE.Vector3
  velocity: THREE.Vector3
  quaternion: THREE.Quaternion
  speed: number
  isDrifting: boolean
  isBraking: boolean
  isThrusting: boolean
  isActivelyControlling: boolean
  gravityEnabled: boolean
  navigationMode: NavigationMode
}

// ── Flight Controller ────────────────────────────────────────────────

class FlightController {
  /** World-space position */
  readonly position = new THREE.Vector3(0, 2, 60)
  /** World-space velocity */
  readonly velocity = new THREE.Vector3()
  /** Orientation quaternion */
  readonly quaternion = new THREE.Quaternion()

  /** The shared sim's state (plain doubles); synced with the THREE view around each step. */
  private _sim = initialFlightState(0, 2, 60)
  private _info = newStepInfo()

  /** Whether the controller is active (disabled in world interior) */
  private _enabled = true

  /** Whether the player is actively pressing any control key this tick */
  private _isActivelyControlling = false

  /**
   * Whether gravity is enabled ("NEUTRAL" mode).
   * When false ("DRIVE" mode, default), gravity does not affect the player.
   * Beginners start in DRIVE — no gravitational drift.
   * Sent to the sim as the `neutral` input bit each tick.
   */
  private _gravityEnabled = false

  /** This tick's input, quantized exactly as the server will see it. */
  sampleInput(): InputFrame {
    const a = inputManager.getActions()
    let bits = 0
    if (a.thrust) bits |= IN.thrust
    if (a.brake) bits |= IN.brake
    if (a.reverse) bits |= IN.reverse
    if (a.strafe) bits |= IN.strafe
    if (a.moveUp) bits |= IN.moveUp
    if (a.moveDown) bits |= IN.moveDown
    if (a.pitchUp) bits |= IN.pitchUp
    if (a.pitchDown) bits |= IN.pitchDown
    if (a.yawLeft) bits |= IN.yawLeft
    if (a.yawRight) bits |= IN.yawRight
    if (a.rollLeft) bits |= IN.rollLeft
    if (a.rollRight) bits |= IN.rollRight
    if (a.autoOrient) bits |= IN.autoOrient
    if (this._gravityEnabled) bits |= IN.neutral
    return { bits, yaw: quantizeAxis(inputManager.getAxis('yaw')), pitch: quantizeAxis(inputManager.getAxis('pitch')) }
  }

  /**
   * One fixed 60 Hz tick (FLIGHT_DT). Returns what the step saw (gravity,
   * slingshot, leash) or null while disabled.
   *
   * The THREE view is copied in first because warp leaps, teleports and
   * restores still move the player outside the sim (9B/9C make them inputs).
   */
  step(input: InputFrame, world: SimWorld): StepInfo | null {
    if (!this._enabled) return null
    const s = this._sim
    s.px = this.position.x; s.py = this.position.y; s.pz = this.position.z
    s.vx = this.velocity.x; s.vy = this.velocity.y; s.vz = this.velocity.z
    s.qx = this.quaternion.x; s.qy = this.quaternion.y; s.qz = this.quaternion.z; s.qw = this.quaternion.w
    stepFlight(s, input, world, this._info)
    this.position.set(s.px, s.py, s.pz)
    this.velocity.set(s.vx, s.vy, s.vz)
    this.quaternion.set(s.qx, s.qy, s.qz, s.qw)
    this._isActivelyControlling = this._info.activelyControlling
    return this._info
  }

  /** Get a readonly snapshot of the current flight state. */
  getState(): FlightState {
    const actions = inputManager.getActions()
    return {
      position: this.position,
      velocity: this.velocity,
      quaternion: this.quaternion,
      speed: this.velocity.length(),
      isDrifting: !actions.thrust && !actions.brake && this.velocity.length() > 0.1,
      isBraking: actions.brake,
      isThrusting: actions.thrust,
      isActivelyControlling: this._isActivelyControlling,
      gravityEnabled: this._gravityEnabled,
      navigationMode: this._gravityEnabled ? 'neutral' : 'drive',
    }
  }

  /** Whether the player is currently pressing any control key. */
  isActivelyControlling(): boolean {
    return this._isActivelyControlling
  }

  /** Enable/disable the flight controller. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled
  }

  /** Reset to a specific position/rotation (e.g., when exiting a world). */
  reset(position?: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    if (position) this.position.copy(position)
    if (quaternion) this.quaternion.copy(quaternion)
    this.velocity.set(0, 0, 0)
  }

  /** Full brake — zero all velocity. (Angular velocity isn't state: it follows input each tick.) */
  brake(): void {
    this.velocity.set(0, 0, 0)
  }

  /** Toggle gravity on/off (NEUTRAL ↔ DRIVE). */
  toggleGravity(): void {
    this._gravityEnabled = !this._gravityEnabled
  }

  /** Whether gravity is enabled (NEUTRAL mode). */
  isGravityEnabled(): boolean {
    return this._gravityEnabled
  }

  /** Set gravity enabled state directly. */
  setGravityEnabled(enabled: boolean): void {
    this._gravityEnabled = enabled
  }
}

/** Singleton flight controller. */
export const flightController = new FlightController()

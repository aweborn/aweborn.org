/**
 * Aweborn — Flight Controller
 *
 * 6DOF flight physics for the player's star-orb. Reads from the
 * InputManager and produces position/velocity/rotation each frame.
 *
 * Two navigation modes:
 *
 *  DRIVE (default, gravity disabled):
 *   - Oracle movement — unaffected by gravity entirely
 *   - Instant velocity on key press (snappy, direct)
 *   - Hard speed cap at 60 u/s
 *   - Beginner-friendly: no gravitational drift
 *
 *  NEUTRAL (gravity enabled):
 *   - Full gravitational physics — no attenuation
 *   - Acceleration-based thrust (build speed over time)
 *   - Very light space drag (coast with momentum)
 *   - Soft speed cap at ~60 u/s (via asymptotic drag)
 *   - Enables slingshot gameplay around gravity wells
 *   - Rewards skilled players with speed and mana
 *
 * Usage:
 *   flightController.update(delta, gravityForce)
 *   const { position, velocity, quaternion } = flightController.getState()
 */

import * as THREE from 'three'
import { inputManager, type ActionState } from './InputManager'

// ── Tuning Constants ─────────────────────────────────────────────────

// ── Shared ──

/** Angular velocity for pitch/yaw (rad/s) — target rate */
const TURN_RATE = 2.5
/** Angular velocity for roll (rad/s) — target rate */
const ROLL_RATE = 2.8

// ── DRIVE mode (oracle / gravity-free) ──

/** Forward thrust — instant velocity magnitude (units/s) */
const DRIVE_THRUST_SPEED = 12.0
/** Reverse — instant velocity magnitude (units/s) */
const DRIVE_REVERSE_SPEED = 12.0
/** Strafe — additive velocity magnitude (units/s) */
const DRIVE_STRAFE_SPEED = 12.0
/** Hard speed cap in DRIVE mode (units/s) */
const DRIVE_MAX_SPEED = 60.0

// ── NEUTRAL mode (full gravity / slingshot physics) ──

/** Thrust acceleration in NEUTRAL (units/s²) — builds speed over time */
const NEUTRAL_THRUST_ACCEL = 10.0
/** Reverse acceleration in NEUTRAL (units/s²) */
const NEUTRAL_REVERSE_ACCEL = 5.0
/** Strafe acceleration in NEUTRAL (units/s²) */
const NEUTRAL_STRAFE_ACCEL = 6.0
/** Brake deceleration in NEUTRAL (units/s²) — gradual, not instant */
const NEUTRAL_BRAKE_DECEL = 20.0
/**
 * Drag coefficient for NEUTRAL mode (per-second exponential decay).
 * At 0.4, a coasting player loses ~33% speed per second — gentle enough
 * to maintain slingshot momentum, strong enough to eventually settle.
 */
const NEUTRAL_DRAG = 0.15
/**
 * Soft speed cap in NEUTRAL mode (units/s).
 * Low from thrusters alone — slingshots are the way to go fast.
 */
const NEUTRAL_MAX_SPEED = 80.0

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

  /**
   * Current angular velocity — snaps to target on input, decays over
   * ~100ms on release for a satisfying settle instead of abrupt stop.
   */
  private _angularVelocity = new THREE.Vector3() // x=pitch, y=yaw, z=roll

  /** Temp vectors to avoid allocation in the hot loop */
  private _forward = new THREE.Vector3()
  private _right = new THREE.Vector3()
  private _up = new THREE.Vector3()

  /** Whether the controller is active (disabled in world interior) */
  private _enabled = true

  /** Whether the player is actively pressing any control key this frame */
  private _isActivelyControlling = false

  /**
   * Whether gravity is enabled ("NEUTRAL" mode).
   * When false ("DRIVE" mode, default), gravity does not affect the player.
   * Beginners start in DRIVE — no gravitational drift.
   */
  private _gravityEnabled = false

  /**
   * Slingshot turn dampening (0-1). 0 = normal turning, 1 = max reduction.
   * Smoothly interpolates toward the target value.
   */
  private _slingshotTurnDampen = 0
  private _slingshotTurnDampenTarget = 0

  /**
   * Update flight physics for one frame.
   *
   * @param delta  Time step in seconds (from useFrame)
   * @param gravityForce  External force vector (from GravitySystem)
   */
  update(delta: number, gravityForce?: THREE.Vector3): void {
    if (!this._enabled) return

    // Clamp delta to prevent huge jumps on tab-refocus
    const dt = Math.min(delta, 0.05)

    // Smooth slingshot turn dampening interpolation (~0.3s transition)
    const dampenRate = 8.0 // Higher = faster transition
    this._slingshotTurnDampen += (this._slingshotTurnDampenTarget - this._slingshotTurnDampen) * Math.min(dampenRate * dt, 1.0)

    const actions = inputManager.getActions()

    // Detect if the player is actively pressing any control key
    this._isActivelyControlling =
      actions.thrust || actions.brake || actions.reverse || actions.strafe ||
      actions.moveUp || actions.moveDown ||
      actions.pitchUp || actions.pitchDown ||
      actions.yawLeft || actions.yawRight ||
      actions.rollLeft || actions.rollRight

    // ── Compute local axes from quaternion ──
    this._forward.set(0, 0, -1).applyQuaternion(this.quaternion)
    this._right.set(1, 0, 0).applyQuaternion(this.quaternion)
    this._up.set(0, 1, 0).applyQuaternion(this.quaternion)

    // ── Angular velocity (rotation) ──
    this._updateRotation(dt, actions)

    // ── Linear velocity (movement) ──
    this._updateMovement(dt, actions, gravityForce)
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
    if (!enabled) {
      this._angularVelocity.set(0, 0, 0)
    }
  }

  /** Reset to a specific position/rotation (e.g., when exiting a world). */
  reset(position?: THREE.Vector3, quaternion?: THREE.Quaternion): void {
    if (position) this.position.copy(position)
    if (quaternion) this.quaternion.copy(quaternion)
    this.velocity.set(0, 0, 0)
    this._angularVelocity.set(0, 0, 0)
  }

  /** Full brake — zero all velocity and angular velocity. */
  brake(): void {
    this.velocity.set(0, 0, 0)
    this._angularVelocity.set(0, 0, 0)
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

  /**
   * Set slingshot turn dampening target.
   * 0 = normal turning, 1 = maximum steering reduction.
   * Value is smoothly interpolated each frame.
   */
  setSlingshotTurnDampen(factor: number): void {
    this._slingshotTurnDampenTarget = Math.max(0, Math.min(1, factor))
  }

  // ── Private ──

  private _updateRotation(dt: number, actions: Readonly<ActionState>): void {
    // Apply slingshot turn dampening in NEUTRAL mode
    const dampenMultiplier = this._gravityEnabled
      ? 1.0 - this._slingshotTurnDampen * 0.6 // Up to 60% reduction
      : 1.0 // DRIVE mode: unaffected
    const turnRate = TURN_RATE * dampenMultiplier
    const rollRate = ROLL_RATE * dampenMultiplier

    // Build target angular velocity from input
    let targetPitch = 0
    let targetYaw = 0
    let targetRoll = 0

    if (actions.pitchUp) targetPitch += turnRate
    if (actions.pitchDown) targetPitch -= turnRate
    if (actions.yawLeft) targetYaw += turnRate
    if (actions.yawRight) targetYaw -= turnRate
    if (actions.rollLeft) targetRoll += rollRate
    if (actions.rollRight) targetRoll -= rollRate

    const hasInput = Math.abs(targetPitch) > 0.01 || Math.abs(targetYaw) > 0.01 || Math.abs(targetRoll) > 0.01

    if (hasInput) {
      // Snap angular velocity to target — instant response on key press
      this._angularVelocity.set(targetPitch, targetYaw, targetRoll)
    } else {
      // Instant stop — no inertia after key release
      this._angularVelocity.set(0, 0, 0)
    }

    // Apply angular velocity to quaternion
    if (this._angularVelocity.lengthSq() > 0.0001) {
      const rotQ = new THREE.Quaternion()

      // Pitch (local X axis)
      rotQ.setFromAxisAngle(this._right, this._angularVelocity.x * dt)
      this.quaternion.premultiply(rotQ)

      // Yaw (local Y axis — no gimbal lock at any pitch angle)
      rotQ.setFromAxisAngle(this._up, this._angularVelocity.y * dt)
      this.quaternion.premultiply(rotQ)

      // Roll (local forward axis)
      rotQ.setFromAxisAngle(this._forward, this._angularVelocity.z * dt)
      this.quaternion.premultiply(rotQ)

      this.quaternion.normalize()
    }

    // Auto-orient (T key) — smoothly align to galactic "up"
    if (actions.autoOrient) {
      this._autoOrient(dt)
    }
  }

  private _updateMovement(dt: number, actions: Readonly<ActionState>, gravityForce?: THREE.Vector3): void {
    if (this._gravityEnabled) {
      this._updateNeutralMovement(dt, actions, gravityForce)
    } else {
      this._updateDriveMovement(dt, actions)
    }
  }

  /**
   * DRIVE mode — Oracle / gravity-free movement.
   * Instant velocity on key press. No gravity. Hard speed cap.
   * Designed for beginners and casual navigation.
   */
  private _updateDriveMovement(dt: number, actions: Readonly<ActionState>): void {
    // Zero velocity each frame — player must hold keys to move (no coasting)
    this.velocity.set(0, 0, 0)

    // ── Thrust — instant velocity in facing direction ──
    if (actions.thrust) {
      this.velocity.copy(this._forward).multiplyScalar(DRIVE_THRUST_SPEED)
    }

    // ── Reverse thrust — instant velocity backward ──
    if (actions.reverse) {
      this.velocity.copy(this._forward).multiplyScalar(-DRIVE_REVERSE_SPEED)
    }

    // ── Lateral strafe — add strafe component ──
    if (actions.strafe) {
      this.velocity.addScaledVector(this._right, DRIVE_STRAFE_SPEED)
    }

    // ── Vertical movement — instant velocity along local up ──
    if (actions.moveUp) {
      this.velocity.addScaledVector(this._up, DRIVE_THRUST_SPEED)
    }
    if (actions.moveDown) {
      this.velocity.addScaledVector(this._up, -DRIVE_THRUST_SPEED)
    }

    // ── Brake — instant stop ──
    if (actions.brake) {
      this.velocity.set(0, 0, 0)
    }

    // ── Hard speed cap ──
    if (this.velocity.length() > DRIVE_MAX_SPEED) {
      this.velocity.setLength(DRIVE_MAX_SPEED)
    }

    // ── No gravity in DRIVE ──

    // ── Integrate position ──
    this.position.addScaledVector(this.velocity, dt)
  }

  /**
   * NEUTRAL mode — Full gravitational physics with slingshot mechanics.
   * Acceleration-based thrust (build speed over time). Full gravity.
   * Light space drag lets players coast with momentum from slingshots.
   * Rewards skilled players with higher speeds and mana generation.
   */
  private _updateNeutralMovement(dt: number, actions: Readonly<ActionState>, gravityForce?: THREE.Vector3): void {
    // ── Thrust — acceleration-based (additive, builds speed) ──
    if (actions.thrust) {
      this.velocity.addScaledVector(this._forward, NEUTRAL_THRUST_ACCEL * dt)
    }

    // ── Reverse thrust — acceleration backward ──
    if (actions.reverse) {
      this.velocity.addScaledVector(this._forward, -NEUTRAL_REVERSE_ACCEL * dt)
    }

    // ── Lateral strafe — acceleration sideways ──
    if (actions.strafe) {
      this.velocity.addScaledVector(this._right, NEUTRAL_STRAFE_ACCEL * dt)
    }

    // ── Vertical movement — acceleration along local up ──
    if (actions.moveUp) {
      this.velocity.addScaledVector(this._up, NEUTRAL_THRUST_ACCEL * dt)
    }
    if (actions.moveDown) {
      this.velocity.addScaledVector(this._up, -NEUTRAL_THRUST_ACCEL * dt)
    }

    // ── Brake — gradual deceleration (physics-y feel, not instant) ──
    if (actions.brake) {
      const speed = this.velocity.length()
      if (speed > 0.1) {
        const decelAmount = Math.min(NEUTRAL_BRAKE_DECEL * dt, speed)
        this.velocity.multiplyScalar(1 - decelAmount / speed)
      } else {
        this.velocity.set(0, 0, 0)
      }
    }

    // ── Apply gravity — full strength, no attenuation ──
    if (gravityForce) {
      this.velocity.add(gravityForce.clone().multiplyScalar(dt))
    }

    // ── Space drag — exponential decay for natural feel ──
    // Allows coasting with slingshot momentum while preventing infinite speed
    const dragFactor = Math.pow(1 - NEUTRAL_DRAG, dt)
    this.velocity.multiplyScalar(dragFactor)

    // ── Soft speed cap (safety net) ──
    if (this.velocity.length() > NEUTRAL_MAX_SPEED) {
      this.velocity.setLength(NEUTRAL_MAX_SPEED)
    }

    // ── Integrate position ──
    this.position.addScaledVector(this.velocity, dt)
  }

  /** Smoothly align roll to galactic up (zero roll relative to Y-up). */
  private _autoOrient(dt: number): void {
    // Extract the current forward direction
    const forward = this._forward.clone()
    // Compute the "ideal" right vector (no roll)
    const idealRight = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    if (idealRight.lengthSq() < 0.001) return // Looking straight up/down — can't determine roll
    const idealUp = new THREE.Vector3().crossVectors(idealRight, forward).normalize()

    // Build the target quaternion from the unrolled basis
    const targetMatrix = new THREE.Matrix4().makeBasis(idealRight, idealUp, forward.negate())
    const targetQ = new THREE.Quaternion().setFromRotationMatrix(targetMatrix)

    // Slerp toward it — fast
    this.quaternion.slerp(targetQ, 1 - Math.pow(0.05, dt))
    this.quaternion.normalize()
  }
}

/** Singleton flight controller. */
export const flightController = new FlightController()

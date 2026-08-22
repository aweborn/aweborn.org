/**
 * Aweborn — Flight Controller
 *
 * 6DOF flight physics for the player's star-orb. Reads from the
 * InputManager and produces position/velocity/rotation each frame.
 *
 * Key physics:
 *  - Thrust builds speed via acceleration (not instant)
 *  - Releasing thrust → inertia drift (very slow deceleration)
 *  - Brake actively decelerates
 *  - Pitch/yaw/roll use angular velocity with damping
 *  - Speed is soft-clamped (asymptotic approach, never hard-stop)
 *
 * Usage:
 *   flightController.update(delta, actions, gravityForce)
 *   const { position, velocity, quaternion } = flightController.getState()
 */

import * as THREE from 'three'
import { inputManager, type ActionState } from './InputManager'

// ── Tuning Constants ─────────────────────────────────────────────────

/** Forward thrust acceleration (units/s²) */
const THRUST_ACCEL = 8.0
/** Reverse thrust acceleration (units/s²) */
const REVERSE_ACCEL = 4.0
/** Lateral strafe acceleration (units/s²) */
const STRAFE_ACCEL = 5.0
/** Active brake deceleration (units/s²) */
const BRAKE_DECEL = 12.0
/** Passive drift deceleration — very slow coast (units/s²) */
const DRIFT_DECEL = 0.15
/** Maximum speed (units/s) — soft cap via asymptotic damping */
const MAX_SPEED = 20.0
/** Speed above which extra drag kicks in for soft clamping */
const SOFT_CAP_START = 16.0

/** Angular velocity for pitch/yaw (rad/s) */
const TURN_RATE = 2.2
/** Angular velocity for roll (rad/s) */
const ROLL_RATE = 2.5
/** Angular velocity damping — how fast rotation stops (0 = instant, 1 = never) */
const ANGULAR_DAMPING = 0.88

// ── Flight State ─────────────────────────────────────────────────────

export interface FlightState {
  position: THREE.Vector3
  velocity: THREE.Vector3
  quaternion: THREE.Quaternion
  speed: number
  isDrifting: boolean
  isBraking: boolean
  isThrusting: boolean
}

// ── Flight Controller ────────────────────────────────────────────────

class FlightController {
  /** World-space position */
  readonly position = new THREE.Vector3(0, 2, 10)
  /** World-space velocity */
  readonly velocity = new THREE.Vector3()
  /** Orientation quaternion */
  readonly quaternion = new THREE.Quaternion()

  /** Current angular velocity (local space: x=pitch, y=yaw, z=roll) */
  private _angularVelocity = new THREE.Vector3()

  /** Temp vectors to avoid allocation in the hot loop */
  private _forward = new THREE.Vector3()
  private _right = new THREE.Vector3()
  private _up = new THREE.Vector3()
  private _thrustDir = new THREE.Vector3()
  private _euler = new THREE.Euler()

  /** Whether the controller is active (disabled in world interior) */
  private _enabled = true

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

    const actions = inputManager.getActions()

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
    return {
      position: this.position,
      velocity: this.velocity,
      quaternion: this.quaternion,
      speed: this.velocity.length(),
      isDrifting: !inputManager.getActions().thrust && !inputManager.getActions().brake && this.velocity.length() > 0.1,
      isBraking: inputManager.getActions().brake,
      isThrusting: inputManager.getActions().thrust,
    }
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

  // ── Private ──

  private _updateRotation(dt: number, actions: Readonly<ActionState>): void {
    // Build target angular velocity from input
    let targetPitch = 0
    let targetYaw = 0
    let targetRoll = 0

    if (actions.pitchUp) targetPitch += TURN_RATE
    if (actions.pitchDown) targetPitch -= TURN_RATE
    if (actions.yawLeft) targetYaw += TURN_RATE
    if (actions.yawRight) targetYaw -= TURN_RATE
    if (actions.rollLeft) targetRoll += ROLL_RATE
    if (actions.rollRight) targetRoll -= ROLL_RATE

    // Smoothly approach target angular velocity
    const blend = 1 - Math.pow(ANGULAR_DAMPING, dt * 60)
    this._angularVelocity.x += (targetPitch - this._angularVelocity.x) * blend
    this._angularVelocity.y += (targetYaw - this._angularVelocity.y) * blend
    this._angularVelocity.z += (targetRoll - this._angularVelocity.z) * blend

    // Damp angular velocity when no input
    if (Math.abs(targetPitch) < 0.01) this._angularVelocity.x *= Math.pow(ANGULAR_DAMPING, dt * 60)
    if (Math.abs(targetYaw) < 0.01) this._angularVelocity.y *= Math.pow(ANGULAR_DAMPING, dt * 60)
    if (Math.abs(targetRoll) < 0.01) this._angularVelocity.z *= Math.pow(ANGULAR_DAMPING, dt * 60)

    // Apply angular velocity to quaternion
    if (this._angularVelocity.lengthSq() > 0.0001) {
      const rotQ = new THREE.Quaternion()

      // Pitch (local X axis)
      rotQ.setFromAxisAngle(this._right, this._angularVelocity.x * dt)
      this.quaternion.premultiply(rotQ)

      // Yaw (world Y axis for more intuitive feel)
      rotQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this._angularVelocity.y * dt)
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
    // ── Thrust ──
    if (actions.thrust) {
      this._thrustDir.copy(this._forward).multiplyScalar(THRUST_ACCEL * dt)
      this.velocity.add(this._thrustDir)
    }

    // ── Reverse thrust ──
    if (actions.reverse) {
      this._thrustDir.copy(this._forward).multiplyScalar(-REVERSE_ACCEL * dt)
      this.velocity.add(this._thrustDir)
    }

    // ── Lateral strafe ──
    if (actions.strafe) {
      this._thrustDir.copy(this._right).multiplyScalar(STRAFE_ACCEL * dt)
      this.velocity.add(this._thrustDir)
    }

    // ── Brake (active deceleration) ──
    if (actions.brake) {
      const speed = this.velocity.length()
      if (speed > 0.01) {
        const decel = Math.min(BRAKE_DECEL * dt, speed)
        this.velocity.addScaledVector(
          this.velocity.clone().normalize(),
          -decel,
        )
      }
    }

    // ── Passive drift deceleration ──
    if (!actions.thrust && !actions.reverse && !actions.brake) {
      const speed = this.velocity.length()
      if (speed > 0.01) {
        const decel = Math.min(DRIFT_DECEL * dt, speed)
        this.velocity.addScaledVector(
          this.velocity.clone().normalize(),
          -decel,
        )
      }
    }

    // ── Soft speed cap ──
    const speed = this.velocity.length()
    if (speed > SOFT_CAP_START) {
      const overshoot = speed - SOFT_CAP_START
      const range = MAX_SPEED - SOFT_CAP_START
      // Asymptotic damping: the closer to MAX_SPEED, the stronger the drag
      const dragFactor = 1 - (overshoot / range) * 0.5
      this.velocity.multiplyScalar(Math.max(0.5, dragFactor))
    }
    // Hard cap as safety net
    if (this.velocity.length() > MAX_SPEED * 1.2) {
      this.velocity.setLength(MAX_SPEED * 1.2)
    }

    // ── Apply gravity ──
    if (gravityForce) {
      this.velocity.add(gravityForce.clone().multiplyScalar(dt))
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

    // Slerp toward it
    this.quaternion.slerp(targetQ, 1 - Math.pow(0.05, dt))
    this.quaternion.normalize()
  }
}

/** Singleton flight controller. */
export const flightController = new FlightController()

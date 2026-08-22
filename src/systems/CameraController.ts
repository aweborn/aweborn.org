/**
 * Aweborn — Camera Controller
 *
 * Third-person follow camera with spring damping. Follows the player's
 * orb position with configurable distance presets and look modes.
 *
 * Features:
 *  - 4 distance presets (keys 1-4)
 *  - Spring-damped position following (no lerp snapping)
 *  - Lock behind (Z): snap to velocity vector
 *  - Free-look (X): decouple camera from movement
 *  - Look behind (C, hold): rotate 180°
 *  - Auto-orient (T): snap to galactic up
 *
 * Usage:
 *   cameraController.update(delta, camera, playerPos, playerQuat, playerVel)
 */

import * as THREE from 'three'
import { inputManager } from './InputManager'

// ── Distance Presets ─────────────────────────────────────────────────

export enum CameraPreset {
  Close = 0,
  Medium = 1,
  Far = 2,
  Cinematic = 3,
}

const DISTANCES: Record<CameraPreset, number> = {
  [CameraPreset.Close]: 3.5,
  [CameraPreset.Medium]: 7,
  [CameraPreset.Far]: 14,
  [CameraPreset.Cinematic]: 25,
}

const HEIGHTS: Record<CameraPreset, number> = {
  [CameraPreset.Close]: 1.2,
  [CameraPreset.Medium]: 2.5,
  [CameraPreset.Far]: 5,
  [CameraPreset.Cinematic]: 8,
}

// ── Tuning ───────────────────────────────────────────────────────────

/** Spring stiffness — higher = snappier follow */
const SPRING_STIFFNESS = 6.0
/** Spring damping — higher = less oscillation */
const SPRING_DAMPING = 4.5
/** How fast the camera distance transitions between presets */
const DISTANCE_LERP_SPEED = 3.0
/** How fast the look-behind rotation transitions */
const LOOK_BEHIND_SPEED = 6.0

// ── Camera Controller ────────────────────────────────────────────────

class CameraController {
  /** Current distance preset */
  private _preset = CameraPreset.Medium
  /** Current actual camera distance (lerps toward target) */
  private _currentDistance = DISTANCES[CameraPreset.Medium]
  /** Current actual camera height offset */
  private _currentHeight = HEIGHTS[CameraPreset.Medium]

  /** Spring velocity for position */
  private _springVelocity = new THREE.Vector3()

  /** Free-look mode toggle */
  private _freeLook = false
  /** Free-look orientation (saved when entering free-look) */
  private _freeLookQuat = new THREE.Quaternion()

  /** Look-behind blend (0 = normal, 1 = fully behind) */
  private _lookBehindBlend = 0

  /** Temp vectors */
  private _idealPosition = new THREE.Vector3()
  private _displacement = new THREE.Vector3()
  private _springForce = new THREE.Vector3()
  private _lookTarget = new THREE.Vector3()

  /**
   * Update the camera position and orientation for one frame.
   *
   * @param delta       Time step in seconds
   * @param camera      The Three.js camera to control
   * @param playerPos   Player orb position
   * @param playerQuat  Player orb orientation
   * @param playerVel   Player velocity (for lock-behind)
   */
  update(
    delta: number,
    camera: THREE.Camera,
    playerPos: THREE.Vector3,
    playerQuat: THREE.Quaternion,
    playerVel: THREE.Vector3,
  ): void {
    const dt = Math.min(delta, 0.05)
    const actions = inputManager.getActions()
    const events = inputManager.getEvents()

    // ── Handle preset changes ──
    if (events.justPressed.has('cameraClose')) this._preset = CameraPreset.Close
    if (events.justPressed.has('cameraMedium')) this._preset = CameraPreset.Medium
    if (events.justPressed.has('cameraFar')) this._preset = CameraPreset.Far
    if (events.justPressed.has('cameraCinematic')) this._preset = CameraPreset.Cinematic

    // ── Toggle free-look ──
    if (events.justPressed.has('freeLook')) {
      this._freeLook = !this._freeLook
      if (this._freeLook) {
        // Save current camera orientation
        this._freeLookQuat.copy(camera.quaternion)
      }
    }

    // ── Lerp distance/height toward target ──
    const targetDist = DISTANCES[this._preset]
    const targetHeight = HEIGHTS[this._preset]
    this._currentDistance += (targetDist - this._currentDistance) * Math.min(1, DISTANCE_LERP_SPEED * dt)
    this._currentHeight += (targetHeight - this._currentHeight) * Math.min(1, DISTANCE_LERP_SPEED * dt)

    // ── Look-behind blend ──
    const targetLookBehind = actions.lookBehind ? 1 : 0
    this._lookBehindBlend += (targetLookBehind - this._lookBehindBlend) * Math.min(1, LOOK_BEHIND_SPEED * dt)

    // ── Determine camera orientation source ──
    let orientQuat: THREE.Quaternion

    if (this._freeLook) {
      orientQuat = this._freeLookQuat
    } else if (actions.lockBehind && playerVel.lengthSq() > 0.5) {
      // Lock camera behind velocity vector
      const velDir = playerVel.clone().normalize()
      const lookMatrix = new THREE.Matrix4().lookAt(
        new THREE.Vector3(),
        velDir,
        new THREE.Vector3(0, 1, 0),
      )
      orientQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix)
    } else {
      orientQuat = playerQuat
    }

    // ── Compute ideal camera position ──
    // Camera sits behind and above the player
    const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientQuat)
    const up = new THREE.Vector3(0, 1, 0)

    this._idealPosition.copy(playerPos)
      .addScaledVector(backward, this._currentDistance)
      .addScaledVector(up, this._currentHeight)

    // Apply look-behind: interpolate ideal position to the front
    if (this._lookBehindBlend > 0.01) {
      const frontPosition = playerPos.clone()
        .addScaledVector(backward, -this._currentDistance)
        .addScaledVector(up, this._currentHeight)
      this._idealPosition.lerp(frontPosition, this._lookBehindBlend)
    }

    // ── Spring physics for position ──
    this._displacement.copy(this._idealPosition).sub(camera.position)
    this._springForce.copy(this._displacement).multiplyScalar(SPRING_STIFFNESS)
    this._springForce.addScaledVector(this._springVelocity, -SPRING_DAMPING)

    this._springVelocity.addScaledVector(this._springForce, dt)
    camera.position.addScaledVector(this._springVelocity, dt)

    // ── Camera look target ──
    // Look slightly ahead of the player
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientQuat)
    this._lookTarget.copy(playerPos).addScaledVector(forward, 2)

    // Blend look target for look-behind
    if (this._lookBehindBlend > 0.01) {
      const behindTarget = playerPos.clone().addScaledVector(forward, -2)
      this._lookTarget.lerp(behindTarget, this._lookBehindBlend)
    }

    camera.lookAt(this._lookTarget)
  }

  /** Get the current distance preset. */
  getPreset(): CameraPreset {
    return this._preset
  }

  /** Get the current free-look state. */
  isFreeLook(): boolean {
    return this._freeLook
  }

  /** Reset the camera state (e.g., when entering/exiting worlds). */
  reset(): void {
    this._preset = CameraPreset.Medium
    this._currentDistance = DISTANCES[CameraPreset.Medium]
    this._currentHeight = HEIGHTS[CameraPreset.Medium]
    this._springVelocity.set(0, 0, 0)
    this._freeLook = false
    this._lookBehindBlend = 0
  }

  /**
   * Snap the camera immediately to the ideal position (no spring animation).
   * Use after teleporting the player or entering a world.
   */
  snapToTarget(camera: THREE.Camera, playerPos: THREE.Vector3, playerQuat: THREE.Quaternion): void {
    const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(playerQuat)
    const up = new THREE.Vector3(0, 1, 0)

    camera.position.copy(playerPos)
      .addScaledVector(backward, this._currentDistance)
      .addScaledVector(up, this._currentHeight)

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerQuat)
    this._lookTarget.copy(playerPos).addScaledVector(forward, 2)
    camera.lookAt(this._lookTarget)

    this._springVelocity.set(0, 0, 0)
  }
}

/** Singleton camera controller. */
export const cameraController = new CameraController()

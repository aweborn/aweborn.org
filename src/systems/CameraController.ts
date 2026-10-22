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

export const CameraPreset = {
  Close: 0,
  Medium: 1,
  Far: 2,
  Cinematic: 3,
} as const

export type CameraPreset = (typeof CameraPreset)[keyof typeof CameraPreset]

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

/** How fast the camera distance transitions between presets */
const DISTANCE_LERP_SPEED = 3.0
/** How fast the look-behind rotation transitions */
const LOOK_BEHIND_SPEED = 6.0

/** Convert any camera distance in [3.5, 25] to its matching height offset along the preset curve. */
function heightForDistance(d: number): number {
  if (d <= DISTANCES[CameraPreset.Close]) return HEIGHTS[CameraPreset.Close]
  if (d <= DISTANCES[CameraPreset.Medium]) {
    const t = (d - DISTANCES[CameraPreset.Close]) / (DISTANCES[CameraPreset.Medium] - DISTANCES[CameraPreset.Close])
    return HEIGHTS[CameraPreset.Close] + t * (HEIGHTS[CameraPreset.Medium] - HEIGHTS[CameraPreset.Close])
  }
  if (d <= DISTANCES[CameraPreset.Far]) {
    const t = (d - DISTANCES[CameraPreset.Medium]) / (DISTANCES[CameraPreset.Far] - DISTANCES[CameraPreset.Medium])
    return HEIGHTS[CameraPreset.Medium] + t * (HEIGHTS[CameraPreset.Far] - HEIGHTS[CameraPreset.Medium])
  }
  const t = Math.min(1, (d - DISTANCES[CameraPreset.Far]) / (DISTANCES[CameraPreset.Cinematic] - DISTANCES[CameraPreset.Far]))
  return HEIGHTS[CameraPreset.Far] + t * (HEIGHTS[CameraPreset.Cinematic] - HEIGHTS[CameraPreset.Far])
}

// ── Camera Controller ────────────────────────────────────────────────

class CameraController {
  /** Current distance preset */
  private _preset: CameraPreset = CameraPreset.Medium
  /** Target camera distance (set by preset keys 1–4 or pinch-to-zoom) */
  private _targetDistance = DISTANCES[CameraPreset.Medium]
  /** Target camera height offset */
  private _targetHeight = HEIGHTS[CameraPreset.Medium]
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
    if (events.justPressed.has('cameraClose')) this.setPreset(CameraPreset.Close)
    if (events.justPressed.has('cameraMedium')) this.setPreset(CameraPreset.Medium)
    if (events.justPressed.has('cameraFar')) this.setPreset(CameraPreset.Far)
    if (events.justPressed.has('cameraCinematic')) this.setPreset(CameraPreset.Cinematic)

    // ── Toggle free-look ──
    if (events.justPressed.has('freeLook')) {
      this._freeLook = !this._freeLook
      if (this._freeLook) {
        // Save current camera orientation
        this._freeLookQuat.copy(camera.quaternion)
      }
    }

    // ── Lerp distance/height toward target ──
    this._currentDistance += (this._targetDistance - this._currentDistance) * Math.min(1, DISTANCE_LERP_SPEED * dt)
    this._currentHeight += (this._targetHeight - this._currentHeight) * Math.min(1, DISTANCE_LERP_SPEED * dt)

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
    // Camera sits behind and above the player (in player-local space)
    const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientQuat)
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orientQuat)

    this._idealPosition.copy(playerPos)
      .addScaledVector(backward, this._currentDistance)
      .addScaledVector(localUp, this._currentHeight)

    // Apply look-behind: interpolate ideal position to the front
    if (this._lookBehindBlend > 0.01) {
      const frontPosition = playerPos.clone()
        .addScaledVector(backward, -this._currentDistance)
        .addScaledVector(localUp, this._currentHeight)
      this._idealPosition.lerp(frontPosition, this._lookBehindBlend)
    }

    // ── Snap camera to ideal position (no spring lag) ──
    camera.position.copy(this._idealPosition)

    // ── Camera look target ──
    // Look slightly ahead of the player
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientQuat)
    this._lookTarget.copy(playerPos).addScaledVector(forward, 2)

    // Blend look target for look-behind
    if (this._lookBehindBlend > 0.01) {
      const behindTarget = playerPos.clone().addScaledVector(forward, -2)
      this._lookTarget.lerp(behindTarget, this._lookBehindBlend)
    }

    // Set camera up to player's local up so lookAt doesn't flip
    camera.up.copy(localUp)
    camera.lookAt(this._lookTarget)
  }

  /** Set a discrete camera distance preset (keys 1–4). */
  setPreset(preset: CameraPreset): void {
    this._preset = preset
    this._targetDistance = DISTANCES[preset]
    this._targetHeight = HEIGHTS[preset]
  }

  /**
   * Pinch-to-zoom camera distance in/out continuously across [Close, Cinematic].
   * `scaleFactor < 1` zooms in (spread fingers); `scaleFactor > 1` zooms out (pinch fingers).
   */
  zoomBy(scaleFactor: number): void {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return
    const minD = DISTANCES[CameraPreset.Close]
    const maxD = DISTANCES[CameraPreset.Cinematic]
    this._targetDistance = Math.max(minD, Math.min(maxD, this._targetDistance * scaleFactor))
    this._targetHeight = heightForDistance(this._targetDistance)
    // Keep _preset aligned with the nearest discrete preset
    let best: CameraPreset = CameraPreset.Medium
    let bestDiff = Infinity
    for (const p of [CameraPreset.Close, CameraPreset.Medium, CameraPreset.Far, CameraPreset.Cinematic]) {
      const diff = Math.abs(DISTANCES[p] - this._targetDistance)
      if (diff < bestDiff) {
        bestDiff = diff
        best = p
      }
    }
    this._preset = best
  }

  /** Get the current distance preset. */
  getPreset(): CameraPreset {
    return this._preset
  }

  /** Get the current target camera distance (after preset or pinch-to-zoom). */
  getTargetDistance(): number {
    return this._targetDistance
  }

  /** Get the current free-look state. */
  isFreeLook(): boolean {
    return this._freeLook
  }

  /** Reset the camera state (e.g., when entering/exiting worlds). */
  reset(): void {
    this._preset = CameraPreset.Medium
    this._targetDistance = DISTANCES[CameraPreset.Medium]
    this._targetHeight = HEIGHTS[CameraPreset.Medium]
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
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(playerQuat)

    camera.position.copy(playerPos)
      .addScaledVector(backward, this._currentDistance)
      .addScaledVector(localUp, this._currentHeight)

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerQuat)
    this._lookTarget.copy(playerPos).addScaledVector(forward, 2)
    camera.up.copy(localUp)
    camera.lookAt(this._lookTarget)

    this._springVelocity.set(0, 0, 0)
  }
}

/** Singleton camera controller. */
export const cameraController = new CameraController()

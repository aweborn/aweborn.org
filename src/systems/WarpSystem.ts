/**
 * Aweborn — Warp System
 *
 * Lock-on targeting + warp charge/leap mechanics. The player can
 * lock onto a distant world with J, then hold K to charge a warp
 * and release to leap across the universe.
 *
 * Per ROADMAP:
 *  1. Lock on (J) → target indicator on a distant world
 *  2. Hold K → charge meter fills (1-3 sec)
 *  3. Release K → SNAP. Warp-leap toward target
 *  4. Arrive near target in gravity well with residual velocity
 *
 * Warp isn't instant teleport — you arrive with momentum.
 */

import * as THREE from 'three'
import { inputManager } from './InputManager'
import { flightController } from './FlightController'
import type { WorldEntry } from '@aweborn/shared/crdt-schema'

// ── Tuning Constants ─────────────────────────────────────────────────

/** Maximum lock-on range (scene units). */
const LOCK_ON_RANGE = 60

/** Minimum charge to trigger warp (0-1). Prevents accidental warps. */
const MIN_CHARGE_THRESHOLD = 0.25

/** Full charge time in seconds. */
const FULL_CHARGE_TIME = 2.5

/** Arrival offset from target (units). Don't land inside the world. */
const ARRIVAL_OFFSET = 4.0

/** Residual velocity after warp (fraction of max speed). */
const RESIDUAL_VELOCITY_FACTOR = 0.3

/** Warp leap animation duration (seconds). */
const WARP_LEAP_DURATION = 0.6

/** Scene scaling constants (must match UniverseWorlds.tsx) */
const SCENE_RADIUS = 14
const CRDT_SCALE = 500

// ── Types ────────────────────────────────────────────────────────────

export type WarpPhase = 'idle' | 'locked' | 'charging' | 'leaping' | 'arriving'

export interface WarpState {
  phase: WarpPhase
  /** The world currently locked on to (null if no lock). */
  lockedTarget: WorldEntry | null
  /** Scene-space position of the locked target. */
  lockedTargetPosition: THREE.Vector3 | null
  /** Charge progress (0-1). */
  chargeProgress: number
  /** Leap progress (0-1, during the leap animation). */
  leapProgress: number
  /** All candidate worlds sorted by distance. */
  candidates: { world: WorldEntry; distance: number; scenePos: THREE.Vector3 }[]
}

// ── Helpers ──────────────────────────────────────────────────────────

function worldToScene(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return new THREE.Vector3(
    pos.x * scale,
    pos.y * scale + 1,
    pos.z * scale - 8,
  )
}

// ── Warp System ──────────────────────────────────────────────────────

class WarpSystem {
  private _phase: WarpPhase = 'idle'
  private _lockedTarget: WorldEntry | null = null
  private _lockedTargetPosition: THREE.Vector3 | null = null
  private _chargeProgress = 0
  private _leapProgress = 0
  private _leapStartPos = new THREE.Vector3()
  private _leapEndPos = new THREE.Vector3()
  private _leapStartQuat = new THREE.Quaternion()
  private _candidates: { world: WorldEntry; distance: number; scenePos: THREE.Vector3 }[] = []

  /**
   * Update the warp system for one frame.
   *
   * @param delta  Time step in seconds
   * @param playerPos  Current player position
   * @param worlds  All known worlds from the universe CRDT
   */
  update(
    delta: number,
    playerPos: THREE.Vector3,
    worlds: Map<string, WorldEntry>,
  ): void {
    const events = inputManager.getEvents()
    const actions = inputManager.getActions()

    // ── Update candidates (distance-sorted worlds) ──
    this._updateCandidates(playerPos, worlds)

    switch (this._phase) {
      case 'idle':
        // J pressed → lock onto nearest world
        if (events.justPressed.has('lockOn') && this._candidates.length > 0) {
          this._lockOn(this._candidates[0])
        }
        break

      case 'locked':
        // J pressed again → cycle to next candidate
        if (events.justPressed.has('lockOn')) {
          this._cycleTarget()
        }
        // K pressed → start charging
        if (actions.warp && this._lockedTarget) {
          this._phase = 'charging'
          this._chargeProgress = 0
        }
        // Escape or target out of range → cancel lock
        if (events.justPressed.has('escape') || !this._isTargetInRange(playerPos)) {
          this._cancelLock()
        }
        break

      case 'charging':
        // K still held → charge up
        if (actions.warp) {
          this._chargeProgress = Math.min(1, this._chargeProgress + delta / FULL_CHARGE_TIME)
        }
        // K released → leap if charged enough, otherwise cancel
        if (events.justReleased.has('warp')) {
          if (this._chargeProgress >= MIN_CHARGE_THRESHOLD && this._lockedTargetPosition) {
            this._startLeap(playerPos)
          } else {
            this._phase = 'locked'
            this._chargeProgress = 0
          }
        }
        // Escape → cancel
        if (events.justPressed.has('escape')) {
          this._cancelLock()
        }
        break

      case 'leaping':
        // Animate the leap
        this._leapProgress = Math.min(1, this._leapProgress + delta / WARP_LEAP_DURATION)

        // Smooth ease-in-out for position interpolation
        const t = this._easeInOutCubic(this._leapProgress)
        flightController.position.lerpVectors(this._leapStartPos, this._leapEndPos, t)

        // Smoothly rotate toward target
        if (this._leapProgress < 0.5) {
          // First half: maintain starting orientation
        } else {
          // Second half: orient toward target
          const lookDir = this._leapEndPos.clone().sub(this._leapStartPos).normalize()
          const targetQuat = new THREE.Quaternion()
          const lookMatrix = new THREE.Matrix4().lookAt(
            new THREE.Vector3(),
            lookDir.negate(),
            new THREE.Vector3(0, 1, 0),
          )
          targetQuat.setFromRotationMatrix(lookMatrix)
          flightController.quaternion.slerp(targetQuat, (this._leapProgress - 0.5) * 2)
        }

        // Disable normal flight during leap
        flightController.setEnabled(false)

        // Leap complete → arrive
        if (this._leapProgress >= 1) {
          this._arrive()
        }
        break

      case 'arriving':
        // Brief pause then return to idle
        // The arrival visual is handled by WarpEffect.tsx
        this._phase = 'idle'
        flightController.setEnabled(true)
        break
    }
  }

  /** Get current warp state (for HUD/visuals). */
  getState(): WarpState {
    return {
      phase: this._phase,
      lockedTarget: this._lockedTarget,
      lockedTargetPosition: this._lockedTargetPosition,
      chargeProgress: this._chargeProgress,
      leapProgress: this._leapProgress,
      candidates: this._candidates,
    }
  }

  /** Cancel any active warp state. */
  cancel(): void {
    this._cancelLock()
  }

  // ── Private ──

  private _updateCandidates(playerPos: THREE.Vector3, worlds: Map<string, WorldEntry>): void {
    this._candidates = []
    for (const world of worlds.values()) {
      const scenePos = worldToScene(world.resolvedPosition)
      const distance = scenePos.distanceTo(playerPos)
      if (distance < LOCK_ON_RANGE) {
        this._candidates.push({ world, distance, scenePos })
      }
    }
    // Sort by distance
    this._candidates.sort((a, b) => a.distance - b.distance)
  }

  private _lockOn(candidate: { world: WorldEntry; scenePos: THREE.Vector3 }): void {
    this._lockedTarget = candidate.world
    this._lockedTargetPosition = candidate.scenePos.clone()
    this._phase = 'locked'
    this._chargeProgress = 0
  }

  private _cycleTarget(): void {
    if (this._candidates.length === 0) {
      this._cancelLock()
      return
    }
    // Find current target in candidates and move to next
    const currentIdx = this._candidates.findIndex((c) => c.world.id === this._lockedTarget?.id)
    const nextIdx = (currentIdx + 1) % this._candidates.length
    this._lockOn(this._candidates[nextIdx])
  }

  private _cancelLock(): void {
    this._phase = 'idle'
    this._lockedTarget = null
    this._lockedTargetPosition = null
    this._chargeProgress = 0
    this._leapProgress = 0
  }

  private _isTargetInRange(playerPos: THREE.Vector3): boolean {
    if (!this._lockedTargetPosition) return false
    return this._lockedTargetPosition.distanceTo(playerPos) < LOCK_ON_RANGE * 1.5
  }

  private _startLeap(playerPos: THREE.Vector3): void {
    this._phase = 'leaping'
    this._leapProgress = 0
    this._leapStartPos.copy(playerPos)
    this._leapStartQuat.copy(flightController.quaternion)

    // Calculate arrival position: offset from target, facing the target
    if (this._lockedTargetPosition) {
      const dir = playerPos.clone().sub(this._lockedTargetPosition).normalize()
      this._leapEndPos.copy(this._lockedTargetPosition).addScaledVector(dir, ARRIVAL_OFFSET)
    }

    // Zero out current velocity during leap
    flightController.velocity.set(0, 0, 0)
  }

  private _arrive(): void {
    this._phase = 'arriving'

    // Set residual velocity toward the target (drift into gravity well)
    if (this._lockedTargetPosition) {
      const dir = this._lockedTargetPosition.clone().sub(flightController.position).normalize()
      flightController.velocity.copy(dir).multiplyScalar(20 * RESIDUAL_VELOCITY_FACTOR)
    }

    // Reset lock state
    this._lockedTarget = null
    this._lockedTargetPosition = null
    this._chargeProgress = 0
    this._leapProgress = 0
  }

  private _easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }
}

/** Singleton warp system. */
export const warpSystem = new WarpSystem()

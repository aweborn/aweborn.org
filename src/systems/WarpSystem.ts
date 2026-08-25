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
const LOCK_ON_RANGE = 200

/** Minimum charge to trigger warp (0-1). Prevents accidental warps. */
const MIN_CHARGE_THRESHOLD = 0.25

/** Full charge time in seconds. */
const FULL_CHARGE_TIME = 2.5

/** Arrival offset from target (units). 0 = snap to center. */
const ARRIVAL_OFFSET = 0

/** Residual velocity after warp (fraction of max speed). */
const RESIDUAL_VELOCITY_FACTOR = 0.3

/** Warp leap animation duration (seconds). */
const WARP_LEAP_DURATION = 0.6

/** Portal position (origin of the universe). */
const PORTAL_POSITION = new THREE.Vector3(0, 0, 0)

/**
 * Synthetic WorldEntry for the Aweborn Portal so it can participate
 * in the lock-on / warp system like any other world.
 */
const PORTAL_ENTRY: WorldEntry = {
  id: '__aweborn_portal__',
  name: 'AWEBORN',
  creator: 'system',
  intendedPosition: { x: 0, y: 0, z: 0 },
  resolvedPosition: { x: 0, y: 0, z: 0 },
  resolvedAt: 0,
  color: '#e8b94a',
  sector: '0:0:0',
  solidified: true,
  solidifiedAt: 0,
  playerCount: 0,
  lastActive: 0,
  createdAt: 0,
}

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
  /** Whether auto-lock mode is active. */
  autoLock: boolean
  /** Screen-space position of the locked target (0-1 normalized, null if no lock). */
  targetScreenPos: { x: number; y: number } | null
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
   * Screen-space position of the locked target, set externally by the
   * FlightSystem which has access to the camera for 3D→2D projection.
   * Values are in CSS percentages (0-100).
   */
  private _targetScreenPos: { x: number; y: number } | null = null

  /**
   * Auto-lock mode — when true, the system automatically locks onto
   * the nearest world whenever idle, making warp the first interaction.
   * Defaults to true for beginner onboarding.
   */
  private _autoLock = true

  /**
   * Tracks whether the very first auto-lock has fired.
   * On first spawn, we always lock to the Aweborn Portal (donation target).
   */
  private _firstSpawnDone = false

  /**
   * Brief cooldown after arrival before auto-lock re-engages,
   * so the player has a moment to orient.
   */
  private _autoLockCooldown = 0
  private static readonly AUTO_LOCK_COOLDOWN_TIME = 0.3
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
        // Tick down auto-lock cooldown
        if (this._autoLockCooldown > 0) {
          this._autoLockCooldown -= delta
        }

        // J pressed → cycle to next candidate (or lock nearest if not auto-locked)
        if (events.justPressed.has('lockOn') && this._candidates.length > 0) {
          this._lockOn(this._candidates[0])
        }

        // Auto-lock: automatically lock onto nearest candidate when idle
        if (this._autoLock && this._autoLockCooldown <= 0 && this._candidates.length > 0) {
          if (!this._firstSpawnDone) {
            // First spawn → always lock onto the Aweborn Portal
            const portalCandidate = this._candidates.find((c) => c.world.id === PORTAL_ENTRY.id)
            if (portalCandidate) {
              this._lockOn(portalCandidate)
              this._firstSpawnDone = true
            } else {
              // Portal not in range yet (unlikely), fall back to nearest
              this._lockOn(this._candidates[0])
              this._firstSpawnDone = true
            }
          } else {
            this._lockOn(this._candidates[0])
          }
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
      autoLock: this._autoLock,
      targetScreenPos: this._targetScreenPos,
    }
  }

  /** Cancel any active warp state. */
  cancel(): void {
    this._cancelLock()
  }

  /**
   * Set the screen-space position of the locked target.
   * Called by FlightSystem each frame after projecting the 3D position.
   * @param pos  Normalized screen coords (x: 0-100%, y: 0-100%), or null to clear.
   */
  setTargetScreenPos(pos: { x: number; y: number } | null): void {
    this._targetScreenPos = pos
  }

  // ── Private ──

  private _updateCandidates(playerPos: THREE.Vector3, worlds: Map<string, WorldEntry>): void {
    this._candidates = []

    // Include the Aweborn Portal as a warp-able target
    const portalDist = PORTAL_POSITION.distanceTo(playerPos)
    if (portalDist < LOCK_ON_RANGE) {
      this._candidates.push({ world: PORTAL_ENTRY, distance: portalDist, scenePos: PORTAL_POSITION.clone() })
    }

    for (const world of worlds.values()) {
      const scenePos = new THREE.Vector3(world.resolvedPosition.x, world.resolvedPosition.y, world.resolvedPosition.z)
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

    // Full brake — beginner-friendly: snap to destination and stop completely
    flightController.brake()

    // Reset lock state
    this._lockedTarget = null
    this._lockedTargetPosition = null
    this._chargeProgress = 0
    this._leapProgress = 0

    // Start auto-lock cooldown so player has a moment to orient
    this._autoLockCooldown = WarpSystem.AUTO_LOCK_COOLDOWN_TIME
  }

  private _easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }
}

/** Singleton warp system. */
export const warpSystem = new WarpSystem()

/**
 * Aweborn — Gravity System
 *
 * Calculates gravitational attraction from nearby worlds and the
 * Aweborn Portal. Returns a force vector each frame that the
 * FlightController applies to the player's velocity.
 *
 * Formula (per ROADMAP):
 *   attraction = G * worldMass / distance²
 *   worldMass  = f(playerCount, objectCount, age)
 *
 * Features:
 *  - Inverse-square gravity from all nearby worlds
 *  - Aweborn Portal has the strongest fixed pull
 *  - Captured orbit: auto-settle when velocity is low near a world
 *  - Gravitational slingshot: speed boost from high-velocity passes
 */

import * as THREE from 'three'
import type { WorldEntry } from '@aweborn/shared/crdt-schema'

// ── Tuning Constants ─────────────────────────────────────────────────

/**
 * Gravitational constant — controls overall pull strength.
 * This is a game-feel constant, not real physics.
 */
const G = 10.0

/** Maximum distance at which gravity is calculated (optimization). */
const GRAVITY_RANGE = 120.0

/** Minimum distance to prevent infinite force at zero distance. */
const MIN_DISTANCE = 2.0

/**
 * Maximum gravitational acceleration (units/s²), per body and in total.
 *
 * Invariant: this stays BELOW FlightController's NEUTRAL_THRUST_ACCEL (10),
 * so holding thrust away from any well always escapes it. Without this cap,
 * G=10 produced ~62 u/s² next to the Portal and players got stuck forever.
 * G still shapes how far out the pull is felt; this only caps the core.
 */
const MAX_GRAVITY_ACCEL = 8.0

/**
 * Approach drag range — within this distance, head-on approaches are slowed.
 * Creates the "slowing down as you approach" feel that makes slingshot exits zippier.
 */
const APPROACH_DRAG_RANGE = 12.0

/**
 * Maximum approach drag strength (0-1). At 1.0, a head-on approach at
 * point-blank range would lose 40% of its velocity per physics step.
 */
const APPROACH_DRAG_STRENGTH = 0.4

/** Minimum player speed (units/s) to trigger a slingshot boost. */
const SLINGSHOT_MIN_SPEED = 15.0

/** Maximum distance from a body for slingshot detection. */
const SLINGSHOT_RANGE = 15.0

/**
 * Fixed mass for the Aweborn Portal (origin).
 * Much higher than any world — strongest pull in the universe.
 */
const PORTAL_MASS = 25.0

/** Portal position (origin of the universe). */
const PORTAL_POSITION = new THREE.Vector3(0, 0, 0)

/**
 * Calculate world mass from its properties.
 * Active worlds with more players and history pull harder.
 */
function calculateWorldMass(world: WorldEntry): number {
  const playerBoost = 1 + world.playerCount * 0.5
  const ageBonus = Math.min(1 + (Date.now() - world.createdAt) / (1000 * 60 * 60 * 24), 3) // caps at 3x after 2 days
  //const solidBonus = world.solidified ? 1.5 : 0.8

  return 2.0 * playerBoost * ageBonus
}

// ── Result Types ─────────────────────────────────────────────────────

export interface SlingshotEvent {
  /** The world that was slung around. */
  worldId: string
  /** Player speed during the slingshot. */
  speed: number
  /** The gravitational boost factor applied. */
  boostFactor: number
}

export interface GravityResult {
  /** Total gravity force vector to apply this frame. */
  force: THREE.Vector3
  /** The nearest world (for orbit/interaction hints). */
  nearestWorld: WorldEntry | null
  /** Distance to the nearest world. */
  nearestDistance: number
  /** Scene-space position of the nearest world (for visuals). */
  nearestWorldPosition: THREE.Vector3 | null
  /** Whether the player is within orbit range of any world. */
  inOrbitRange: boolean
  /** The world the player is closest to orbiting. */
  orbitTarget: WorldEntry | null
  /** Slingshot event if one occurred this frame (for mana system). */
  slingshotEvent: SlingshotEvent | null
  /**
   * Approach drag factor (0-1). How much the player is being slowed
   * by head-on approach to a gravity well. 0 = no drag, 1 = max drag.
   * Used by FlightController to dampen velocity and by visuals.
   */
  approachDragFactor: number
}

// ── Gravity System ───────────────────────────────────────────────────

class GravitySystem {
  /** Temp vectors */
  private _toWorld = new THREE.Vector3()
  private _force = new THREE.Vector3()
  private _totalForce = new THREE.Vector3()

  /**
   * Calculate the total gravitational force on the player.
   *
   * @param playerPos  Current player position (scene space)
   * @param playerVel  Current player velocity (for slingshot detection)
   * @param worlds     All known worlds from the universe CRDT
   */
  calculate(
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    worlds: Map<string, WorldEntry>,
  ): GravityResult {
    this._totalForce.set(0, 0, 0)

    let nearestWorld: WorldEntry | null = null
    let nearestDistance = Infinity
    let nearestWorldPosition: THREE.Vector3 | null = null
    let orbitTarget: WorldEntry | null = null
    let slingshotEvent: SlingshotEvent | null = null
    let approachDragFactor = 0

    // ── Build unified gravity body list ──
    // Portal is treated as just another body — no special cases.
    type GravityBody = { id: string; position: THREE.Vector3; mass: number; world: WorldEntry | null }
    const bodies: GravityBody[] = [
      { id: '__aweborn_portal__', position: PORTAL_POSITION, mass: PORTAL_MASS, world: null },
    ]
    for (const world of worlds.values()) {
      const pos = new THREE.Vector3(world.resolvedPosition.x, world.resolvedPosition.y, world.resolvedPosition.z)
      bodies.push({ id: world.id, position: pos, mass: calculateWorldMass(world), world })
    }

    // ── Process all gravity bodies ──
    const speed = playerVel.length()
    for (const body of bodies) {
      this._toWorld.copy(body.position).sub(playerPos)
      const dist = Math.max(this._toWorld.length(), MIN_DISTANCE)

      // Track nearest body
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestWorld = body.world
        nearestWorldPosition = body.position.clone()
      }

      // Skip if too far
      if (dist > GRAVITY_RANGE) continue

      const strength = Math.min(G * body.mass / (dist * dist), MAX_GRAVITY_ACCEL)

      // ── Slingshot detection ──
      // The boost factor is reported via slingshotEvent and applied as a
      // forward velocity impulse in Scene.tsx. It must NOT scale the inward
      // pull: doing so (up to ~21×) bent fast passes into the well and trapped them.
      if (speed > SLINGSHOT_MIN_SPEED && dist < SLINGSHOT_RANGE) {
        const velDir = playerVel.clone().normalize()
        const toBodyDir = this._toWorld.clone().normalize()
        const dot = Math.abs(velDir.dot(toBodyDir))
        if (dot < 0.5) {
          const proximity = 1.0 - dist / SLINGSHOT_RANGE
          const tangentiality = 1.0 - dot / 0.5
          const speedFactor = Math.min(speed / 15.0, 20.0)
          const boost = 1.0 + speedFactor * proximity * (0.5 + tangentiality * 0.5)
          slingshotEvent = { worldId: body.id, speed, boostFactor: boost }
        }
      }

      // ── Orbit capture (worlds only) ──
      if (body.world && speed < 2.0 && dist < 3.0 && dist > 0.8) {
        orbitTarget = body.world
        const tangent = new THREE.Vector3()
          .crossVectors(this._toWorld, new THREE.Vector3(0, 1, 0))
          .normalize()
        const orbitStrength = strength * 0.3 * (1 - speed / 2.0)
        this._totalForce.addScaledVector(tangent, orbitStrength)
      }

      this._force.copy(this._toWorld).normalize().multiplyScalar(strength)
      this._totalForce.add(this._force)

      // ── Approach drag ──
      if (dist < APPROACH_DRAG_RANGE && speed > 1.0) {
        const velDir = playerVel.clone().normalize()
        const toDir = this._toWorld.clone().normalize()
        const headOnDot = velDir.dot(toDir)
        if (headOnDot > 0.7) {
          const proximityFactor = 1 - dist / APPROACH_DRAG_RANGE
          const drag = proximityFactor * headOnDot * APPROACH_DRAG_STRENGTH
          approachDragFactor = Math.max(approachDragFactor, drag)
        }
      }
    }

    // Cap the combined pull too (overlapping wells must not out-pull thrust)
    if (this._totalForce.length() > MAX_GRAVITY_ACCEL) {
      this._totalForce.setLength(MAX_GRAVITY_ACCEL)
    }

    const inOrbitRange = orbitTarget !== null

    return {
      force: this._totalForce.clone(),
      nearestWorld,
      nearestDistance,
      nearestWorldPosition,
      inOrbitRange,
      orbitTarget,
      slingshotEvent,
      approachDragFactor,
    }
  }
}

/** Singleton gravity system. */
export const gravitySystem = new GravitySystem()

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
const G = 0.8

/** Maximum distance at which gravity is calculated (optimization). */
const GRAVITY_RANGE = 15.0

/** Minimum distance to prevent infinite force at zero distance. */
const MIN_DISTANCE = 0.5

/**
 * Fixed mass for the Aweborn Portal (origin).
 * Much higher than any world — strongest pull in the universe.
 */
const PORTAL_MASS = 25.0

/** Portal position in scene coordinates (matches UniverseWorlds). */
const PORTAL_POSITION = new THREE.Vector3(0, 1, -8)

/** Scene scaling constants (must match UniverseWorlds.tsx) */
const SCENE_RADIUS = 14
const CRDT_SCALE = 500

// ── Helpers ──────────────────────────────────────────────────────────

/** Map a CRDT world position into scene coordinates (same as UniverseWorlds). */
function worldToScene(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return new THREE.Vector3(
    pos.x * scale,
    pos.y * scale + 1,
    pos.z * scale - 8,
  )
}

/**
 * Calculate world mass from its properties.
 * Active worlds with more players and history pull harder.
 */
function calculateWorldMass(world: WorldEntry): number {
  const playerBoost = 1 + world.playerCount * 0.5
  const ageBonus = Math.min(1 + (Date.now() - world.createdAt) / (1000 * 60 * 60 * 24), 3) // caps at 3x after 2 days
  const solidBonus = world.solidified ? 1.5 : 0.8

  return 2.0 * playerBoost * ageBonus * solidBonus
}

// ── Result Types ─────────────────────────────────────────────────────

export interface GravityResult {
  /** Total gravity force vector to apply this frame. */
  force: THREE.Vector3
  /** The nearest world (for orbit/interaction hints). */
  nearestWorld: WorldEntry | null
  /** Distance to the nearest world. */
  nearestDistance: number
  /** Whether the player is within orbit range of any world. */
  inOrbitRange: boolean
  /** The world the player is closest to orbiting. */
  orbitTarget: WorldEntry | null
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
    let orbitTarget: WorldEntry | null = null

    // ── Portal gravity ──
    this._toWorld.copy(PORTAL_POSITION).sub(playerPos)
    const portalDist = Math.max(this._toWorld.length(), MIN_DISTANCE)
    if (portalDist < GRAVITY_RANGE) {
      const portalStrength = G * PORTAL_MASS / (portalDist * portalDist)
      this._force.copy(this._toWorld).normalize().multiplyScalar(portalStrength)
      this._totalForce.add(this._force)
    }

    // ── World gravity ──
    for (const world of worlds.values()) {
      const worldScenePos = worldToScene(world.resolvedPosition)
      this._toWorld.copy(worldScenePos).sub(playerPos)
      const dist = Math.max(this._toWorld.length(), MIN_DISTANCE)

      // Track nearest
      if (dist < nearestDistance) {
        nearestDistance = dist
        nearestWorld = world
      }

      // Skip if too far
      if (dist > GRAVITY_RANGE) continue

      const mass = calculateWorldMass(world)
      let strength = G * mass / (dist * dist)

      // ── Slingshot boost ──
      // If the player is moving fast and passing tangentially,
      // boost the force slightly to create the slingshot feel
      const speed = playerVel.length()
      if (speed > 5.0 && dist < 3.0) {
        const velDir = playerVel.clone().normalize()
        const toWorldDir = this._toWorld.clone().normalize()
        const dot = Math.abs(velDir.dot(toWorldDir))
        // Tangential pass (dot near 0) gets a boost
        if (dot < 0.5) {
          strength *= 1.5
        }
      }

      // ── Orbit capture ──
      // When moving slowly near a world, add gentle tangential force
      // to create a natural orbit instead of falling in
      if (speed < 2.0 && dist < 3.0 && dist > 0.8) {
        orbitTarget = world
        // Add a tangential component (perpendicular to the attraction)
        const tangent = new THREE.Vector3()
          .crossVectors(this._toWorld, new THREE.Vector3(0, 1, 0))
          .normalize()
        const orbitStrength = strength * 0.3 * (1 - speed / 2.0)
        this._totalForce.addScaledVector(tangent, orbitStrength)
      }

      this._force.copy(this._toWorld).normalize().multiplyScalar(strength)
      this._totalForce.add(this._force)
    }

    const inOrbitRange = orbitTarget !== null

    return {
      force: this._totalForce.clone(),
      nearestWorld,
      nearestDistance,
      inOrbitRange,
      orbitTarget,
    }
  }
}

/** Singleton gravity system. */
export const gravitySystem = new GravitySystem()

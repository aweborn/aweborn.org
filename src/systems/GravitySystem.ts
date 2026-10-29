/**
 * Aweborn — Gravity System
 *
 * Client adapter over the shared gravity in `shared/sim/gravity.ts`
 * (Phase 09 9A: the same code the server will run). It builds the
 * `SimWorld` the flight step reads (gravity bodies + beginner leash) and
 * turns the sim's plain-number result into the THREE-flavored
 * `GravityResult` the scene uses for hints and visuals.
 *
 * Formula (per ROADMAP):
 *   attraction = G * worldMass / distance²
 *   worldMass  = f(playerCount, objectCount, age)
 *
 * Features (all in the shared sim now):
 *  - Inverse-square gravity from all nearby worlds
 *  - Aweborn Portal has the strongest fixed pull
 *  - Captured orbit: auto-settle when velocity is low near a world
 *  - Gravitational slingshot: speed boost from high-velocity passes
 */

import * as THREE from 'three'
import type { WorldEntry } from '@aweborn/shared/crdt-schema'
import {
  buildBodies, computeGravity, emptyGravity,
  type GravityOut, type SimBody, type SimWorld,
} from '@aweborn/shared/sim/gravity'

/**
 * World age (gravity mass bonus) is read at minute resolution: the sim must
 * not see the wall clock tick inside a step, and the server builds the same
 * view from its own clock (9B). The bonus moves at most 1/1440 per minute.
 */
const SIM_CLOCK_MS = 60_000

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
   */
  approachDragFactor: number
}

// ── Gravity System ───────────────────────────────────────────────────

class GravitySystem {
  private _bodies: SimBody[] = []
  private _bodiesFor: Map<string, WorldEntry> | null = null
  private _bodiesAt = -1
  private _world: SimWorld = { bodies: [], leashRadius: null }
  private _out: GravityOut = emptyGravity()

  /**
   * The sim's view of the universe right now. Bodies are rebuilt only when
   * the worlds map changes or the sim clock ticks over a minute.
   */
  simWorld(worlds: Map<string, WorldEntry>, leashRadius: number | null): SimWorld {
    const now = Math.floor(Date.now() / SIM_CLOCK_MS) * SIM_CLOCK_MS
    if (worlds !== this._bodiesFor || now !== this._bodiesAt) {
      this._bodies = buildBodies(worlds.values(), now)
      this._bodiesFor = worlds
      this._bodiesAt = now
    }
    if (this._world.bodies !== this._bodies || this._world.leashRadius !== leashRadius) {
      this._world = { bodies: this._bodies, leashRadius }
    }
    return this._world
  }

  /**
   * Calculate the total gravitational force on the player (outside the
   * fixed step: hints and visuals on frames with no physics tick).
   */
  calculate(
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    worlds: Map<string, WorldEntry>,
  ): GravityResult {
    const world = this.simWorld(worlds, this._world.leashRadius)
    const g = computeGravity(playerPos.x, playerPos.y, playerPos.z, playerVel.x, playerVel.y, playerVel.z, world.bodies, this._out)
    return this.resultFrom(g, world, worlds)
  }

  /** The sim's plain-number gravity → the scene's GravityResult. */
  resultFrom(g: GravityOut, world: SimWorld, worlds: Map<string, WorldEntry>): GravityResult {
    const nearestBody = g.nearest >= 0 ? world.bodies[g.nearest] : null
    const orbitTarget = g.orbit >= 0 ? worlds.get(world.bodies[g.orbit].id) ?? null : null
    return {
      force: new THREE.Vector3(g.fx, g.fy, g.fz),
      nearestWorld: nearestBody?.isWorld ? worlds.get(nearestBody.id) ?? null : null,
      nearestDistance: g.nearestDistance,
      nearestWorldPosition: nearestBody ? new THREE.Vector3(nearestBody.x, nearestBody.y, nearestBody.z) : null,
      inOrbitRange: orbitTarget !== null,
      orbitTarget,
      slingshotEvent: g.slingBody >= 0
        ? { worldId: world.bodies[g.slingBody].id, speed: g.slingSpeed, boostFactor: g.slingBoost }
        : null,
      approachDragFactor: g.approachDrag,
    }
  }
}

/** Singleton gravity system. */
export const gravitySystem = new GravitySystem()

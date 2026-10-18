/**
 * Aweborn — Interior Controller (Phase 07, Interior Movement)
 *
 * Runs the shared deterministic step (`shared/sim/interior.ts`) at a fixed
 * 60 Hz from the render loop, and maps the action state to its input.
 * Standard WASD inside a world (Alex, 2026-10-17); flight keys are unchanged:
 *
 *   W / S   move forward / back
 *   A / D   strafe left / right
 *   Q / E   turn left / right
 *   R / F   look up / down
 *   Space   jump; hold in the air = jetpack; in water = swim up
 *   K       sprint
 *
 * Touch/gamepad: the yaw/pitch sticks turn and look; the thrust button walks.
 */
import type { PhysicsParams } from '@aweborn/shared/crdt-schema'
import {
  stepInterior, spawnInterior, INTERIOR_DT,
  type Box, type InteriorInput, type InteriorState,
} from '@aweborn/shared/sim/interior'
import { inputManager } from './InputManager'

const MAX_SUBSTEPS = 4

class InteriorController {
  /** State after the latest fixed step. */
  state: InteriorState = spawnInterior()
  /** State before the latest step, for render interpolation. */
  prev: InteriorState = this.state
  private _acc = 0

  private _restore: Partial<InteriorState> | null = null

  /** The next reset() puts the player here instead of at the spawn point (returning to a saved spot). */
  restoreOnNextReset(at: Partial<InteriorState>): void {
    this._restore = at
  }

  /** Put the player at the spawn point (call on world entry). */
  reset(): void {
    this.state = { ...spawnInterior(), ...(this._restore ?? {}) }
    this._restore = null
    this.prev = this.state
    this._acc = 0
  }

  readInput(): InteriorInput {
    const a = inputManager.getActions()
    const b = (v: boolean) => (v ? 1 : 0)
    // Action names come from the flight map: A=rollRight, D=pitchDown,
    // Q=yawLeft, E=pitchUp, R=yawRight, F=rollLeft
    return {
      move: Math.max(-1, Math.min(1, b(a.thrust) - b(a.reverse) + inputManager.getAxis('moveY'))),
      strafe: Math.max(-1, Math.min(1, b(a.pitchDown) - b(a.rollRight) + inputManager.getAxis('moveX'))),
      turn: Math.max(-1, Math.min(1, b(a.pitchUp) - b(a.yawLeft) + inputManager.getAxis('yaw'))),
      look: Math.max(-1, Math.min(1, b(a.yawRight) - b(a.rollLeft) + inputManager.getAxis('pitch'))),
      jump: a.brake,
      sprint: a.warp,
    }
  }

  /**
   * Advance by a frame's delta. Returns the interpolation factor (0..1)
   * between `prev` and `state` for smooth rendering.
   */
  update(delta: number, physics: PhysicsParams, boxes: readonly Box[]): number {
    this._acc += Math.min(delta, 0.1)
    const input = this.readInput()
    let n = 0
    while (this._acc >= INTERIOR_DT && n < MAX_SUBSTEPS) {
      this.prev = this.state
      this.state = stepInterior(this.state, input, physics, boxes, INTERIOR_DT)
      this._acc -= INTERIOR_DT
      n++
    }
    if (n === MAX_SUBSTEPS) this._acc = 0
    return this._acc / INTERIOR_DT
  }
}

export const interiorController = new InteriorController()

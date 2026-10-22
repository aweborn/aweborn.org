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
 * Touch: left stick walks (rim = sprint), right-side drag looks, JUMP button.
 * Gamepad: the yaw/pitch sticks turn and look.
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
  /** Target third-person camera distance inside a world (presets 1–4 or pinch-to-zoom). */
  camDistGoal = 4.5
  private _acc = 0

  private _restore: Partial<InteriorState> | null = null

  /** The next reset() puts the player here instead of at the spawn point (returning to a saved spot). */
  restoreOnNextReset(at: Partial<InteriorState>): void {
    this._restore = at
  }

  /** Put the player at the spawn point (call on world entry). */
  reset(): void {
    const base = spawnInterior()
    if (this._restore) {
      this.state = { ...base, ...this._restore }
    } else {
      // Gentle scatter around (0, 0, 10) so crowds entering at once don't overlap on one spot
      const dx = (Math.random() - 0.5) * 4.5
      const dz = (Math.random() - 0.5) * 3.0
      this.state = { ...base, x: base.x + dx, z: base.z + dz }
    }
    this._restore = null
    this.prev = this.state
    this.camDistGoal = 4.5
    this._acc = 0
  }

  /**
   * Pinch-to-zoom camera distance in/out continuously across [3, 20].
   * `scaleFactor < 1` zooms in (spread fingers); `scaleFactor > 1` zooms out (pinch fingers).
   */
  zoomBy(scaleFactor: number): void {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return
    this.camDistGoal = Math.max(3, Math.min(20, this.camDistGoal * scaleFactor))
  }

  /**
   * Raise the player's feet to `y` if they're below it (terrain appeared under them).
   * Terrain boxes only let you step up ~1 voxel, so someone inside a 3-voxel ground
   * would otherwise be shoved sideways along its edge and be unable to walk anywhere.
   */
  liftTo(y: number): void {
    if (this.state.y >= y) return
    this.state = { ...this.state, y, vy: 0, grounded: true }
    this.prev = this.state
  }

  readInput(): InteriorInput {
    const a = inputManager.getActions()
    const b = (v: boolean) => (v ? 1 : 0)
    // Action names come from the flight map: A=rollRight, D=pitchDown,
    // Q=yawLeft, E=pitchUp, R=yawRight, F=rollLeft
    return {
      move: Math.max(-1, Math.min(1, b(a.thrust) - b(a.reverse) + inputManager.getAxis('moveY'))),
      strafe: Math.max(-1, Math.min(1, b(a.pitchDown) - b(a.rollRight) + inputManager.getAxis('moveX'))),
      turn: Math.max(-1, Math.min(1, b(a.pitchUp) - b(a.yawLeft) + inputManager.getAxis('yaw') + inputManager.getAxis('lookYaw'))),
      look: Math.max(-1, Math.min(1, b(a.yawRight) - b(a.rollLeft) + inputManager.getAxis('pitch') + inputManager.getAxis('lookPitch'))),
      jump: a.brake,
      sprint: a.warp,
    }
  }

  /**
   * Advance by a frame's delta. Returns the interpolation factor (0..1)
   * between `prev` and `state` for smooth rendering.
   */
  update(delta: number, physics: PhysicsParams, boxes: readonly Box[], halfExtent?: number): number {
    this._acc += Math.min(delta, 0.1)
    const input = this.readInput()
    let n = 0
    while (this._acc >= INTERIOR_DT && n < MAX_SUBSTEPS) {
      this.prev = this.state
      this.state = stepInterior(this.state, input, physics, boxes, INTERIOR_DT, halfExtent)
      this._acc -= INTERIOR_DT
      n++
    }
    if (n === MAX_SUBSTEPS) this._acc = 0
    return this._acc / INTERIOR_DT
  }
}

export const interiorController = new InteriorController()

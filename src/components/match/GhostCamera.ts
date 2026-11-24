import type * as THREE from 'three'
import { boundsOf, type Game } from '@aweborn/shared/game'
import { inputManager } from '../../systems/InputManager'
import { useWorldStore } from '../../stores/worldStore'
import { currentView, useViewStore } from '../../lib/matchView'

/**
 * The ghost camera (Phase 10, spectating): a free camera that flies inside the match on
 * view while your body stays where it stands in the lobby. Only a camera: nothing is
 * sent to anyone, so the players in the match can't see it.
 *
 * Scene.tsx's InteriorSystem asks `ghostCam.active` each frame: while it is on, the body
 * is given no time to move and the camera pose comes from `apply` here. The move stick /
 * WASD flies along where you look, the look stick / Q E R F turns, jump rises, sprint is
 * fast. Following a player trails them; moving the stick lets go.
 */

const SPEED = 9
const FAST = 22
const TURN = 1.9
const LOOK = 1.3
const PITCH_MAX = 1.35
const TRAIL = 6
/** How far outside the arena the ghost may drift. */
const MARGIN = 20

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

class GhostCam {
  active = false
  x = 0
  y = 0
  z = 0
  /** 0 looks down -Z; turning right lowers it. */
  yaw = 0
  pitch = -0.3

  /** Start above the arena's edge on the lobby's side, looking at its middle. */
  enter(game: Game | null, from: { x: number; y: number; z: number }): void {
    const a = game?.arena
    if (a) {
      const dx = from.x - a.at[0]
      const dz = from.z - a.at[2]
      const len = Math.hypot(dx, dz) || 1
      const r = Math.max(a.size[0], a.size[2]) * 0.45 + 2
      this.x = a.at[0] + (dx / len) * r
      this.z = a.at[2] + (dz / len) * r
      this.y = a.at[1] + Math.min(a.size[1] * 0.8, 3 + r * 0.45)
      this.yaw = Math.atan2(dx, dz)
      this.pitch = -Math.atan2(this.y - a.at[1] - 1, r)
    } else {
      this.x = from.x
      this.y = from.y + 3
      this.z = from.z
    }
    this.active = true
  }

  apply(camera: THREE.Camera, delta: number): void {
    const dt = Math.min(delta, 0.1)
    const a = inputManager.getActions()
    const b = (v: boolean) => (v ? 1 : 0)
    // Same keys and sticks as walking (InteriorController.readInput)
    const move = clamp(b(a.thrust) - b(a.reverse) + inputManager.getAxis('moveY'), -1, 1)
    const strafe = clamp(b(a.pitchDown) - b(a.rollRight) + inputManager.getAxis('moveX'), -1, 1)
    const turn = clamp(b(a.pitchUp) - b(a.yawLeft) + inputManager.getAxis('yaw') + inputManager.getAxis('lookYaw'), -1, 1)
    const look = clamp(b(a.yawRight) - b(a.rollLeft) + inputManager.getAxis('pitch') + inputManager.getAxis('lookPitch'), -1, 1)
    this.yaw -= turn * TURN * dt
    this.pitch = clamp(this.pitch + look * LOOK * dt, -PITCH_MAX, PITCH_MAX)
    const cp = Math.cos(this.pitch)
    const fx = -Math.sin(this.yaw) * cp
    const fy = Math.sin(this.pitch)
    const fz = -Math.cos(this.yaw) * cp

    const game = useWorldStore.getState().meta?.game ?? null
    const view = currentView(game)
    const follow = useViewStore.getState().follow
    const steering = Math.abs(move) + Math.abs(strafe) > 0.25 || a.brake
    if (follow !== null && steering) useViewStore.setState({ follow: null })
    const target = follow !== null && !steering ? view?.frame()?.players.find((p) => p.slot === follow) : undefined
    if (target) {
      // Trail the player: the look stick orbits around them
      const k = 1 - Math.exp(-8 * dt)
      this.x += (target.x - fx * TRAIL - this.x) * k
      this.y += (Math.max(target.y + 0.6, target.y + 1.4 - fy * TRAIL) - this.y) * k
      this.z += (target.z - fz * TRAIL - this.z) * k
      camera.position.set(this.x, this.y, this.z)
      camera.up.set(0, 1, 0)
      camera.lookAt(target.x, target.y + 1.4, target.z)
      return
    }
    const v = (a.warp ? FAST : SPEED) * dt
    this.x += (fx * move + Math.cos(this.yaw) * strafe) * v
    this.y += (fy * move + b(a.brake)) * v
    this.z += (fz * move - Math.sin(this.yaw) * strafe) * v
    const arena = (view?.game ?? game)?.arena
    if (arena) {
      const bb = boundsOf(arena)
      this.x = clamp(this.x, bb.minX - MARGIN, bb.maxX + MARGIN)
      this.y = clamp(this.y, bb.minY + 0.4, bb.maxY + MARGIN)
      this.z = clamp(this.z, bb.minZ - MARGIN, bb.maxZ + MARGIN)
    }
    camera.position.set(this.x, this.y, this.z)
    camera.up.set(0, 1, 0)
    camera.lookAt(this.x + fx, this.y + fy, this.z + fz)
  }
}

export const ghostCam = new GhostCam()

// The store's flag is what the screen shows; the camera follows it (so closing a replay or tuning out ends the flight)
useViewStore.subscribe((s) => {
  if (!s.ghost && ghostCam.active) ghostCam.active = false
})

/** Fly in: the camera leaves the body where it stands. */
export function enterGhost(game: Game | null, from: { x: number; y: number; z: number }): void {
  ghostCam.enter(game, from)
  useViewStore.setState({ ghost: true, follow: null, sheet: false })
}

/** Back to my body. */
export function leaveGhost(): void {
  ghostCam.active = false
  useViewStore.setState({ ghost: false, follow: null })
}

/** Follow the next player in the roster (after the last one: free flight again). */
export function cycleFollow(slots: readonly number[]): void {
  const cur = useViewStore.getState().follow
  const i = cur === null ? -1 : slots.indexOf(cur)
  const next = i + 1 < slots.length ? slots[i + 1] : null
  useViewStore.setState({ follow: next })
}

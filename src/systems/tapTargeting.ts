/**
 * Tap targeting (touch, 2026-10-22; docs/mobile-ui/SPEC.md): tap a planet to
 * lock on (the LOCK button is gone), and the scene's "can enter" state so the
 * contextual ENTER button only shows when it would do something.
 *
 * Scene writes the camera + hints every frame; the touch adapter reads them.
 */
import * as THREE from 'three'
import { warpSystem } from './WarpSystem'

/** How near (CSS px) a tap must land to a planet's centre to pick it. */
const PICK_RADIUS_PX = 56

let pickCamera: THREE.Camera | null = null
const _v = new THREE.Vector3()

/** Per-frame facts the touch UI needs (written by Scene's flight loop). */
export const sceneHints = {
  /** Space: a world is close enough that ENTER (N) would go in. */
  canEnter: false,
}

export function setPickCamera(camera: THREE.Camera): void {
  pickCamera = camera
}

/**
 * Where the radar drew each lockable blip last frame (radar canvas CSS px,
 * 0..160). Written by RadarMinimap; read by its tap handler and the e2e check.
 */
export const radarHits: { id: string; x: number; y: number }[] = []

/** A world's centre on screen (CSS px), or null if behind the camera / unknown. */
export function worldScreenPos(worldId: string): { x: number; y: number } | null {
  const canvas = document.querySelector('.canvas-container canvas')
  const c = warpSystem.getState().candidates.find((x) => x.world.id === worldId)
  if (!pickCamera || !canvas || !c) return null
  const rect = canvas.getBoundingClientRect()
  _v.copy(c.scenePos).project(pickCamera)
  if (_v.z >= 1) return null
  return { x: rect.left + (_v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-_v.y * 0.5 + 0.5) * rect.height }
}

/**
 * The lockable world (in warp range, in front of the camera) whose centre is
 * nearest the tap, within PICK_RADIUS_PX; null if none.
 */
export function pickWorldAt(clientX: number, clientY: number): string | null {
  const canvas = document.querySelector('.canvas-container canvas')
  if (!pickCamera || !canvas) return null
  const rect = canvas.getBoundingClientRect()
  let best: string | null = null
  let bestD = PICK_RADIUS_PX
  for (const c of warpSystem.getState().candidates) {
    _v.copy(c.scenePos).project(pickCamera)
    if (_v.z >= 1) continue // behind the camera
    const sx = rect.left + (_v.x * 0.5 + 0.5) * rect.width
    const sy = rect.top + (-_v.y * 0.5 + 0.5) * rect.height
    const d = Math.hypot(sx - clientX, sy - clientY)
    if (d < bestD) {
      bestD = d
      best = c.world.id
    }
  }
  return best
}

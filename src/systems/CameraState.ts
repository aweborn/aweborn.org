import * as THREE from 'three'

/**
 * Shared camera state — single source of truth for the *rendered* camera
 * position and orientation.
 *
 * Written by Scene.tsx (inside R3F's useFrame, *after* CameraController.update).
 * Read by any consumer that needs to know where the camera actually is
 * (e.g. RadarMinimap, UI overlays).
 *
 * This ensures all systems that depend on "what the player sees" are
 * synchronized with the actual camera, not independently polling raw physics.
 */

class CameraState {
  /** Camera world position (updated every R3F frame) */
  readonly position = new THREE.Vector3()

  /** Camera world quaternion (updated every R3F frame) */
  readonly quaternion = new THREE.Quaternion()

  /** Frame counter — incremented on each write so readers can detect changes */
  frame = 0

  /** Called by Scene.tsx after CameraController.update each frame */
  write(camera: THREE.Camera): void {
    this.position.copy(camera.position)
    this.quaternion.copy(camera.quaternion)
    this.frame++
  }
}

/** Singleton — import this wherever you need the rendered camera state */
export const cameraState = new CameraState()

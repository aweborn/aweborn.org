import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Environment } from './Environment'
import { DonationPortal } from './DonationPortal'
import { UniverseWorlds } from './UniverseWorlds'
import { PlayerStars } from './PlayerStars'
import { PlayerOrb, triggerSlingshotPulse } from './PlayerOrb'
import { WarpEffect } from './WarpEffect'
import { GravityFieldLines } from './GravityFieldLines'
import { SlingshotArc } from './SlingshotArc'
import { PortalBeacon } from './PortalBeacon'
import { WorldTransition } from './WorldTransition'
import { WorldInterior } from './WorldInterior'
import { useUniverseStore } from '../stores/universeStore'
import { usePresence } from '../hooks/usePresence'
import { inputManager } from '../systems/InputManager'
import { flightController } from '../systems/FlightController'
import { cameraController } from '../systems/CameraController'
import { gravitySystem } from '../systems/GravitySystem'
import { warpSystem } from '../systems/WarpSystem'
import { starModSlots } from '../systems/StarModSlots'
import { touchInputAdapter } from '../systems/TouchInputAdapter'
import { gamepadInputAdapter } from '../systems/GamepadInputAdapter'
import { TouchInputAdapter } from '../systems/TouchInputAdapter'

// ── Module-level slingshot visual state ──
// Shared between FlightSystem (writer) and SlingshotArc/UniverseView (reader)
// These update every frame in useFrame, so they can't be React props.
export let _slingshotActive = false
export let _slingshotWorldPos: THREE.Vector3 | null = null

/**
 * Slingshot impulse multiplier — scales the velocity burst on slingshot exit.
 * Higher = more dramatic speed boost. Applied once per slingshot pass.
 */
const SLINGSHOT_IMPULSE_MULTIPLIER = .1

interface SceneProps {
  onPortalActivate: () => void
  onProgress: (progress: number) => void
}

/**
 * Flight System — runs the input → flight → gravity → warp → camera pipeline
 * each frame inside the R3F render loop.
 *
 * This is a headless component (no JSX output) that drives the player's
 * movement and camera position.
 */
function FlightSystem() {
  const { camera } = useThree()
  const worlds = useUniverseStore((s) => s.worlds)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const updatePlayerState = useUniverseStore((s) => s.updatePlayerState)
  const setCameraPosition = useUniverseStore((s) => s.setCameraPosition)

  const { updatePosition } = usePresence()

  const isInWorld = activeWorldId !== null
  const hasSnapped = useRef(false)

  // Initialize input manager + adapters on mount
  useEffect(() => {
    inputManager.init()

    // Auto-activate touch adapter on touch devices
    if (TouchInputAdapter.isSupported()) {
      touchInputAdapter.activate()
    }

    // Always activate gamepad adapter (auto-detects connection)
    gamepadInputAdapter.activate()

    return () => {
      inputManager.destroy()
      touchInputAdapter.deactivate()
      gamepadInputAdapter.deactivate()
    }
  }, [])

  // Handle context switching
  useEffect(() => {
    if (isInWorld) {
      inputManager.setContext('world')
      flightController.setEnabled(false)
      warpSystem.cancel() // Cancel any active warp on world entry
    } else {
      inputManager.setContext('universe')
      flightController.setEnabled(true)
      cameraController.reset()
      hasSnapped.current = false
    }
  }, [isInWorld])

  /**
   * Fixed physics timestep (seconds).
   * Physics runs at 60Hz regardless of framerate for deterministic behavior.
   * Camera and visuals still update every render frame for smoothness.
   */
  const PHYSICS_DT = 1 / 60
  const MAX_SUBSTEPS = 4 // safety cap to prevent spiral-of-death at very low fps
  const physicsAccumulator = useRef(0)
  const lastSlingshotWorld = useRef<string | null>(null)

  useFrame((_state, delta) => {
    // Process input edge events at frame start
    inputManager.beginFrame()

    // ── Star mod slots (always process, even in world) ──
    starModSlots.update()

    if (isInWorld) return // Flight is disabled inside worlds

    // ── Fixed-timestep physics accumulator ──
    // Accumulate frame time, then step physics in fixed increments.
    // This ensures gravity, thrust, and slingshot behavior is identical
    // regardless of whether the player is at 30fps or 144fps.
    physicsAccumulator.current += Math.min(delta, 0.1) // clamp to prevent huge jumps on tab-refocus
    let substeps = 0
    let gravResult = gravitySystem.calculate(
      flightController.position,
      flightController.velocity,
      worlds,
    )

    while (physicsAccumulator.current >= PHYSICS_DT && substeps < MAX_SUBSTEPS) {
      // Recalculate gravity each substep (position changes between steps)
      gravResult = gravitySystem.calculate(
        flightController.position,
        flightController.velocity,
        worlds,
      )

      // ── Approach drag (NEUTRAL only) ──
      // Dampen only the approach component of velocity when heading toward a world.
      // Preserves tangential speed so slingshot passes still work.
      if (flightController.isGravityEnabled() && gravResult.approachDragFactor > 0.01 && gravResult.nearestWorldPosition) {
        const toWorld = gravResult.nearestWorldPosition.clone().sub(flightController.position).normalize()
        const approachSpeed = flightController.velocity.dot(toWorld)
        if (approachSpeed > 0) {
          // Only remove a fraction of the approach component
          const dampen = approachSpeed * gravResult.approachDragFactor * PHYSICS_DT * 2.0
          flightController.velocity.addScaledVector(toWorld, -dampen)
        }
      }

      // ── Gravity well dead zone (NEUTRAL only) ──
      // Snap to zero at near-zero speed right at the center,
      // but ONLY when the player isn't thrusting (so they can escape).
      const actions = inputManager.getActions()
      if (flightController.isGravityEnabled() && gravResult.nearestDistance < 2.5 && !actions.thrust) {
        const speed = flightController.velocity.length()
        if (speed < 0.5) {
          flightController.velocity.set(0, 0, 0)
          gravResult.force.set(0, 0, 0)
        }
      }

      // ── Slingshot turn dampening (NEUTRAL only) ──
      if (gravResult.slingshotEvent && flightController.isGravityEnabled()) {
        flightController.setSlingshotTurnDampen(1.0)
      } else {
        flightController.setSlingshotTurnDampen(0.0)
      }

      // Warp system (uses its own dt-based logic)
      warpSystem.update(PHYSICS_DT, flightController.position, worlds)

      // Flight physics (skip if warping — warp system handles position)
      const warpState = warpSystem.getState()
      if (warpState.phase !== 'leaping') {
        flightController.update(PHYSICS_DT, gravResult.force)
      }

      physicsAccumulator.current -= PHYSICS_DT
      substeps++
    }

    // ── Camera (per-frame for smooth visuals) ──
    if (!hasSnapped.current) {
      cameraController.snapToTarget(camera, flightController.position, flightController.quaternion)
      hasSnapped.current = true
    } else {
      cameraController.update(
        delta,
        camera,
        flightController.position,
        flightController.quaternion,
        flightController.velocity,
      )
    }

    // ── Project locked target to screen space (for crosshair tracking) ──
    const warpState = warpSystem.getState()
    const warpLockPos = warpState.lockedTargetPosition
    if (warpLockPos && (warpState.phase === 'locked' || warpState.phase === 'charging')) {
      const projected = warpLockPos.clone().project(camera)
      // projected.x/y are in NDC (-1 to 1), convert to CSS percentages
      const screenX = (projected.x * 0.5 + 0.5) * 100
      const screenY = (-projected.y * 0.5 + 0.5) * 100
      // Only show if target is in front of the camera (z < 1)
      if (projected.z < 1) {
        warpSystem.setTargetScreenPos({ x: screenX, y: screenY })
      } else {
        warpSystem.setTargetScreenPos(null)
      }
    } else {
      warpSystem.setTargetScreenPos(null)
    }

    // ── Update stores ──
    const pos = flightController.position
    const vel = flightController.velocity
    const rot = flightController.quaternion

    updatePlayerState(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: vel.x, y: vel.y, z: vel.z },
      { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      flightController.getState().speed,
    )

    setCameraPosition({ x: pos.x, y: pos.y, z: pos.z })

    // ── Broadcast presence ──
    updatePosition(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: vel.x, y: vel.y, z: vel.z },
      activeWorldId,
    )

    // ── Gravity toggle (G key) ──
    const events = inputManager.getEvents()
    if (events.justPressed.has('gravityToggle')) {
      flightController.toggleGravity()
    }

    // ── Slingshot event (velocity impulse + VFX + mana hook) ──
    if (gravResult.slingshotEvent && flightController.isGravityEnabled()) {
      const { worldId, speed, boostFactor } = gravResult.slingshotEvent

      // Direct velocity impulse — this is what makes the slingshot FEEL fast.
      // Only apply once per slingshot (not every substep).
      if (lastSlingshotWorld.current !== worldId) {
        lastSlingshotWorld.current = worldId
        const velDir = flightController.velocity.clone().normalize()
        const impulse = speed * (boostFactor - 1.0) * SLINGSHOT_IMPULSE_MULTIPLIER
        flightController.velocity.addScaledVector(velDir, impulse)
        console.log(`[SLINGSHOT] world=${worldId} speed=${speed.toFixed(1)} boost=${boostFactor.toFixed(2)}× impulse=+${impulse.toFixed(1)}`)
      }

      triggerSlingshotPulse()
      _slingshotActive = true
      _slingshotWorldPos = gravResult.nearestWorldPosition
      // TODO: Phase 2 — dispatch to mana system:
      // manaSystem.onSlingshotEvent(gravResult.slingshotEvent)
    } else {
      _slingshotActive = false
      lastSlingshotWorld.current = null
      // Keep worldPos alive briefly for fade-out (SlingshotArc handles its own fade)
    }

    // ── World entry: press N near a world ──
    if (events.justPressed.has('interact') && gravResult.nearestWorld && gravResult.nearestDistance < 3.0) {
      useUniverseStore.getState().enterWorld(gravResult.nearestWorld.id)
    }
  })

  return null
}

/**
 * World Escape Handler — listens for Escape key to exit worlds.
 * Separate component so it can run even when flight is disabled.
 */
function WorldEscapeHandler() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)

  useFrame(() => {
    if (!activeWorldId) return
    const events = inputManager.getEvents()
    if (events.justPressed.has('escape')) {
      useUniverseStore.getState().exitWorld()
    }
  })

  return null
}

/**
 * Universe view — the star map with worlds, players, and the portal.
 * Hidden when the player is inside a world.
 */
function UniverseView({ onPortalActivate, playerColor }: { onPortalActivate: () => void; playerColor: string }) {
  return (
    <>
      {/* Environment — the cosmos (starfield, clouds, nebula) */}
      <Environment />

      {/* Synced worlds from Universe CRDT (with LOD) */}
      <UniverseWorlds />

      {/* Gravity field lines — faint curved lines near worlds */}
      <GravityFieldLines />

      {/* Slingshot arc — reads shared state directly in useFrame */}
      <SlingshotArc />

      {/* Other players as glowing orbs */}
      <PlayerStars />

      {/* Local player orb (the camera follows this) */}
      <PlayerOrb color={playerColor} />

      {/* Warp visual effects (charge streaks, leap flash, arrival) */}
      <WarpEffect />

      {/* Donation Portal — the discoverable object */}
      <DonationPortal onActivate={onPortalActivate} />

      {/* Portal Beacon — faint golden light beam for wayfinding */}
      <PortalBeacon />
    </>
  )
}

/**
 * Interior camera — simple orbit-like camera for world interior.
 * Uses a fixed position looking at the center of the world.
 */
function InteriorCamera() {
  const { camera } = useThree()

  useEffect(() => {
    camera.position.set(0, 5, 8)
    camera.lookAt(0, 1, 0)
  }, [camera])

  // Gentle slow rotation for interior ambiance
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const radius = 8
    camera.position.x = Math.sin(t * 0.05) * radius
    camera.position.z = Math.cos(t * 0.05) * radius
    camera.position.y = 4 + Math.sin(t * 0.08) * 0.5
    camera.lookAt(0, 1, 0)
  })

  return null
}

function SceneContent({ onPortalActivate }: { onPortalActivate: () => void }) {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const isInWorld = activeWorldId !== null

  // Get player color from presence (stored in sessionStorage)
  const { playerColor } = usePresence()

  return (
    <>
      {/* Flight system — drives player movement + camera */}
      <FlightSystem />

      {/* World escape handler */}
      <WorldEscapeHandler />

      {/* Interior camera (only when in a world) */}
      {isInWorld && <InteriorCamera />}

      {/* Fog — different for universe vs world interior */}
      <fog attach="fog" args={[
        isInWorld ? '#050510' : '#050510',
        isInWorld ? 15 : 30,
        isInWorld ? 50 : 250,
      ]} />

      {/* Universe view — star map (hidden when inside a world) */}
      {!isInWorld && <UniverseView onPortalActivate={onPortalActivate} playerColor={playerColor} />}

      {/* World interior — inside a world (shown when entered) */}
      {isInWorld && <WorldInterior />}

      {/* Post-processing */}
      <EffectComposer multisampling={0}>
        <Bloom
          luminanceThreshold={0.35}
          luminanceSmoothing={0.9}
          intensity={isInWorld ? 0.8 : 1.2}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.15} darkness={isInWorld ? 0.6 : 0.8} />
      </EffectComposer>

      <Preload all />
    </>
  )
}

export function Scene({ onPortalActivate, onProgress }: SceneProps) {
  const [, setReady] = useState(false)

  const handleCreated = useCallback(() => {
    // Simulate loading progress (assets are lightweight for this scene)
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 15 + 5
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)
        setReady(true)
      }
      onProgress(progress)
    }, 200)
  }, [onProgress])

  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [0, 2, 60], fov: 60, near: 0.1, far: 500 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: 3, // ACESFilmicToneMapping
          toneMappingExposure: 1.0,
        }}
        onCreated={handleCreated}
      >
        <Suspense fallback={null}>
          <SceneContent onPortalActivate={onPortalActivate} />
        </Suspense>
      </Canvas>

      {/* World transition overlay (CSS-based, outside Canvas) */}
      <WorldTransition />
    </div>
  )
}

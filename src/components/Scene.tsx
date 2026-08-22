import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Preload } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { Environment } from './Environment'
import { DonationPortal } from './DonationPortal'
import { UniverseWorlds } from './UniverseWorlds'
import { PlayerStars } from './PlayerStars'
import { PlayerOrb } from './PlayerOrb'
import { WarpEffect } from './WarpEffect'
import { GravityFieldLines } from './GravityFieldLines'
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

  useFrame((_state, delta) => {
    // Process input edge events at frame start
    inputManager.beginFrame()

    // ── Star mod slots (always process, even in world) ──
    starModSlots.update()

    if (isInWorld) return // Flight is disabled inside worlds

    // ── Gravity ──
    const gravResult = gravitySystem.calculate(
      flightController.position,
      flightController.velocity,
      worlds,
    )

    // ── Warp system ──
    warpSystem.update(delta, flightController.position, worlds)

    // ── Flight physics (skip if warping — warp system handles position) ──
    const warpState = warpSystem.getState()
    if (warpState.phase !== 'leaping') {
      flightController.update(delta, gravResult.force)
    }

    // ── Camera ──
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

    // ── World entry: press N near a world ──
    const events = inputManager.getEvents()
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

      {/* Other players as glowing orbs */}
      <PlayerStars />

      {/* Local player orb (the camera follows this) */}
      <PlayerOrb color={playerColor} />

      {/* Warp visual effects (charge streaks, leap flash, arrival) */}
      <WarpEffect />

      {/* Donation Portal — the discoverable object */}
      <DonationPortal onActivate={onPortalActivate} />
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
        isInWorld ? 15 : 8,
        isInWorld ? 50 : 60,
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
        camera={{ position: [0, 2, 10], fov: 60, near: 0.1, far: 200 }}
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

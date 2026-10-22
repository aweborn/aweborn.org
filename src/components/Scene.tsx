import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor, Preload } from '@react-three/drei'
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
import { useWorldStore, kickObject, settleObject, moveObject } from '../stores/worldStore'
import { interiorController } from '../systems/InteriorController'
import { useModelShapes, modelColliders } from '../stores/modelShapes'
import { collidersFor, kickTarget, kickVelocity, kickedPosition, KICK_SETTLE_SEC, type Box } from '@aweborn/shared/sim/interior'
import { usePlannerStore } from '../stores/plannerStore'
import { chunksAround, placeOnTerrain, sameTerrain, halfExtentOf, COLLIDE_RADIUS } from '../stores/worldVoxels'
import { usePlayerChunk } from '../hooks/usePlayerChunk'
import { useAtmosphere } from '../hooks/useAtmosphere'
import { usePresence, getPresenceState } from '../hooks/usePresence'
import { ChatBubble } from './ChatBubble'
import { inputManager } from '../systems/InputManager'
import { flightController } from '../systems/FlightController'
import { cameraController } from '../systems/CameraController'
import { gravitySystem } from '../systems/GravitySystem'
import { warpSystem } from '../systems/WarpSystem'
import { teleportSystem } from '../systems/TeleportSystem'
import { starModSlots } from '../systems/StarModSlots'
import { touchInputAdapter } from '../systems/TouchInputAdapter'
import { gamepadInputAdapter } from '../systems/GamepadInputAdapter'
import { TouchInputAdapter } from '../systems/TouchInputAdapter'
import { SolidificationWave } from '../effects/SolidificationWave'
import { useQualityStore, useQualityTier } from '../stores/qualityStore'
import { matchesBinding } from '../stores/keybindingStore'

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

    // Latch J / Esc for the fixed-step warp logic below (a frame may have 0..4 steps)
    warpSystem.captureInput()

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

    // ── Camera (per-frame for smooth visuals; snap on first frame + after teleports / remote warps) ──
    const teleportSnap = teleportSystem.consumeSnapRequest()
    const warpSnap = warpSystem.consumeSnapRequest()
    if (!hasSnapped.current || teleportSnap || warpSnap) {
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

      {/* Living Frontier edge + the golden wave on new gifts (Phase 05) */}
      <SolidificationWave />
    </>
  )
}

/**
 * Interior system (Phase 07): steps the shared interior movement sim,
 * draws the local player, and runs a third-person follow camera.
 */
/** 1 close · 2 medium · 3 far · 4 cinematic (same keys as flight) */
/** Where a carried object sits: in front of the player, at the height it was picked up from. */
function carryPosition(
  s: { x: number; y: number; z: number; fx: number; fz: number },
  h: { dist: number; lift: number },
  o: { scaleY: number },
): { x: number; y: number; z: number } {
  return { x: s.x + s.fx * h.dist, y: Math.max(s.y + h.lift, Math.abs(o.scaleY || 1) / 2), z: s.z + s.fz * h.dist }
}

function scaleOf(h: { k: number; base: { x: number; y: number; z: number } }) {
  return { x: h.base.x * h.k, y: h.base.y * h.k, z: h.base.z * h.k }
}

const CAM_DISTANCES = { 1: 3, 2: 4.5, 3: 9, 4: 20 } as const
const CAM_KEYS: Record<string, keyof typeof CAM_DISTANCES> = { cameraClose: 1, cameraMedium: 2, cameraFar: 3, cameraCinematic: 4 }
const NO_BOXES: Box[] = []
const EYE_HEIGHT = 1.5

function InteriorSystem({ playerColor }: { playerColor: string }) {
  const { camera } = useThree()
  const { updatePosition, playerId } = usePresence()
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const avatar = useRef<THREE.Group>(null!)
  const objects = useWorldStore((s) => s.objects)
  const ghostVisible = usePlannerStore((s) => s.visible && s.worldId === activeWorldId)
  const ghostTerrain = usePlannerStore((s) => s.blueprint?.terrain)
  const voxelTerrain = useWorldStore((s) => s.voxelTerrain)
  // Terrain collides one chunk neighborhood at a time, following the player
  const refTerrain = voxelTerrain ?? ghostTerrain
  const [pcx, pcz] = usePlayerChunk(refTerrain)
  const halfExtent = refTerrain ? halfExtentOf(refTerrain) : undefined
  const shapes = useModelShapes((s) => s.shapes)
  // Grab (G): carry the object in front of you; Z / X turn it; G again sets it down
  const [heldId, setHeldId] = useState<string | null>(null)
  const held = useRef<{ id: string; rotY: number; dist: number; lift: number; lastWrite: number; k: number; base: { x: number; y: number; z: number } } | null>(null)
  const turnKeys = useRef({ z: false, x: false, r: false, f: false })
  const boxes = useMemo(() => {
    const near = (t: NonNullable<typeof refTerrain>) => chunksAround(t, pcx, pcz, COLLIDE_RADIUS).flatMap((c) => c.colliders)
    const real = voxelTerrain ? near(voxelTerrain) : NO_BOXES
    const ghost = ghostVisible && ghostTerrain && !sameTerrain(voxelTerrain, ghostTerrain) ? near(ghostTerrain) : NO_BOXES
    const solid = Array.from(objects.values()).filter((o) => !o.kick && o.id !== heldId)
    const out: Box[] = []
    for (const o of solid) {
      // Generated models collide with their actual shape; until it loads, they don't block
      if (o.type === 'model') out.push(...(modelColliders(o, shapes) ?? []))
      else out.push(...collidersFor([o]))
    }
    return [...out, ...real, ...ghost]
  }, [objects, ghostVisible, ghostTerrain, voxelTerrain, heldId, shapes, pcx, pcz])

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return
      if (matchesBinding(e, 'heldRotateLeft')) turnKeys.current.z = true
      if (matchesBinding(e, 'heldRotateRight')) turnKeys.current.x = true
      if (matchesBinding(e, 'heldGrow')) turnKeys.current.r = true
      if (matchesBinding(e, 'heldShrink')) turnKeys.current.f = true
      if (!matchesBinding(e, 'carry') || e.repeat) return
      const doc = useUniverseStore.getState().activeWorldDoc
      const s = interiorController.state
      if (held.current) {
        // Set it down where it is now
        const o = useWorldStore.getState().objects.get(held.current.id)
        if (doc && o) {
          const p = carryPosition(s, held.current, { scaleY: scaleOf(held.current).y })
          moveObject(doc, o.id, p, held.current.rotY, scaleOf(held.current))
        }
        held.current = null
        setHeldId(null)
        return
      }
      const all = Array.from(useWorldStore.getState().objects.values()).filter((o) => !o.kick)
      const target = kickTarget(s, all)
      if (!target) return
      const half = 0.5 * Math.max(Math.abs(target.scaleX || 1), Math.abs(target.scaleZ || 1))
      held.current = { id: target.id, rotY: target.rotY ?? 0, dist: half + 1.2, lift: target.y - s.y, lastWrite: 0, k: Math.min(1, 30 / Math.max(Math.abs(target.scaleX || 1), Math.abs(target.scaleY || 1), Math.abs(target.scaleZ || 1))), base: { x: target.scaleX || 1, y: target.scaleY || 1, z: target.scaleZ || 1 } }
      setHeldId(target.id)
    }
    const up = (e: KeyboardEvent) => {
      if (matchesBinding(e, 'heldRotateLeft')) turnKeys.current.z = false
      if (matchesBinding(e, 'heldRotateRight')) turnKeys.current.x = false
      if (matchesBinding(e, 'heldGrow')) turnKeys.current.r = false
      if (matchesBinding(e, 'heldShrink')) turnKeys.current.f = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  const camTarget = useRef(new THREE.Vector3())
  const camPos = useRef(new THREE.Vector3())
  const camDist = useRef<number>(CAM_DISTANCES[2])
  const camDistGoal = useRef<number>(CAM_DISTANCES[2])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const id = Object.keys(CAM_KEYS).find((a) => matchesBinding(e, a))
      const k = id ? CAM_KEYS[id] : undefined
      if (k) camDistGoal.current = CAM_DISTANCES[k]
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    interiorController.reset()
    // Flight rolls camera.up with the ship; interiors are always upright
    camera.up.set(0, 1, 0)
    const s = interiorController.state
    camTarget.current.set(s.x, s.y + EYE_HEIGHT, s.z)
    camPos.current.set(s.x - s.fx * camDist.current, s.y + EYE_HEIGHT + 1, s.z - s.fz * camDist.current)
    camera.position.copy(camPos.current)
    camera.lookAt(camTarget.current)
  }, [camera])

  // New or reshaped terrain under the player: stand on top of it, not inside it
  useEffect(() => {
    if (!refTerrain) return
    const s = interiorController.state
    const surface = placeOnTerrain(refTerrain, [s.x + refTerrain.size[0] / 2, 0, s.z + refTerrain.size[2] / 2]).y
    interiorController.liftTo(surface)
  }, [refTerrain])

  useFrame((_state, delta) => {
    const physics = useWorldStore.getState().physics
    // Hold still until the world has loaded: its terrain isn't there to stand on yet
    const t = useWorldStore.getState().loaded ? interiorController.update(delta, physics, boxes, halfExtent) : 1
    const p = interiorController.prev
    const s = interiorController.state
    const x = p.x + (s.x - p.x) * t
    const y = p.y + (s.y - p.y) * t
    const z = p.z + (s.z - p.z) * t

    if (avatar.current) {
      avatar.current.position.set(x, y, z)
      avatar.current.rotation.y = Math.atan2(-s.fx, -s.fz)
    }

    // Camera behind the player, raised by the look pitch
    camDist.current += (camDistGoal.current - camDist.current) * (1 - Math.exp(-4 * delta)) // smooth zoom
    const D = camDist.current
    const cp = Math.cos(s.pitch)
    const sp = Math.sin(s.pitch)
    const target = camTarget.current.set(x, y + EYE_HEIGHT, z)
    const desired = new THREE.Vector3(
      x - s.fx * cp * D,
      y + EYE_HEIGHT - sp * D + 0.6 + D * 0.12,
      z - s.fz * cp * D,
    )
    desired.y = Math.max(0.3, desired.y) // never dip under the ground
    camPos.current.lerp(desired, 1 - Math.exp(-12 * delta))
    camera.position.copy(camPos.current)
    camera.up.set(0, 1, 0)
    camera.lookAt(target)

    // Presence: interior coordinates + facing, tagged with the world
    updatePosition({ x, y, z }, { x: s.vx, y: s.vy, z: s.vz }, activeWorldId, { x: s.fx, z: s.fz })

    // Kick (N): the object in front of you; 2 CRDT writes per kick
    const doc = useUniverseStore.getState().activeWorldDoc
    // Carrying: the object follows in front of you; everyone sees it move (≤ 10 writes/s)
    if (doc && held.current) {
      const h = held.current
      const o = objects.get(h.id)
      if (!o) {
        held.current = null
        setHeldId(null)
      } else {
        h.rotY += ((turnKeys.current.x ? 1 : 0) - (turnKeys.current.z ? 1 : 0)) * 1.8 * delta
        const big = Math.max(h.base.x, h.base.y, h.base.z)
        h.k = Math.min(30 / big, Math.max(0.3 / big, h.k * Math.exp(((turnKeys.current.r ? 1 : 0) - (turnKeys.current.f ? 1 : 0)) * 1.0 * delta)))
        h.dist = 0.5 * Math.max(h.base.x, h.base.z) * h.k + 1.2
        const now = performance.now()
        if (now - h.lastWrite > 100) {
          h.lastWrite = now
          const sc = scaleOf(h)
          moveObject(doc, h.id, carryPosition(s, h, { scaleY: sc.y }), h.rotY, sc)
        }
      }
    }
    if (doc) {
      if (inputManager.getEvents().justPressed.has('interact')) {
        const target = kickTarget(s, Array.from(objects.values()).filter((o) => !o.kick))
        if (target) kickObject(doc, target.id, kickVelocity(s.fx, s.fz))
      }
      const now = Date.now()
      for (const o of objects.values()) {
        if (o.kick && now - o.kick.t > KICK_SETTLE_SEC * 1000) {
          settleObject(doc, o.id, kickedPosition(o, useWorldStore.getState().physics, KICK_SETTLE_SEC))
        }
      }
    }
  })

  return (
    <>
      <group ref={avatar}>
        <CapsuleAvatar color={playerColor} />
        {playerId && <ChatBubble playerId={playerId} />}
      </group>
      {activeWorldId && <InteriorPlayers worldId={activeWorldId} />}
    </>
  )
}

/** Simple avatar: a glowing capsule with a nose that shows facing (-Z). */
function CapsuleAvatar({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.3, 1.1, 6, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 1.35, -0.3]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </>
  )
}

/** Other players inside the same world, smoothed toward their latest presence. */
function InteriorPlayers({ worldId }: { worldId: string }) {
  const { players } = usePresence()
  const refs = useRef(new Map<string, THREE.Group>())

  useFrame((_state, delta) => {
    const live = getPresenceState()
    const k = 1 - Math.exp(-15 * delta)
    for (const [id, g] of refs.current) {
      const p = live.get(id)
      const here = !!p && p.inWorld === worldId
      if (!here) {
        g.visible = false
        continue
      }
      if (!g.visible) g.position.set(p.position.x, p.position.y, p.position.z) // just arrived: snap
      g.visible = true
      g.position.x += (p.position.x - g.position.x) * k
      g.position.y += (p.position.y - g.position.y) * k
      g.position.z += (p.position.z - g.position.z) * k
      if (p.facing) g.rotation.y = Math.atan2(-p.facing.x, -p.facing.z)
    }
  })

  return (
    <>
      {Array.from(players.values()).map((p) => (
        <group
          key={p.id}
          visible={false}
          ref={(g) => {
            if (g) refs.current.set(p.id, g)
            else refs.current.delete(p.id)
          }}
        >
          <CapsuleAvatar color={p.color} />
          <ChatBubble playerId={p.id} />
        </group>
      ))}
    </>
  )
}

/**
 * Applies the display-quality tier to things the Canvas only reads at
 * creation (camera far plane), and runs the Auto frame-rate monitor.
 */
function QualityController() {
  const { camera } = useThree()
  const tier = useQualityTier()
  const isAuto = useQualityStore((s) => s.setting === 'auto')

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.far = tier.cameraFar
      camera.updateProjectionMatrix()
    }
  }, [camera, tier.cameraFar])

  if (!isAuto) return null
  return (
    <PerformanceMonitor
      onIncline={() => useQualityStore.getState().autoIncline()}
      onDecline={() => useQualityStore.getState().autoDecline()}
    />
  )
}

function SceneContent({ onPortalActivate }: { onPortalActivate: () => void }) {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const isInWorld = activeWorldId !== null
  const tier = useQualityTier()
  const atmosphere = useAtmosphere()

  // Get player color from presence (stored in sessionStorage)
  const { playerColor } = usePresence()

  return (
    <>
      <QualityController />

      {/* Flight system — drives player movement + camera */}
      <FlightSystem />

      {/* World escape handler */}
      <WorldEscapeHandler />

      {/* Interior movement + camera (only when in a world) */}
      {isInWorld && <InteriorSystem playerColor={playerColor} />}

      {/* Fog — different for universe vs world interior */}
      {/* Universe fog follows the quality tier (view distance) */}
      <fog attach="fog" args={[
        isInWorld ? (atmosphere?.sky.horizon ?? '#050510') : '#050510',
        isInWorld ? (atmosphere?.fogNear ?? 15) : tier.fogNear,
        isInWorld ? (atmosphere?.fogFar ?? 50) : tier.fogFar,
      ]} />

      {/* Universe view — star map (hidden when inside a world) */}
      {!isInWorld && <UniverseView onPortalActivate={onPortalActivate} playerColor={playerColor} />}

      {/* World interior — inside a world (shown when entered) */}
      {isInWorld && <WorldInterior />}

      {/* Post-processing (off on Low) */}
      {tier.bloom && (
        <EffectComposer multisampling={0}>
          <Bloom
            luminanceThreshold={0.35}
            luminanceSmoothing={0.9}
            intensity={isInWorld ? 0.8 : 1.2}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.15} darkness={isInWorld ? 0.6 : 0.8} />
        </EffectComposer>
      )}

      <Preload all />
    </>
  )
}

export function Scene({ onPortalActivate, onProgress }: SceneProps) {
  const [, setReady] = useState(false)
  const tier = useQualityTier()
  const dpr = Math.min(tier.dpr, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)

  const handleCreated = useCallback(() => {
    // Done as soon as the scene has really drawn (2026-10-22, Alex: "make it
    // faster"). This used to fill a fake bar on a random 200 ms timer (~1.6 s of
    // pure waiting). Two animation frames = the first frame was rendered and shown.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setReady(true)
        onProgress(100)
      }),
    )
  }, [onProgress])

  return (
    <div className="canvas-container">
      <Canvas
        camera={{ position: [0, 2, 60], fov: 60, near: 0.1, far: 500 }}
        dpr={dpr}
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

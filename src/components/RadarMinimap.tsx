import { memo, useRef, useEffect, useCallback } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { getPresenceState } from '../hooks/usePresence'
import { flightController } from '../systems/FlightController'
import * as THREE from 'three'

/**
 * 3D Radar — Canvas-based disc-and-stalk display.
 *
 * Inspired by Star Wars Squadrons / Wing Commander:
 * - A flat disc shows XZ positions (plan view)
 * - Vertical "stalks" extend up/down showing elevation (Y axis)
 * - The disc rotates with the player's heading (up = forward)
 * - Portal is always visible, pinned to edge when out of range
 *
 * Uses a raw <canvas> for 60fps rendering without React reconciliation.
 */

// ── Constants ────────────────────────────────────────────────────────

const CANVAS_SIZE = 160       // Canvas pixel size (rendered at 2x for retina)
const DPR = 2                 // Device pixel ratio for sharp rendering
const HALF = CANVAS_SIZE / 2  // Center point

/** How many scene units the radar covers (radius) */
const RADAR_RANGE = 80

/** Portal position (origin of the universe) */
const PORTAL_SCENE_POS = new THREE.Vector3(0, 0, 0)

/** Max stalk height in pixels */
const MAX_STALK_PX = 28

/** Usable radius on the disc (leaving room for border) */
const DISC_RADIUS = HALF - 14

// ── Colors ───────────────────────────────────────────────────────────

const COLOR_RING = 'rgba(100, 160, 220, 0.10)'
const COLOR_RING_OUTER = 'rgba(100, 160, 220, 0.18)'
const COLOR_CROSSHAIR = 'rgba(100, 160, 220, 0.06)'
const COLOR_PLAYER = 'rgba(180, 210, 255, 0.95)'
const COLOR_FORWARD = 'rgba(180, 210, 255, 0.4)'
const COLOR_BG_CENTER = 'rgba(10, 18, 35, 0.85)'
const COLOR_BG_EDGE = 'rgba(5, 10, 20, 0.95)'
const COLOR_PORTAL = '#ffcc44'
const COLOR_STALK_ABOVE = 'rgba(120, 200, 255, 0.55)'
const COLOR_STALK_BELOW = 'rgba(255, 140, 100, 0.50)'
const COLOR_OTHER_PLAYER = 'rgba(140, 240, 255, 0.90)'

// ── Helpers ──────────────────────────────────────────────────────────

/** Temp vector for position conversion (avoid alloc in hot loop) */
const _scenePos = new THREE.Vector3()

/** Temp quaternion/vector for transforms (avoid alloc in hot loop) */
const _invQuat = new THREE.Quaternion()
const _delta = new THREE.Vector3()

/**
 * Transform a world-space position into the player's local frame.
 * Returns { x, y, z } where:
 *   x = right, y = up, z = forward (negative = behind)
 */
function toLocalFrame(
  worldPos: THREE.Vector3,
  playerPos: THREE.Vector3,
  playerQuat: THREE.Quaternion,
): THREE.Vector3 {
  _delta.copy(worldPos).sub(playerPos)
  _invQuat.copy(playerQuat).invert()
  _delta.applyQuaternion(_invQuat)
  return _delta
}

// ── Blip data interface ──────────────────────────────────────────────

interface BlipInfo {
  localX: number
  localY: number
  localZ: number
  dist: number
  color: string
  size: number
  isPortal: boolean
}

// ── Component ────────────────────────────────────────────────────────

export const RadarMinimap = memo(function RadarMinimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const bgGradRef = useRef<CanvasGradient | null>(null)
  const worldsRef = useRef(useUniverseStore.getState().worlds)
  const rafRef = useRef<number | null>(null)

  // Subscribe to world changes without re-rendering
  useEffect(() => {
    const unsub = useUniverseStore.subscribe((s) => {
      worldsRef.current = s.worlds
    })
    return unsub
  }, [])

  // Initialize canvas context and cached gradient once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    // Cache the background gradient — never changes between frames
    const grad = ctx.createRadialGradient(HALF, HALF, 0, HALF, HALF, HALF)
    grad.addColorStop(0, COLOR_BG_CENTER)
    grad.addColorStop(1, COLOR_BG_EDGE)
    bgGradRef.current = grad
  }, [])

  const draw = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return

    const pos = flightController.position
    const quat = flightController.quaternion

    ctx.save()
    ctx.scale(DPR, DPR)

    // ── Clear ──
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // ── Outer glow (replaces CSS drop-shadow — drawn on-canvas for zero compositing cost) ──
    ctx.fillStyle = 'rgba(0, 10, 40, 0.3)'
    ctx.beginPath()
    ctx.arc(HALF, HALF, HALF, 0, Math.PI * 2)
    ctx.fill()

    // ── Background disc ──
    ctx.fillStyle = bgGradRef.current!
    ctx.beginPath()
    ctx.arc(HALF, HALF, HALF - 1, 0, Math.PI * 2)
    ctx.fill()

    // ── Outer border ──
    ctx.strokeStyle = COLOR_RING_OUTER
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(HALF, HALF, HALF - 2, 0, Math.PI * 2)
    ctx.stroke()

    // ── Range rings ──
    ctx.strokeStyle = COLOR_RING
    ctx.lineWidth = 0.5
    for (const frac of [0.33, 0.66]) {
      ctx.beginPath()
      ctx.arc(HALF, HALF, DISC_RADIUS * frac, 0, Math.PI * 2)
      ctx.stroke()
    }

    // ── Crosshairs ──
    ctx.strokeStyle = COLOR_CROSSHAIR
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(HALF - DISC_RADIUS, HALF)
    ctx.lineTo(HALF + DISC_RADIUS, HALF)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(HALF, HALF - DISC_RADIUS)
    ctx.lineTo(HALF, HALF + DISC_RADIUS)
    ctx.stroke()

    // ── Forward indicator (FOV wedge) ──
    ctx.fillStyle = COLOR_FORWARD
    ctx.beginPath()
    ctx.moveTo(HALF, HALF)
    const fovHalf = 0.35 // ~20° half-angle
    ctx.arc(HALF, HALF, DISC_RADIUS + 2, -Math.PI / 2 - fovHalf, -Math.PI / 2 + fovHalf)
    ctx.closePath()
    ctx.fill()
    // Forward tip triangle
    ctx.fillStyle = 'rgba(180, 210, 255, 0.6)'
    ctx.beginPath()
    ctx.moveTo(HALF, HALF - DISC_RADIUS - 6)
    ctx.lineTo(HALF - 4, HALF - DISC_RADIUS + 1)
    ctx.lineTo(HALF + 4, HALF - DISC_RADIUS + 1)
    ctx.closePath()
    ctx.fill()

    // ── Collect blip data ──
    const blips: BlipInfo[] = []
    const worlds = worldsRef.current

    // Portal
    const portalLocal = toLocalFrame(PORTAL_SCENE_POS, pos, quat)
    const portalDist = PORTAL_SCENE_POS.distanceTo(pos)
    blips.push({
      localX: portalLocal.x,
      localY: portalLocal.y,
      localZ: portalLocal.z,
      dist: portalDist,
      color: COLOR_PORTAL,
      size: 4,
      isPortal: true,
    })

    // Worlds
    for (const world of worlds.values()) {
      const scenePos = _scenePos.set(world.resolvedPosition.x, world.resolvedPosition.y, world.resolvedPosition.z)
      const dist = scenePos.distanceTo(pos)
      const local = toLocalFrame(scenePos, pos, quat)

      if (dist > RADAR_RANGE * 2) continue

      const hue = (world.id.charCodeAt(0) * 37 + world.id.charCodeAt(1) * 17) % 360
      const color = `hsl(${hue}, 65%, 60%)`
      const size = Math.max(2.5, Math.min(5, 2 + world.playerCount * 0.5))

      blips.push({
        localX: local.x,
        localY: local.y,
        localZ: local.z,
        dist,
        color,
        size,
        isPortal: false,
      })
    }

    // Other players
    const _playerScenePos = new THREE.Vector3()
    for (const [, player] of getPresenceState()) {
      if (player.inWorld) continue // Don't show players inside worlds
      // Presence positions are already in scene coordinates (from FlightController)
      _playerScenePos.set(player.position.x, player.position.y, player.position.z)
      const dist = _playerScenePos.distanceTo(pos)
      if (dist > RADAR_RANGE * 2) continue
      const local = toLocalFrame(_playerScenePos, pos, quat)
      blips.push({
        localX: local.x,
        localY: local.y,
        localZ: local.z,
        dist,
        color: player.color || COLOR_OTHER_PLAYER,
        size: 2.5,
        isPortal: false,
      })
    }

    // ── Draw blips ──
    for (const blip of blips) {
      // Project onto disc: local X → screen X, local Z → screen Y
      // THREE.js forward is -Z, so negate localZ so "in front" maps to disc top
      const discDist2D = Math.sqrt(blip.localX * blip.localX + blip.localZ * blip.localZ)
      const normalizedDist = Math.min(discDist2D / RADAR_RANGE, 1)

      // Angle on the disc (from forward direction)
      const discAngle = Math.atan2(blip.localX, -blip.localZ)

      // Pin to edge if out of range
      const effectiveRadius = blip.dist > RADAR_RANGE
        ? DISC_RADIUS - 2
        : normalizedDist * DISC_RADIUS

      // Disc position (shadow dot)
      const discX = HALF + Math.sin(discAngle) * effectiveRadius
      const discY = HALF - Math.cos(discAngle) * effectiveRadius

      // Stalk height: elevation mapped to pixels
      const elevationNorm = Math.max(-1, Math.min(1, blip.localY / (RADAR_RANGE * 0.5)))
      const stalkPx = elevationNorm * MAX_STALK_PX

      // Blip position (stalk tip)
      const blipX = discX
      const blipY = discY - stalkPx // up on screen = above player

      // Elevation tint: warm (above) vs cool (below) shift
      const elevTint = Math.abs(elevationNorm) > 0.1
        ? (elevationNorm > 0 ? COLOR_STALK_ABOVE : COLOR_STALK_BELOW)
        : null

      // ── Draw shadow dot on disc ──
      ctx.globalAlpha = 0.35
      ctx.fillStyle = blip.color
      ctx.beginPath()
      ctx.ellipse(discX, discY, blip.size * 0.6, blip.size * 0.35, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1.0

      // ── Draw stalk (solid line for clarity) ──
      if (Math.abs(stalkPx) > 1.5) {
        ctx.strokeStyle = stalkPx < 0 ? COLOR_STALK_BELOW : COLOR_STALK_ABOVE
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(discX, discY)
        ctx.lineTo(blipX, blipY)
        ctx.stroke()
      }

      // ── Draw blip marker at stalk tip ──
      ctx.fillStyle = blip.color
      ctx.beginPath()
      ctx.arc(blipX, blipY, blip.size, 0, Math.PI * 2)
      ctx.fill()

      // Elevation ring tint (subtle ring around blip when above/below)
      if (elevTint) {
        ctx.strokeStyle = elevTint
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        ctx.arc(blipX, blipY, blip.size + 1.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1.0
      }

      // Glow for portal
      if (blip.isPortal) {
        ctx.globalAlpha = 0.3
        ctx.fillStyle = blip.color
        ctx.beginPath()
        ctx.arc(blipX, blipY, blip.size + 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1.0
      }

      // ── Direction indicator (▲/▼) — larger triangles ──
      if (Math.abs(stalkPx) > 3) {
        ctx.fillStyle = stalkPx > 0 ? COLOR_STALK_ABOVE : COLOR_STALK_BELOW
        ctx.globalAlpha = 0.85
        const triSize = 4
        ctx.beginPath()
        if (stalkPx > 0) {
          // Above player: ▲
          ctx.moveTo(blipX, blipY - blip.size - 2)
          ctx.lineTo(blipX - triSize, blipY - blip.size - 2 + triSize + 1)
          ctx.lineTo(blipX + triSize, blipY - blip.size - 2 + triSize + 1)
        } else {
          // Below player: ▼
          ctx.moveTo(blipX, blipY + blip.size + 2)
          ctx.lineTo(blipX - triSize, blipY + blip.size + 2 - triSize - 1)
          ctx.lineTo(blipX + triSize, blipY + blip.size + 2 - triSize - 1)
        }
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1.0
      }
    }

    // ── Player dot (drawn last, on top) ──
    ctx.fillStyle = COLOR_PLAYER
    ctx.beginPath()
    ctx.arc(HALF, HALF, 2.5, 0, Math.PI * 2)
    ctx.fill()

    // Player glow
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.arc(HALF, HALF, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1.0

    ctx.restore()

    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Start/stop render loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [draw])

  return (
    <div className="radar-container" title="3D Radar">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE * DPR}
        height={CANVAS_SIZE * DPR}
        className="radar-canvas"
      />
    </div>
  )
})

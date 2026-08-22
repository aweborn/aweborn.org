import { useRef, useEffect, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { flightController } from '../systems/FlightController'

/**
 * Radar Minimap — circular scanner-style HUD overlay.
 *
 * Shows the player at center with world blips around them.
 * The Aweborn Portal is always visible (pinned to edge when off-map).
 * Map rotates with player orientation so "up" is always "forward".
 */

// ── Constants ────────────────────────────────────────────────────────

/** Radar radius in pixels */
const RADAR_SIZE = 120
const RADAR_HALF = RADAR_SIZE / 2

/** How many scene units the radar covers (radius) */
const RADAR_RANGE = 20

/** Scene scaling constants (must match UniverseWorlds.tsx) */
const SCENE_RADIUS = 14
const CRDT_SCALE = 500

/** Portal position in scene coordinates */
const PORTAL_POS = { x: 0, y: 1, z: -8 }

function worldToScene(pos: { x: number; y: number; z: number }) {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return {
    x: pos.x * scale,
    y: pos.y * scale + 1,
    z: pos.z * scale - 8,
  }
}

interface BlipData {
  id: string
  name: string
  x: number // px offset from center
  y: number // px offset from center
  size: number
  color: string
  isPortal?: boolean
  isOffMap?: boolean
  edgeAngle?: number // radians, only for off-map blips
}

export function RadarMinimap() {
  const worlds = useUniverseStore((s) => s.worlds)
  const [blips, setBlips] = useState<BlipData[]>([])
  const [sweepAngle, setSweepAngle] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    function tick() {
      const pos = flightController.position
      const quat = flightController.quaternion

      // Extract yaw from quaternion (rotation around Y axis)
      const fx = 2 * (quat.x * quat.z + quat.w * quat.y)
      const fz = 1 - 2 * (quat.x * quat.x + quat.y * quat.y)
      const yaw = Math.atan2(fx, fz)

      // Update sweep animation
      setSweepAngle((prev) => (prev + 0.02) % (Math.PI * 2))

      const newBlips: BlipData[] = []

      // ── Portal blip ──
      const pdx = PORTAL_POS.x - pos.x
      const pdz = PORTAL_POS.z - pos.z
      const portalDist = Math.sqrt(pdx * pdx + pdz * pdz)
      const portalAngle = Math.atan2(pdx, pdz) - yaw

      // Rotate relative to player's heading
      const portalMapX = Math.sin(portalAngle) * Math.min(portalDist / RADAR_RANGE, 1) * (RADAR_HALF - 8)
      const portalMapY = -Math.cos(portalAngle) * Math.min(portalDist / RADAR_RANGE, 1) * (RADAR_HALF - 8)

      const portalIsOff = portalDist > RADAR_RANGE
      newBlips.push({
        id: 'portal',
        name: 'Aweborn Portal',
        x: portalIsOff
          ? Math.sin(portalAngle) * (RADAR_HALF - 6)
          : portalMapX,
        y: portalIsOff
          ? -Math.cos(portalAngle) * (RADAR_HALF - 6)
          : portalMapY,
        size: 6,
        color: '#ffcc44',
        isPortal: true,
        isOffMap: portalIsOff,
        edgeAngle: portalAngle,
      })

      // ── World blips ──
      for (const world of worlds.values()) {
        const scenePos = worldToScene(world.resolvedPosition)
        const dx = scenePos.x - pos.x
        const dz = scenePos.z - pos.z
        const dist = Math.sqrt(dx * dx + dz * dz)

        if (dist > RADAR_RANGE * 1.5) continue // Skip very distant worlds

        const angle = Math.atan2(dx, dz) - yaw
        const normalizedDist = Math.min(dist / RADAR_RANGE, 1)

        const mapX = Math.sin(angle) * normalizedDist * (RADAR_HALF - 8)
        const mapY = -Math.cos(angle) * normalizedDist * (RADAR_HALF - 8)

        // Size based on player count (more active = bigger blip)
        const blipSize = Math.max(3, Math.min(6, 2 + world.playerCount * 0.5))

        // Color based on world hue (hash the id for consistent color)
        const hue = (world.id.charCodeAt(0) * 37 + world.id.charCodeAt(1) * 17) % 360
        const color = `hsl(${hue}, 60%, 60%)`

        newBlips.push({
          id: world.id,
          name: world.name,
          x: dist > RADAR_RANGE ? Math.sin(angle) * (RADAR_HALF - 6) : mapX,
          y: dist > RADAR_RANGE ? -Math.cos(angle) * (RADAR_HALF - 6) : mapY,
          size: blipSize,
          color,
          isOffMap: dist > RADAR_RANGE,
        })
      }

      setBlips(newBlips)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [worlds])

  return (
    <div className="radar-container" title="Radar">
      {/* Range rings */}
      <div className="radar-ring radar-ring--outer" />
      <div className="radar-ring radar-ring--mid" />
      <div className="radar-ring radar-ring--inner" />

      {/* Cross hairs */}
      <div className="radar-crosshair radar-crosshair--h" />
      <div className="radar-crosshair radar-crosshair--v" />

      {/* Sweep line */}
      <div
        className="radar-sweep"
        style={{ transform: `rotate(${sweepAngle}rad)` }}
      />

      {/* Player dot (center) */}
      <div className="radar-player" />

      {/* Forward indicator */}
      <div className="radar-forward-tick" />

      {/* Blips */}
      {blips.map((blip) => (
        <div
          key={blip.id}
          className={`radar-blip${blip.isPortal ? ' radar-blip--portal' : ''}${blip.isOffMap ? ' radar-blip--offmap' : ''}`}
          style={{
            left: `${RADAR_HALF + blip.x}px`,
            top: `${RADAR_HALF + blip.y}px`,
            width: `${blip.size}px`,
            height: `${blip.size}px`,
            backgroundColor: blip.color,
          }}
          title={blip.name}
        >
          {/* Off-map arrow indicator for portal */}
          {blip.isOffMap && blip.isPortal && (
            <div
              className="radar-blip-arrow"
              style={{
                transform: `rotate(${(blip.edgeAngle ?? 0) + Math.PI}rad)`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

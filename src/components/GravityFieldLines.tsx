import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useUniverseStore } from '../stores/universeStore'
import { flightController } from '../systems/FlightController'
import type { WorldEntry } from '@aweborn/shared/crdt-schema'

/**
 * Gravity field lines — faint curved lines bending toward nearby worlds.
 *
 * Procedural CatmullRom splines that curve from ambient positions
 * toward each world's center, visualizing the gravity field.
 * Very subtle — atmospheric, not distracting.
 */

const LINES_PER_WORLD = 6
const POINTS_PER_LINE = 12
const GRAVITY_VISUAL_RANGE = 12
const SCENE_RADIUS = 14
const CRDT_SCALE = 500

function worldToScene(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  const scale = SCENE_RADIUS / CRDT_SCALE
  return new THREE.Vector3(
    pos.x * scale,
    pos.y * scale + 1,
    pos.z * scale - 8,
  )
}

/** Generate field line control points for a world. */
function generateFieldLinePoints(
  worldPos: THREE.Vector3,
  lineIndex: number,
  time: number,
): THREE.Vector3[] {
  const angle = (lineIndex / LINES_PER_WORLD) * Math.PI * 2 + time * 0.1
  const points: THREE.Vector3[] = []

  for (let i = 0; i < POINTS_PER_LINE; i++) {
    const t = i / (POINTS_PER_LINE - 1) // 0 → 1 (far → world center)
    const dist = (1 - t) * 4 + 0.5
    const spiralAngle = angle + t * 0.8
    const wobble = Math.sin(time * 0.5 + lineIndex * 1.5 + i * 0.3) * 0.2

    points.push(new THREE.Vector3(
      worldPos.x + Math.cos(spiralAngle) * dist + wobble,
      worldPos.y + Math.sin(time * 0.3 + i * 0.2) * 0.3 * (1 - t),
      worldPos.z + Math.sin(spiralAngle) * dist + wobble,
    ))
  }

  return points
}

export function GravityFieldLines() {
  const worlds = useUniverseStore((s) => s.worlds)
  const groupRef = useRef<THREE.Group>(null!)

  // Pre-allocate line geometries (max 8 worlds × 6 lines)
  const MAX_LINES = 48
  const lineRefs = useRef<(THREE.Line | null)[]>(new Array(MAX_LINES).fill(null))

  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: new THREE.Color(0.3, 0.35, 0.6),
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), [])

  useEffect(() => () => { lineMaterial.dispose() }, [lineMaterial])

  useFrame((state) => {
    if (!groupRef.current) return

    const playerPos = flightController.position
    const time = state.clock.elapsedTime
    let lineIdx = 0

    // Clear all lines first
    for (let i = 0; i < MAX_LINES; i++) {
      const line = lineRefs.current[i]
      if (line) line.visible = false
    }

    for (const world of worlds.values()) {
      const worldPos = worldToScene(world.resolvedPosition)
      const dist = worldPos.distanceTo(playerPos)

      // Skip if too far
      if (dist > GRAVITY_VISUAL_RANGE) continue

      // Opacity based on proximity (closer = more visible)
      const proximity = 1 - dist / GRAVITY_VISUAL_RANGE
      const lineOpacity = proximity * proximity * 0.12

      for (let l = 0; l < LINES_PER_WORLD; l++) {
        if (lineIdx >= MAX_LINES) break

        const controlPoints = generateFieldLinePoints(worldPos, l, time)
        const curve = new THREE.CatmullRomCurve3(controlPoints)
        const curvePoints = curve.getPoints(20)

        let line = lineRefs.current[lineIdx]
        if (!line) {
          const geo = new THREE.BufferGeometry()
          line = new THREE.Line(geo, lineMaterial.clone())
          groupRef.current.add(line)
          lineRefs.current[lineIdx] = line
        }

        line.geometry.setFromPoints(curvePoints)
        line.visible = true
        ;(line.material as THREE.LineBasicMaterial).opacity = lineOpacity

        lineIdx++
      }
    }
  })

  return <group ref={groupRef} />
}

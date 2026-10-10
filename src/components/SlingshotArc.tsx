import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { flightController } from '../systems/FlightController'
import { _slingshotActive, _slingshotWorldPos } from './Scene'

/**
 * Slingshot Arc — a glowing tangential trajectory line during slingshot passes.
 *
 * Reads shared module-level state (`_slingshotActive`, `_slingshotWorldPos`)
 * directly in useFrame because those values change every physics tick
 * and can't be passed as React props (parent doesn't re-render per frame).
 *
 * Fades in as the slingshot engages, fades out over ~0.5s after exit.
 */

const ARC_POINTS = 32
const ARC_FADE_IN_SPEED = 8.0  // How fast the arc appears
const ARC_FADE_OUT_SPEED = 2.5 // How fast it disappears (slower = lingers)

export function SlingshotArc() {
  const lineRef = useRef<THREE.Line>(null!)
  const opacity = useRef(0)
  // Cache the last known world position so the arc can fade out smoothly
  const lastWorldPos = useRef<THREE.Vector3 | null>(null)

  const material = useMemo(() => new THREE.LineBasicMaterial({
    color: new THREE.Color(0.4, 0.85, 1.0),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    linewidth: 1,
  }), [])

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(ARC_POINTS * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geo
  }, [])

  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])

  useFrame((_state, delta) => {
    const dt = Math.min(delta, 0.05)

    // Read shared state directly (updated by FlightSystem every frame)
    const active = _slingshotActive
    const worldPosition = _slingshotWorldPos

    // Cache world position for fade-out
    if (worldPosition) {
      if (!lastWorldPos.current) lastWorldPos.current = worldPosition.clone()
      else lastWorldPos.current.copy(worldPosition)
    }

    // Use cached position during fade-out
    const effectiveWorldPos = active ? worldPosition : lastWorldPos.current

    // Fade opacity in/out
    const targetOpacity = active && effectiveWorldPos ? 1.0 : 0.0
    if (targetOpacity > opacity.current) {
      opacity.current = Math.min(opacity.current + ARC_FADE_IN_SPEED * dt, 1.0)
    } else {
      opacity.current = Math.max(opacity.current - ARC_FADE_OUT_SPEED * dt, 0.0)
    }
    material.opacity = opacity.current * 0.5

    // Don't update geometry if invisible
    if (opacity.current < 0.01) {
      if (lineRef.current) lineRef.current.visible = false
      return
    }

    if (lineRef.current) lineRef.current.visible = true
    if (!effectiveWorldPos) return

    // Build the arc: player → curve around world → exit trajectory
    const playerPos = flightController.position
    const playerVel = flightController.velocity
    const speed = playerVel.length()

    if (speed < 1.0) {
      if (lineRef.current) lineRef.current.visible = false
      return
    }

    const velDir = playerVel.clone().normalize()
    const toWorld = effectiveWorldPos.clone().sub(playerPos)
    const toWorldDir = toWorld.clone().normalize()

    // Tangent direction (perpendicular to the line-to-world, in the velocity plane)
    const tangent = new THREE.Vector3().crossVectors(toWorldDir, new THREE.Vector3(0, 1, 0)).normalize()
    // Pick the tangent direction that aligns with velocity
    if (tangent.dot(velDir) < 0) tangent.negate()

    // Build control points for the arc
    const worldDist = toWorld.length()
    const arcRadius = Math.max(worldDist * 0.6, 1.5)
    const controlPoints: THREE.Vector3[] = []

    // Entry: behind the player along velocity
    controlPoints.push(playerPos.clone().addScaledVector(velDir, -speed * 0.15))

    // Player position
    controlPoints.push(playerPos.clone())

    // Mid-arc: curving around the world
    const midPoint = effectiveWorldPos.clone()
      .addScaledVector(tangent, arcRadius)
      .addScaledVector(toWorldDir, -arcRadius * 0.3)
    controlPoints.push(midPoint)

    // Exit: ahead along the predicted slingshot trajectory
    const exitDir = tangent.clone().lerp(velDir, 0.3).normalize()
    const exitPoint = midPoint.clone().addScaledVector(exitDir, speed * 0.3)
    controlPoints.push(exitPoint)

    // Far exit
    controlPoints.push(exitPoint.clone().addScaledVector(exitDir, speed * 0.2))

    // Generate smooth curve
    const curve = new THREE.CatmullRomCurve3(controlPoints)
    const points = curve.getPoints(ARC_POINTS - 1)

    // Update geometry
    const positions = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < ARC_POINTS; i++) {
      const p = points[i] || points[points.length - 1]
      positions.setXYZ(i, p.x, p.y, p.z)
    }
    positions.needsUpdate = true
  })

  return <line ref={lineRef} geometry={geometry} material={material} frustumCulled={false} />
}

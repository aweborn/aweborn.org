/**
 * Headless gravity sanity check for NEUTRAL (gravity-on) flight.
 *
 * Mirrors the physics loop in Scene.tsx + FlightController._updateNeutralMovement
 * (thrust, gravity, approach drag, space drag, speed cap, slingshot impulse) and
 * asserts two game-feel invariants:
 *
 *   1. ESCAPE: from rest at any distance from any body (including the Portal),
 *      holding thrust straight outward always gets the player clear.
 *   2. FLYBY: a fast tangential pass past a world bends the path and leaves the
 *      well (slingshot), instead of being captured.
 *
 * Run: node scripts/sim/gravity-escape.ts
 */
import * as THREE from 'three'
import { gravitySystem } from '../../src/systems/GravitySystem.ts'

// Keep in sync with FlightController.ts / Scene.tsx
const NEUTRAL_THRUST_ACCEL = 10.0
const NEUTRAL_DRAG = 0.15
const NEUTRAL_MAX_SPEED = 80.0
const SLINGSHOT_IMPULSE_MULTIPLIER = 0.1
const DT = 1 / 60

type World = Parameters<typeof gravitySystem.calculate>[2] extends Map<string, infer W> ? W : never

function makeWorld(id: string, x: number, y: number, z: number, playerCount = 0): World {
  return {
    id,
    resolvedPosition: { x, y, z },
    playerCount,
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7, // old → max age bonus
    solidified: true,
  } as unknown as World
}

function step(pos: THREE.Vector3, vel: THREE.Vector3, worlds: Map<string, World>, thrustDir: THREE.Vector3 | null, slung: { id: string | null }) {
  const g = gravitySystem.calculate(pos, vel, worlds)

  // Approach drag (Scene.tsx)
  if (g.approachDragFactor > 0.01 && g.nearestWorldPosition) {
    const toWorld = g.nearestWorldPosition.clone().sub(pos).normalize()
    const approachSpeed = vel.dot(toWorld)
    if (approachSpeed > 0) vel.addScaledVector(toWorld, -approachSpeed * g.approachDragFactor * DT * 2.0)
  }

  // Slingshot impulse (Scene.tsx), once per pass
  if (g.slingshotEvent) {
    if (slung.id !== g.slingshotEvent.worldId) {
      slung.id = g.slingshotEvent.worldId
      const { speed, boostFactor } = g.slingshotEvent
      vel.addScaledVector(vel.clone().normalize(), speed * (boostFactor - 1) * SLINGSHOT_IMPULSE_MULTIPLIER)
    }
  } else {
    slung.id = null
  }

  // FlightController neutral movement
  if (thrustDir) vel.addScaledVector(thrustDir, NEUTRAL_THRUST_ACCEL * DT)
  vel.addScaledVector(g.force, DT)
  vel.multiplyScalar(Math.pow(1 - NEUTRAL_DRAG, DT))
  if (vel.length() > NEUTRAL_MAX_SPEED) vel.setLength(NEUTRAL_MAX_SPEED)
  pos.addScaledVector(vel, DT)
}

let failures = 0
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
  if (!ok) failures++
}

// ── 1. Escape from rest, thrusting outward ──
const bodies: Array<{ label: string; center: THREE.Vector3; worlds: Map<string, World> }> = [
  { label: 'portal', center: new THREE.Vector3(0, 0, 0), worlds: new Map() },
  { label: 'world', center: new THREE.Vector3(500, 0, 0), worlds: new Map([['w', makeWorld('w', 500, 0, 0)]]) },
  { label: 'busy world (6 players)', center: new THREE.Vector3(500, 0, 0), worlds: new Map([['w', makeWorld('w', 500, 0, 0, 6)]]) },
]
for (const b of bodies) {
  for (const startDist of [1, 2.5, 5, 10, 20]) {
    const dir = new THREE.Vector3(0.6, 0.3, 0.74).normalize()
    const pos = b.center.clone().addScaledVector(dir, startDist)
    const vel = new THREE.Vector3()
    const slung = { id: null as string | null }
    let t = 0
    let escaped = false
    while (t < 30) {
      step(pos, vel, b.worlds, dir, slung)
      t += DT
      if (pos.distanceTo(b.center) > 60) { escaped = true; break }
    }
    check(`escape ${b.label} from r=${startDist}`, escaped, `t=${t.toFixed(1)}s r=${pos.distanceTo(b.center).toFixed(1)}`)
  }
}

// ── 2. Fast tangential flyby (no thrust) ──
for (const speed of [20, 35, 60]) {
  const center = new THREE.Vector3(500, 0, 0)
  const worlds = new Map([['w', makeWorld('w', 500, 0, 0)]])
  const pos = new THREE.Vector3(500 - 40, 0, 4) // passes ~4 units from the world
  const vel = new THREE.Vector3(speed, 0, 0)
  const startDir = vel.clone().normalize()
  const slung = { id: null as string | null }
  let minDist = Infinity
  let t = 0
  while (t < 20) {
    step(pos, vel, worlds, null, slung)
    t += DT
    minDist = Math.min(minDist, pos.distanceTo(center))
    if (t > 1 && pos.distanceTo(center) > 60) break
  }
  const escaped = pos.distanceTo(center) > 60
  const deflection = THREE.MathUtils.radToDeg(startDir.angleTo(vel.clone().normalize()))
  check(`flyby at ${speed} u/s`, escaped, `minDist=${minDist.toFixed(1)} deflection=${deflection.toFixed(0)}° exitSpeed=${vel.length().toFixed(1)}`)
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)

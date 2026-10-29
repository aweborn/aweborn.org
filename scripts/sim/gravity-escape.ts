/**
 * Headless gravity sanity check for NEUTRAL (gravity-on) flight.
 *
 * Since Phase 09 9A this drives the real shared step (`shared/sim/flight.ts`,
 * the code the client runs and the server will replay), instead of a copy of
 * the Scene.tsx + FlightController math. Asserts two game-feel invariants:
 *
 *   1. ESCAPE: from rest at any distance from any body (including the Portal),
 *      holding thrust straight outward always gets the player clear.
 *   2. FLYBY: a fast tangential pass past a world bends the path and leaves the
 *      well (slingshot), instead of being captured.
 *
 * Run: node --import ./server/sync-service/node_modules/tsx/dist/esm/index.mjs scripts/sim/gravity-escape.ts
 */
import * as THREE from 'three'
import { stepFlight, initialFlightState, IN, FLIGHT_DT, type FlightSimState } from '../../shared/sim/flight.ts'
import { buildBodies, type BodySource, type SimWorld } from '../../shared/sim/gravity.ts'

const NOW = Date.now()

function makeWorld(id: string, x: number, y: number, z: number, playerCount = 0): BodySource {
  return {
    id,
    resolvedPosition: { x, y, z },
    playerCount,
    createdAt: NOW - 1000 * 60 * 60 * 24 * 7, // old → max age bonus
  }
}

function simWorld(worlds: BodySource[]): SimWorld {
  return { bodies: buildBodies(worlds, NOW), leashRadius: null }
}

/** A state at `pos` facing `dir` (forward is -Z at identity), moving at `vel`. */
function stateAt(pos: THREE.Vector3, dir: THREE.Vector3, vel = new THREE.Vector3()): FlightSimState {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize())
  return { ...initialFlightState(pos.x, pos.y, pos.z), vx: vel.x, vy: vel.y, vz: vel.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }
}

const dist = (s: FlightSimState, c: THREE.Vector3) => Math.hypot(s.px - c.x, s.py - c.y, s.pz - c.z)

let failures = 0
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`)
  if (!ok) failures++
}

// ── 1. Escape from rest, thrusting outward ──
const bodies: Array<{ label: string; center: THREE.Vector3; world: SimWorld }> = [
  { label: 'portal', center: new THREE.Vector3(0, 0, 0), world: simWorld([]) },
  { label: 'world', center: new THREE.Vector3(500, 0, 0), world: simWorld([makeWorld('w', 500, 0, 0)]) },
  { label: 'busy world (6 players)', center: new THREE.Vector3(500, 0, 0), world: simWorld([makeWorld('w', 500, 0, 0, 6)]) },
]
for (const b of bodies) {
  for (const startDist of [1, 2.5, 5, 10, 20]) {
    const dir = new THREE.Vector3(0.6, 0.3, 0.74).normalize()
    const s = stateAt(b.center.clone().addScaledVector(dir, startDist), dir)
    let t = 0
    let escaped = false
    while (t < 30) {
      stepFlight(s, { bits: IN.neutral | IN.thrust, yaw: 0, pitch: 0 }, b.world)
      t += FLIGHT_DT
      if (dist(s, b.center) > 60) { escaped = true; break }
    }
    check(`escape ${b.label} from r=${startDist}`, escaped, `t=${t.toFixed(1)}s r=${dist(s, b.center).toFixed(1)}`)
  }
}

// ── 2. Fast tangential flyby (no thrust) ──
for (const speed of [20, 35, 60]) {
  const center = new THREE.Vector3(500, 0, 0)
  const world = simWorld([makeWorld('w', 500, 0, 0)])
  const startDir = new THREE.Vector3(1, 0, 0)
  const s = stateAt(new THREE.Vector3(500 - 40, 0, 4), startDir, startDir.clone().multiplyScalar(speed)) // passes ~4 units from the world
  let minDist = Infinity
  let t = 0
  while (t < 20) {
    stepFlight(s, { bits: IN.neutral, yaw: 0, pitch: 0 }, world)
    t += FLIGHT_DT
    minDist = Math.min(minDist, dist(s, center))
    if (t > 1 && dist(s, center) > 60) break
  }
  const escaped = dist(s, center) > 60
  const vel = new THREE.Vector3(s.vx, s.vy, s.vz)
  const deflection = THREE.MathUtils.radToDeg(startDir.angleTo(vel.clone().normalize()))
  check(`flyby at ${speed} u/s`, escaped, `minDist=${minDist.toFixed(1)} deflection=${deflection.toFixed(0)}° exitSpeed=${vel.length().toFixed(1)}`)
}

console.log(failures ? `\n${failures} failure(s)` : '\nall passed')
process.exit(failures ? 1 : 0)

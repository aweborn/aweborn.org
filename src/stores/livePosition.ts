import type { PlacedObject } from '@aweborn/shared/crdt-schema'
import { cleanLife, roamPose, walkSpeed } from '@aweborn/shared/life'
import { collidersFor, kickTrajectory, type Box, type KickTrajectory, type KickWorld } from '@aweborn/shared/sim/interior'
import { serverNow } from '../lib/serverClock'
import { useWorldStore } from './worldStore'
import { halfExtentOf, placeOnTerrain, terrainCellAt, useTerrainEditsRev } from './worldVoxels'

/**
 * Where a placed thing really is (2026-11-06 playtest: "the model wasn't where I
 * thought it was", it jittered while grabbed, and kicks fell through the floor).
 *
 * A roaming creature's x/z is its *home*; it is drawn at home + its deterministic
 * roam (shared/life.ts roamPose). Kick and grab used to aim at the home spot, so
 * the thing you saw was not the thing you could touch. Everything that aims at,
 * draws or moves a placed thing goes through here instead.
 */

/** A carry mark older than this (the carrier's tab closed mid-carry) is ignored. */
export const CARRY_FRESH_MS = 2500

/** Is someone carrying it right now? */
export function isCarried(o: PlacedObject, now = serverNow()): boolean {
  return !!o.carry && now - o.carry.t < CARRY_FRESH_MS
}

/** Does it walk around its home (drawn by LivingModel with a roam)? */
export function roams(o: PlacedObject): boolean {
  if (o.type !== 'model' || !o.asset) return false
  const life = cleanLife(o.life)
  return !!life && life.roam > 0 && (life.mode !== 'still' || !!o.mind)
}

/** Its roam offset from home now (zero when it doesn't roam, is flying or is held). */
export function roamOffset(o: PlacedObject, now = serverNow()): { dx: number; dz: number; heading: number; moving: boolean } {
  const life = cleanLife(o.life)
  if (!life || !roams(o) || o.kick || isCarried(o, now)) return { dx: 0, dz: 0, heading: o.rotY || 0, moving: false }
  return roamPose(o.id, life.roam, walkSpeed(Math.abs(o.scaleY || 1), life.pace), now, o.rotY || 0)
}

/** Ground height (top of the terrain) under a world x/z, or null without voxel ground. */
export function groundAt(x: number, z: number): number | null {
  const t = useWorldStore.getState().voxelTerrain
  if (!t) return null
  return placeOnTerrain(t, [x + t.size[0] / 2, 0, z + t.size[2] / 2]).y
}

/**
 * Where it is now. `ground`: also work out its height on the terrain (a roamer walks on
 * the ground under it, not at its home's height); aiming only needs x/z, so skip it there.
 */
export function livePosition(o: PlacedObject, ground = false, now = serverNow()): { x: number; y: number; z: number } {
  const r = roamOffset(o, now)
  if (r.dx === 0 && r.dz === 0) return { x: o.x, y: o.y, z: o.z }
  const x = o.x + r.dx
  const z = o.z + r.dz
  const g = ground ? groundAt(x, z) : null
  return { x, y: g === null ? o.y : g + Math.abs(o.scaleY || 1) / 2, z }
}

/** For kickTarget: where to aim (x/z of the live position). */
export const aimAt = (o: PlacedObject) => livePosition(o)

// ── The object in your own hands ─────────────────────────────────────

/**
 * What the local player is carrying, updated every frame by the interior system. The
 * carried thing is drawn from here, so it moves with your hands at the screen's frame
 * rate instead of in 10 Hz steps of its CRDT writes.
 */
export const localCarry = { id: null as string | null, x: 0, y: 0, z: 0, rotY: 0, sx: 1, sy: 1, sz: 1 }

// ── Kicks: the world a kicked thing collides with ────────────────────

/**
 * What a kicked object can hit: this world's terrain (every cell, edits included, the
 * same on every client) and the other placed things as plain boxes. Not model-shaped
 * colliders: those exist only once a model has loaded, which differs between players.
 */
export function kickWorldFor(selfId: string, objects: Iterable<PlacedObject> = useWorldStore.getState().objects.values()): KickWorld {
  const now = serverNow()
  const boxes: Box[] = []
  for (const o of objects) {
    if (o.id === selfId || o.kick || roams(o) || isCarried(o, now)) continue
    boxes.push(...collidersFor([o]))
  }
  const t = useWorldStore.getState().voxelTerrain
  if (!t) return { boxes }
  const [sx, sy, sz] = t.size
  return {
    boxes,
    halfExtent: halfExtentOf(t),
    solid: (x, y, z) => {
      const j = Math.floor(y)
      if (j < 0) return true
      const gi = Math.floor(x + sx / 2)
      const gk = Math.floor(z + sz / 2)
      if (gi < 0 || gk < 0 || gi >= sx || gk >= sz || j >= sy) return false
      return terrainCellAt(t, gi, j, gk) !== 0
    },
  }
}

const paths = new Map<string, KickTrajectory>()
const terrainIds = new WeakMap<object, number>()
let terrainSerial = 0

/** The whole flight of a kicked object, computed once per kick (and per terrain edit). */
export function kickPath(o: PlacedObject): KickTrajectory {
  const k = o.kick
  const t = useWorldStore.getState().voxelTerrain
  let tid = 0
  if (t) {
    tid = terrainIds.get(t) ?? 0
    if (!tid) terrainIds.set(t, (tid = ++terrainSerial))
  }
  const p = useWorldStore.getState().physics
  const key = [
    o.id, k?.t, k?.vx, k?.vy, k?.vz, o.x, o.y, o.z, o.scaleX, o.scaleY, o.scaleZ, tid, useTerrainEditsRev.getState().rev,
    p.gravityX, p.gravityY, p.gravityZ, p.friction, p.airResistance, p.bounceCoefficient,
  ].join('|')
  let tr = paths.get(key)
  if (!tr) {
    tr = kickTrajectory(o, p, kickWorldFor(o.id))
    paths.set(key, tr)
    if (paths.size > 64) paths.delete(paths.keys().next().value!)
  }
  return tr
}

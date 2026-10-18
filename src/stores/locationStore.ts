import * as THREE from 'three'
import { playerReady, getPlayerSnapshot, subscribePlayer, type Player } from '../lib/player'
import { useUniverseStore } from './universeStore'
import { useWorldStore } from './worldStore'
import { flightController } from '../systems/FlightController'
import { interiorController } from '../systems/InteriorController'
import { teleportSystem } from '../systems/TeleportSystem'

/**
 * Where you left off: on reload, a player returns to the same spot, flying in
 * the universe or standing inside a world.
 *
 * Saved in this browser, per character (accounts: localStorage, so a returning
 * player gets it back; guests: sessionStorage, since a guest is per tab). It is
 * written about once a second, and when the tab is hidden or closed.
 */
interface SavedLocation {
  v: 1
  at: number
  flight: { p: [number, number, number]; q: [number, number, number, number] }
  /** Set when the player was inside a world. */
  world?: { id: string; x: number; y: number; z: number; fx: number; fz: number; pitch: number }
}

const SAVE_MS = 1000
const WORLD_WAIT_MS = 15_000
const MAX_AGE_MS = 30 * 24 * 3600 * 1000

let owner: string | null = null
let player: Player | null = null
let restoring = true // never overwrite a saved spot before it has been read
let started = false
let booted = false

const ownerKey = (p: Player) => (p.isGuest ? p.playerId : (p.characters[0] ?? p.playerId))
const key = () => `aweborn-location:${owner}`
const storage = (): Storage | null => {
  try {
    return player?.isGuest ? sessionStorage : localStorage
  } catch {
    return null
  }
}

function read(): SavedLocation | null {
  try {
    const raw = storage()?.getItem(key())
    const v = raw ? (JSON.parse(raw) as SavedLocation) : null
    if (!v || v.v !== 1 || Date.now() - v.at > MAX_AGE_MS) return null
    const finite = (xs: number[]) => xs.every((n) => Number.isFinite(n))
    if (!finite(v.flight.p) || !finite(v.flight.q)) return null
    if (v.world && !finite([v.world.x, v.world.y, v.world.z, v.world.fx, v.world.fz, v.world.pitch])) delete v.world
    return v
  } catch {
    return null
  }
}

function snapshot(): SavedLocation {
  const fp = flightController.position
  const fq = flightController.quaternion
  const loc: SavedLocation = { v: 1, at: Date.now(), flight: { p: [fp.x, fp.y, fp.z], q: [fq.x, fq.y, fq.z, fq.w] } }
  const id = useUniverseStore.getState().activeWorldId
  if (id && useWorldStore.getState().loaded) {
    const s = interiorController.state
    loc.world = { id, x: s.x, y: s.y, z: s.z, fx: s.fx, fz: s.fz, pitch: s.pitch }
  }
  return loc
}

function save(): void {
  if (restoring || !owner) return
  try {
    storage()?.setItem(key(), JSON.stringify(snapshot()))
  } catch {
    /* full or private mode: the spot just isn't remembered */
  }
}

function adopt(p: Player): void {
  player = p
  owner = ownerKey(p)
  // Only at boot: switching characters mid-session must not teleport you
  if (booted) return
  booted = true
  void restore()
}

async function restore(): Promise<void> {
  restoring = true
  const loc = window.location.pathname === '/' ? read() : null // a teleport link decides where you arrive
  if (!loc) {
    restoring = false
    return
  }
  const [px, py, pz] = loc.flight.p
  const [qx, qy, qz, qw] = loc.flight.q
  flightController.reset(new THREE.Vector3(px, py, pz), new THREE.Quaternion(qx, qy, qz, qw))
  useUniverseStore.getState().updatePlayerState({ x: px, y: py, z: pz }, { x: 0, y: 0, z: 0 }, { x: qx, y: qy, z: qz, w: qw }, 0)
  teleportSystem.requestSnap()

  if (loc.world) {
    // Only go back inside once the world is known (it may be gone); the spot is applied on entry
    const id = loc.world.id
    const known = await new Promise<boolean>((resolve) => {
      if (useUniverseStore.getState().worlds.has(id)) return resolve(true)
      const t = setTimeout(() => done(false), WORLD_WAIT_MS)
      const unsub = useUniverseStore.subscribe((s) => {
        if (s.worlds.has(id)) done(true)
      })
      function done(v: boolean) {
        clearTimeout(t)
        unsub()
        resolve(v)
      }
    })
    if (known && !useUniverseStore.getState().activeWorldId) {
      const w = loc.world
      interiorController.restoreOnNextReset({ x: w.x, y: w.y, z: w.z, fx: w.fx, fz: w.fz, pitch: w.pitch })
      useUniverseStore.getState().enterWorld(id)
    }
  }
  restoring = false
}

export function startLocationPersistence(): void {
  if (started) return
  started = true
  void playerReady.then(adopt)
  subscribePlayer(() => {
    const p = getPlayerSnapshot()
    if (p && ownerKey(p) !== owner) adopt(p)
    else if (p) player = p
  })
  setInterval(save, SAVE_MS)
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save()
  })
}

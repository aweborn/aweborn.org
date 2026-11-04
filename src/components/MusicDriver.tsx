import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ORIGIN_POSITION, ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { music, HEAR_FAR, type SoundingWorld } from '../audio/music/director'
import { audio } from '../audio/engine'
import { flightController } from '../systems/FlightController'
import { interiorController } from '../systems/InteriorController'
import { warpSystem } from '../systems/WarpSystem'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useSkyStore } from '../stores/skyStore'
import { activeTierIndex, useQualityStore } from '../stores/qualityStore'
import { getPresenceState } from '../hooks/usePresence'

/**
 * Feeds the music director from the game, ~15 times a second (2026-11-03):
 * where your character is and which way it faces (the ears), the worlds
 * near you in space, the world you're in, the pool, the sun, speed, warp and
 * company. Rendered in both views; renders nothing.
 */

const EVERY = 1 / 15
const EYE = 1.6
const COMPANY_SPACE = 60
const COMPANY_WORLD = 24
const MAX_SPEED = 60

const fwd = new THREE.Vector3()
const up = new THREE.Vector3()

export function MusicDriver() {
  const acc = useRef(0)
  useFrame((_s, delta) => {
    acc.current += delta
    if (acc.current < EVERY) return
    acc.current = 0
    if (audio.state !== 'running') return

    const u = useUniverseStore.getState()
    const activeWorldId = u.activeWorldId
    const presence = getPresenceState()
    let ear
    let inside = null
    const near: SoundingWorld[] = []
    let originDistance = Infinity
    let beyondFrontier = 0
    let speed = 0
    let company = 0

    if (activeWorldId) {
      const s = interiorController.state
      ear = { x: s.x, y: s.y + EYE, z: s.z, fx: s.fx, fy: 0, fz: s.fz, ux: 0, uy: 1, uz: 0 }
      const meta = useWorldStore.getState().meta
      const entry = u.worlds.get(activeWorldId)
      inside = {
        id: activeWorldId,
        origin: activeWorldId === ORIGIN_WORLD_ID,
        // The world's own doc first; its universe entry while the doc is still arriving
        music: meta ? meta.music : entry?.music,
        ambient: meta ? meta.ambientSound : entry?.ambientSound,
      }
      for (const p of presence.values()) {
        if (p.inWorld !== activeWorldId) continue
        if (Math.hypot(p.position.x - s.x, p.position.y - s.y, p.position.z - s.z) < COMPANY_WORLD) company++
      }
    } else {
      const { position: pos, quaternion: q, velocity } = flightController
      fwd.set(0, 0, -1).applyQuaternion(q)
      up.set(0, 1, 0).applyQuaternion(q)
      ear = { x: pos.x, y: pos.y, z: pos.z, fx: fwd.x, fy: fwd.y, fz: fwd.z, ux: up.x, uy: up.y, uz: up.z }
      speed = velocity.length() / MAX_SPEED
      originDistance = Math.hypot(pos.x - ORIGIN_POSITION.x, pos.y - ORIGIN_POSITION.y, pos.z - ORIGIN_POSITION.z)
      const r = u.mana?.frontierRadius ?? 0
      beyondFrontier = r > 0 ? Math.min(1, Math.max(0, (originDistance - r) / Math.max(60, r * 0.5))) : 0
      for (const w of u.worlds.values()) {
        if (w.parentWorldId) continue
        const p = w.resolvedPosition
        const d = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z)
        if (d > HEAR_FAR) continue
        near.push({ id: w.id, x: p.x, y: p.y, z: p.z, distance: d, music: w.music, ambient: w.ambientSound, ghost: !w.solidified })
      }
      near.sort((a, b) => a.distance - b.distance)
      for (const p of presence.values()) {
        if (p.inWorld) continue
        if (Math.hypot(p.position.x - pos.x, p.position.y - pos.y, p.position.z - pos.z) < COMPANY_SPACE) company++
      }
    }

    const warp = warpSystem.getState()
    const quality = useQualityStore.getState()
    music.update({
      ear,
      inside,
      near,
      originDistance,
      beyondFrontier,
      speed,
      charge: warp.phase === 'charging' ? warp.chargeProgress : 0,
      leaping: warp.phase === 'leaping',
      company: Math.min(4, company),
      sun: useSkyStore.getState().sun,
      band: audio.currentBand ?? 'medium',
      maxSlots: activeTierIndex(quality) === 0 ? 1 : 2,
    })
  })
  return null
}


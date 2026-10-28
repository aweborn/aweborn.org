import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { starSize } from '@aweborn/shared/sky'
import { starQueue, describeStar, useSkyStore, type StarSpawn } from '../stores/skyStore'
import { useUniverseStore } from '../stores/universeStore'

/**
 * Shooting stars (Phase 05 "Every Draw Is Visible", Rough Draft M4): every
 * mana that leaves the pool streaks away, coloured by its Form 990 function
 * (gold program, blue management & general, silver fundraising). Size ∝
 * log(amount). Tap (or hover with a mouse) near a star for its line:
 * "Servers · 42 mana · today" and the Form 990 nature.
 *
 * Fixed pool of meshes (no allocation per star). Spawned near what the
 * player can see: from the Portal when it's close, otherwise from a point
 * ahead of the camera; creations rise out of a solid world when one is in
 * view range.
 */

const POOL = 12
const LIFE_S = 2.6
const PICK_PX = 44
const AUTO_CAPTION_GAP_MS = 25_000

interface Live {
  spawn: StarSpawn
  pos: THREE.Vector3
  vel: THREE.Vector3
  age: number
  life: number
  size: number
  color: THREE.Color
}

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

export function ShootingStars() {
  const { camera, gl } = useThree()
  const groups = useRef<(THREE.Group | null)[]>([])
  const live = useRef<(Live | null)[]>(Array.from({ length: POOL }, () => null))
  const screen = useRef<{ x: number; y: number; on: boolean }[]>(Array.from({ length: POOL }, () => ({ x: 0, y: 0, on: false })))
  const lastAuto = useRef(0)

  const mats = useMemo(
    () =>
      Array.from({ length: POOL }, () => ({
        head: new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
        tail: new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5 }),
      })),
    [],
  )
  const headGeo = useMemo(() => new THREE.SphereGeometry(0.22, 10, 8), [])
  // Comet tail: +Y is turned to the velocity, so the cone's tip trails behind the head.
  const tailGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.16, 1, 8, 1, true)
    g.rotateX(Math.PI) // tip down
    g.translate(0, -0.5, 0) // wide end at the head (y = 0), tip trailing at y = −1
    return g
  }, [])
  useEffect(() => () => {
    headGeo.dispose()
    tailGeo.dispose()
    for (const m of mats) { m.head.dispose(); m.tail.dispose() }
  }, [headGeo, tailGeo, mats])

  // Tap / hover → caption for the nearest visible star.
  useEffect(() => {
    const el = gl.domElement
    const pick = (e: PointerEvent) => {
      if (e.target !== el) return
      if (e.type === 'pointermove' && e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      let best = -1
      let bestD = PICK_PX * PICK_PX
      screen.current.forEach((s, i) => {
        if (!s.on) return
        const d = (s.x - px) ** 2 + (s.y - py) ** 2
        if (d < bestD) { bestD = d; best = i }
      })
      const l = best >= 0 ? live.current[best] : null
      if (!l) return
      const words = describeStar(l.spawn)
      useSkyStore.getState().showCaption({ ...words, x: e.clientX, y: e.clientY })
    }
    el.addEventListener('pointerdown', pick)
    el.addEventListener('pointermove', pick)
    return () => {
      el.removeEventListener('pointerdown', pick)
      el.removeEventListener('pointermove', pick)
    }
  }, [gl])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    // Launch queued stars into free slots.
    while (starQueue.length > 0) {
      const slot = live.current.findIndex((l) => l === null)
      if (slot < 0) break
      const s = starQueue.shift()!
      live.current[slot] = makeStar(s, camera)
      const g = groups.current[slot]
      if (g) {
        mats[slot].head.color.copy(live.current[slot]!.color)
        mats[slot].tail.color.copy(live.current[slot]!.color)
      }
      // Rare, meaningful events get a caption on their own (not the steady drizzle).
      if (s.kind !== 'drizzle' && Date.now() - lastAuto.current > AUTO_CAPTION_GAP_MS) {
        lastAuto.current = Date.now()
        const words = describeStar(s)
        useSkyStore.getState().showCaption({ ...words, x: window.innerWidth / 2, y: Math.max(270, window.innerHeight * 0.3 + 64) })
      }
    }

    const w = gl.domElement.clientWidth
    const h = gl.domElement.clientHeight
    for (let i = 0; i < POOL; i++) {
      const l = live.current[i]
      const g = groups.current[i]
      const sc = screen.current[i]
      if (!g) continue
      if (!l) {
        g.visible = false
        sc.on = false
        continue
      }
      l.age += dt
      if (l.age >= l.life) {
        live.current[i] = null
        g.visible = false
        sc.on = false
        continue
      }
      l.pos.addScaledVector(l.vel, dt)
      const t = l.age / l.life
      const fade = t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 1.6)
      g.visible = true
      g.position.copy(l.pos)
      _v.copy(l.vel).normalize()
      _q.setFromUnitVectors(UP, _v)
      g.quaternion.copy(_q)
      const tailLen = l.size * (5 + 9 * Math.min(1, t * 3))
      const head = g.children[0] as THREE.Mesh
      const tail = g.children[1] as THREE.Mesh
      head.scale.setScalar(l.size)
      tail.scale.set(l.size, tailLen, l.size)
      mats[i].head.opacity = fade
      mats[i].tail.opacity = 0.45 * fade
      // Screen position for picking.
      _v.copy(l.pos).project(camera)
      sc.on = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1
      sc.x = (_v.x * 0.5 + 0.5) * w
      sc.y = (-_v.y * 0.5 + 0.5) * h
    }
  })

  return (
    <group>
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g }} visible={false}>
          <mesh geometry={headGeo} material={mats[i].head} frustumCulled={false} />
          <mesh geometry={tailGeo} material={mats[i].tail} frustumCulled={false} />
        </group>
      ))}
    </group>
  )
}

/** Where a star starts and where it goes, chosen so the player can see it. */
function makeStar(s: StarSpawn, camera: THREE.Camera): Live {
  const cam = camera.position
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  const rand = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
  let origin: THREE.Vector3
  if (s.kind === 'creation') {
    // Rise out of a solid world in view range (the nearest few), else ahead of the camera.
    const near: THREE.Vector3[] = []
    for (const wld of useUniverseStore.getState().worlds.values()) {
      if (!wld.solidified) continue
      const rp = wld.resolvedPosition ?? wld.intendedPosition
      const p = new THREE.Vector3(rp.x, rp.y, rp.z)
      const d = p.distanceTo(cam)
      if (d < 140 && d > 8) near.push(p)
      if (near.length >= 6) break
    }
    origin = near.length ? near[Math.floor(Math.random() * near.length)] : cam.clone().addScaledVector(fwd, 45).add(rand().multiplyScalar(30))
  } else if (cam.length() < 120) {
    origin = new THREE.Vector3(0, 2, 0) // the Portal
  } else {
    origin = cam.clone().addScaledVector(fwd, 50).add(rand().multiplyScalar(40))
  }
  // Out and away: up-ish from the source, with a sideways sweep across the view.
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize()
  const dir = new THREE.Vector3(0, 1, 0)
    .addScaledVector(right, (Math.random() - 0.5) * 1.6)
    .addScaledVector(fwd, 0.35 + Math.random() * 0.4)
    .normalize()
  const speed = s.kind === 'shortfall' ? 18 : 34 + Math.random() * 18
  return {
    spawn: s,
    pos: origin.clone(),
    vel: dir.multiplyScalar(speed),
    age: 0,
    life: s.kind === 'shortfall' ? LIFE_S * 1.4 : LIFE_S,
    size: s.kind === 'shortfall' ? 0.7 : starSize(s.amount),
    color: new THREE.Color(describeStar(s).color),
  }
}

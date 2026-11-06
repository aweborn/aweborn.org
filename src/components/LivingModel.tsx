import { useEffect, useMemo, useRef, useState, Suspense, Component, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { serverNow } from '../lib/serverClock'
import { Html, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'
import { cleanLife, walkSpeed, npcSender, type ObjectLife } from '@aweborn/shared/life'
import { AUTH_URL } from '../lib/player'
import { useModelShapes, prepareModelAsset, registerModelShape, skinnedLiteMaterial } from '../stores/modelShapes'
import { useQualityTier } from '../stores/qualityStore'
import { useWorldStore } from '../stores/worldStore'
import { groundAt, isCarried, localCarry, roamOffset } from '../stores/livePosition'
import { interiorController } from '../systems/InteriorController'
import { getPresenceState } from '../hooks/usePresence'
import { ChatBubble } from './ChatBubble'
import { groan, footstep, speak, type CreatureSize } from '../audio/creature'
import { quadrupedPlan, walkingMaterial, type LegUniforms } from '../stores/quadrupedWalk'
import { trot } from '@aweborn/shared/quadruped'

/**
 * A creation that's alive (Phase 07 Life & minds).
 *
 *   alive     the decimated still model inside a group that breathes (a slow squash),
 *             sways, turns toward whoever comes near, and roams around its home.
 *   animated  the rigged GLB (skeleton + idle / walk / talk / emote clips): walk while
 *             roaming, idle otherwise, crossfaded; talk or emote when its mind speaks.
 *
 * Roaming is deterministic from the clock (shared/life.ts roamPose), so every player
 * sees the same walk with no messages. A mind adds a name, a greeting the first time
 * you come near (its pre-spoken clip), and its replies from world chat: a speech
 * bubble, its voice from where it stands, a turn to face whoever it answers.
 * Sounds (groans, footfalls) are synthesized (audio/creature.ts).
 */

const assetUrl = (a: string) => `${AUTH_URL}/assets/${a}?v=2`

/** Bigger than this (scale) sounds like a giant. */
function sizeOf(obj: PlacedObject): CreatureSize {
  if (obj.mind?.size) return obj.mind.size
  const h = Math.abs(obj.scaleY || 1)
  return h >= 4 ? 'giant' : h >= 2.2 ? 'large' : h < 0.7 ? 'small' : 'human'
}

/** Smallest signed angle a → b. */
const angleTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[life] animated model failed, showing it still:', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// ── Shared per-frame state between the body (motion) and the rig (clips) ──

interface Body {
  moving: boolean
  /** A one-shot clip to play now (talk/emote), consumed by the rig. */
  cue: 'talk' | 'emote' | null
  /** Until when it's talking (alive models nod; rigs loop talk). */
  talkUntil: number
}

// ── The rigged model ─────────────────────────────────────────────────

function AnimatedRig({ asset, life, body, dist, weight }: { asset: string; life: ObjectLife; body: React.MutableRefObject<Body>; dist: React.MutableRefObject<number>; weight: number }) {
  const gltf = useGLTF(assetUrl(asset))
  const { root, fitted } = useMemo(() => {
    const r = cloneSkinned(gltf.scene) as THREE.Object3D
    // Fit the bind pose into the unit box (like still models), centred, feet at -0.5
    r.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(r)
    const size = box.getSize(new THREE.Vector3())
    const c = box.getCenter(new THREE.Vector3())
    const s = 1 / Math.max(size.x, size.y, size.z, 1e-6)
    r.position.sub(c).multiplyScalar(s)
    r.scale.setScalar(s)
    const g = new THREE.Group()
    g.add(r)
    r.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isMesh) return
      m.frustumCulled = false // limbs swing outside the bind-pose bounds
      const raw = Array.isArray(m.material) ? m.material[0] : m.material
      m.material = skinnedLiteMaterial(raw, !!m.geometry.attributes.uv)
    })
    return { root: r, fitted: g }
  }, [gltf.scene])

  // Colliders + far proxy from the bind pose, once per asset
  useEffect(() => registerModelShape(asset, fitted), [asset, fitted])

  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const actions = useMemo(() => {
    const out: Partial<Record<'idle' | 'walk' | 'talk' | 'emote', THREE.AnimationAction>> = {}
    for (const clip of gltf.animations) {
      const role = clip.name as 'idle' | 'walk' | 'talk' | 'emote'
      if (!['idle', 'walk', 'talk', 'emote'].includes(role)) continue
      // Roaming (game logic) owns the position: pin the sideways drift of the hips and of any
      // root above them to the first frame (Meshy's `_inplace` clips barely drift; root motion
      // on the armature walked the body ahead then snapped it back every loop: the back-and-forth
      // jitter in the 2026-11-06 playtest), keep the up-down bob
      const c = clip.clone()
      for (const tr of c.tracks) {
        if (!tr.name.endsWith('.position') || !/hips|pelvis|root|armature|^scene/i.test(tr.name)) continue
        const v = tr.values
        for (let i = 3; i < v.length; i += 3) {
          v[i] = v[0]
          v[i + 2] = v[2]
        }
      }
      const a = mixer.clipAction(c)
      if (role === 'talk' || role === 'emote') {
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = false
      }
      out[role] = a
    }
    return out
  }, [gltf.animations, mixer])

  const current = useRef<THREE.AnimationAction | null>(null)
  const oneShot = useRef<THREE.AnimationAction | null>(null)
  const acc = useRef(0)
  const feet = useRef<{ bones: THREE.Object3D[]; lastY: number[]; falling: boolean[] } | null>(null)

  useEffect(() => {
    const bones: THREE.Object3D[] = []
    root.traverse((o) => {
      if (/^(Left|Right)Foot$/i.test(o.name)) bones.push(o)
    })
    feet.current = { bones, lastY: bones.map(() => Infinity), falling: bones.map(() => false) }
    const idle = actions.idle ?? actions.walk
    idle?.reset().fadeIn(0.3).play()
    current.current = idle ?? null
    const onDone = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== oneShot.current) return
      oneShot.current = null
      e.action.fadeOut(0.5)
      current.current?.reset().fadeIn(0.5).play()
    }
    mixer.addEventListener('finished', onDone as never)
    return () => {
      mixer.removeEventListener('finished', onDone as never)
      mixer.stopAllAction()
    }
  }, [actions, mixer, root])

  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, delta) => {
    const b = body.current
    for (const a of Object.values(actions)) if (a) a.timeScale = life.pace
    // Base loop: walk while roaming, idle otherwise
    const want = (b.moving ? actions.walk : actions.idle) ?? actions.idle ?? actions.walk ?? null
    if (want && want !== current.current) {
      want.reset().play()
      if (current.current && !oneShot.current) current.current.crossFadeTo(want, 0.6, true)
      current.current = want
    }
    // One-shot clip on cue (its mind spoke)
    if (b.cue) {
      const a = actions[b.cue]
      b.cue = null
      if (a && !b.moving) {
        oneShot.current?.fadeOut(0.3)
        a.reset().fadeIn(0.4).play()
        current.current?.fadeOut(0.4)
        oneShot.current = a
      }
    }
    // Animation LOD: full rate near, ~12 Hz far, frozen past the fog
    const d = dist.current
    acc.current += delta
    const step = d < 30 ? 0 : d < 80 ? 1 / 12 : Infinity
    if (acc.current < step) return
    mixer.update(acc.current)
    acc.current = 0
    // Footfalls: a foot bone that was falling and now rises, near its lowest point, lands
    const f = feet.current
    if (!f || !b.moving || d > 45) return
    f.bones.forEach((bone, i) => {
      bone.getWorldPosition(v)
      const dy = v.y - f.lastY[i]
      if (f.falling[i] && dy > 0) footstep(v.x, v.y, v.z, weight)
      f.falling[i] = dy < -1e-4
      f.lastY[i] = v.y
    })
  })

  return <primitive object={fitted} />
}

// ── The still model, alive ───────────────────────────────────────────

function StillParts({ asset }: { asset: string }) {
  const tier = useQualityTier()
  const parts = useModelShapes((s) => s.models[asset])
  const proxy = useModelShapes((s) => s.proxies[asset])
  const gltf = useGLTF(assetUrl(asset))
  useEffect(() => prepareModelAsset(asset, gltf.scene, tier.modelMaxTris), [asset, gltf.scene, tier.modelMaxTris])
  if (parts) return <>{parts.map((p, i) => <mesh key={i} geometry={p.lod0} material={p.material} />)}</>
  if (proxy) return <mesh geometry={proxy}><meshLambertMaterial vertexColors /></mesh>
  return null
}

// ── The still model, walking on four legs ────────────────────────────

/**
 * Legs found in the mesh swing in a trot about their hips while it roams; the head
 * nods (and now and then dips, as if grazing) while it stands. Falls back to the
 * plain still model when no four legs are found.
 */
function FourLegged({ asset, life, body, h }: { asset: string; life: ObjectLife; body: React.MutableRefObject<Body>; h: number }) {
  const tier = useQualityTier()
  const parts = useModelShapes((s) => s.models[asset])
  const proxy = useModelShapes((s) => s.proxies[asset])
  const gltf = useGLTF(assetUrl(asset))
  useEffect(() => prepareModelAsset(asset, gltf.scene, tier.modelMaxTris), [asset, gltf.scene, tier.modelMaxTris])
  const u = useMemo<LegUniforms>(() => ({ uLegA: { value: new THREE.Vector4() }, uHeadA: { value: 0 } }), [])
  const rig = useMemo(() => {
    if (!parts) return null
    const plan = quadrupedPlan(asset, parts)
    if (!plan) return null
    return { plan, materials: parts.map((p) => walkingMaterial(p.material, plan, u)) }
  }, [asset, parts, u])
  useEffect(() => () => rig?.materials.forEach((m) => m.dispose()), [rig])
  const phase = useRef(0)
  const amp = useRef(0)
  const graze = useRef({ until: 0, next: performance.now() + 6000 + Math.random() * 8000 })

  useFrame((state, delta) => {
    if (!rig) return
    const b = body.current
    // Stride from leg length: the swing advances with distance walked
    const legLen = Math.max(0.05, (rig.plan.legTop - rig.plan.floor) * h)
    const speed = walkSpeed(h, life.pace)
    amp.current += ((b.moving ? 0.42 : 0) - amp.current) * Math.min(1, delta * 4)
    if (b.moving) phase.current += (delta * speed * Math.PI) / (legLen * 1.1)
    const [a, bb, c, d] = trot(phase.current, amp.current)
    u.uLegA.value.set(a, bb, c, d)
    // Head: a slow look about; standing still it sometimes dips its head as if grazing
    const now = performance.now()
    const g = graze.current
    if (!b.moving && now > g.next) {
      g.until = now + 2500 + Math.random() * 2500
      g.next = g.until + 7000 + Math.random() * 12000
    }
    const want = b.moving ? 0.06 * Math.sin(phase.current * 2) : now < g.until ? -0.55 : 0.08 * Math.sin(state.clock.elapsedTime * 0.6)
    u.uHeadA.value += (want - u.uHeadA.value) * Math.min(1, delta * 2.5)
  })

  if (parts && rig) return <>{parts.map((p, i) => <mesh key={i} geometry={p.lod0} material={rig.materials[i]} />)}</>
  if (parts) return <>{parts.map((p, i) => <mesh key={i} geometry={p.lod0} material={p.material} />)}</>
  if (proxy) return <mesh geometry={proxy}><meshLambertMaterial vertexColors /></mesh>
  return null
}

// ── A mind's face to the world ───────────────────────────────────────

function MindLayer({ obj, body, pos }: { obj: PlacedObject; body: React.MutableRefObject<Body>; pos: React.MutableRefObject<THREE.Vector3> }) {
  const mind = obj.mind!
  const sender = npcSender(obj.id)
  const size = sizeOf(obj)
  const line = useWorldStore((s) => {
    for (let i = s.chat.length - 1; i >= Math.max(0, s.chat.length - 30); i--) if (s.chat[i].sender === sender) return s.chat[i]
    return null
  })
  const [greet, setGreet] = useState<string | null>(null)
  const greeted = useRef(false)
  const played = useRef<number>(0)

  // A new line from its mind: turn to whoever it answers, play the clip, speak
  useEffect(() => {
    if (!line || Math.abs(serverNow() - line.t) > 15_000 || played.current === line.t) return
    played.current = line.t
    const b = body.current
    if (line.anim) b.cue = line.anim
    b.talkUntil = performance.now() + Math.max(2500, line.text.length * 70)
    if (line.voice) {
      const p = pos.current
      void speak(`${AUTH_URL}/assets/${line.voice}`, p.x, p.y, p.z, size).then((s) => {
        if (s > 0) body.current.talkUntil = performance.now() + s * 1000
      })
    }
  }, [line, body, pos, size])

  // The greeting: the first time this player comes near (local; its clip was spoken once at creation)
  useFrame(() => {
    if (greeted.current || !mind.greeting) return
    const s = interiorController.state
    const p = pos.current
    if (Math.hypot(s.x - p.x, s.z - p.z) > 7 + Math.abs(obj.scaleX || 1) * 0.5) return
    greeted.current = true
    setGreet(mind.greeting)
    body.current.cue = 'emote'
    body.current.talkUntil = performance.now() + 3000
    if (mind.greetingVoice) void speak(`${AUTH_URL}/assets/${mind.greetingVoice}`, p.x, p.y, p.z, size)
    window.setTimeout(() => setGreet(null), 7000)
  })

  const top = 0.62
  // Labels sit inside the creature's scaled group: scale the screen size back up for big ones
  const df = 9 * Math.max(1, Math.sqrt(Math.abs(obj.scaleY || 1)))
  return (
    <>
      <Html position={[0, top, 0]} center distanceFactor={df} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div className="name-tag name-tag--mind">{mind.name}</div>
      </Html>
      {greet && !line && (
        <Html position={[0, top + 0.12, 0]} center distanceFactor={df} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="chat-bubble chat-bubble--mind">{greet}</div>
        </Html>
      )}
      <ChatBubble playerId={sender} height={top + 0.12} size={df} />
    </>
  )
}

// ── The living object ────────────────────────────────────────────────

export function LivingModel({ obj, fogFar }: { obj: PlacedObject; fogFar: number }) {
  const life = useMemo(() => cleanLife(obj.life), [obj.life])
  const outer = useRef<THREE.Group>(null!)
  const inner = useRef<THREE.Group>(null!)
  const body = useRef<Body>({ moving: false, cue: null, talkUntil: 0 })
  const dist = useRef(0)
  const pos = useRef(new THREE.Vector3(obj.x, obj.y, obj.z))
  const yaw = useRef(obj.rotY || 0)
  const ground = useRef<{ x: number; z: number; y: number } | null>(null)
  /** Height it's drawn at: eases between ground samples instead of stepping a whole voxel. */
  const shownY = useRef<number | null>(null)
  const scaleRef = useRef<THREE.Group>(null!)
  const nextGroan = useRef(performance.now() + 8000 + Math.random() * 20000)
  const stride = useRef(0)
  const [near, setNear] = useState(false)
  const size = sizeOf(obj)
  const h = Math.abs(obj.scaleY || 1)
  const seed = useMemo(() => (obj.id.charCodeAt(obj.id.length - 1) % 17) / 17, [obj.id])

  useFrame((state, delta) => {
    if (!life || !outer.current) return
    const now = serverNow() // the server's clock: every player sees the creature in the same place
    const t = state.clock.elapsedTime
    const b = body.current
    const speed = walkSpeed(h, life.pace)
    // Held: in your hands (drawn every frame), or where its carrier puts it. It doesn't
    // roam or turn to anyone meanwhile, so it no longer fights the hands holding it.
    const mine = localCarry.id === obj.id
    const held = mine || isCarried(obj, now)
    // Where it is: home + its deterministic roam (shared with kick / grab aiming)
    const r = roamOffset(obj, now)
    let x = obj.x + r.dx
    let z = obj.z + r.dz
    let y = obj.y
    if (mine) {
      x = localCarry.x
      y = localCarry.y
      z = localCarry.z
    } else if (!held && life.roam > 0) {
      const g = ground.current
      if (!g || Math.hypot(g.x - x, g.z - z) > 0.25) {
        const gy = groundAt(x, z)
        ground.current = gy === null ? null : { x, z, y: gy + h / 2 }
      }
      if (ground.current) y = ground.current.y
    }
    // Ease height and any jump from someone else's move (10 Hz carry writes, a set-down)
    const p0 = pos.current
    const far = Math.hypot(p0.x - x, p0.z - z) > 4 || shownY.current === null
    if (mine || far) {
      shownY.current = y
    } else {
      const k = 1 - Math.exp(-(held ? 16 : 10) * delta)
      shownY.current += (y - shownY.current) * k
      if (held) {
        x = p0.x + (x - p0.x) * k
        z = p0.z + (z - p0.z) * k
      }
      y = shownY.current
    }
    b.moving = r.moving && !held
    pos.current.set(x, y, z)
    outer.current.position.set(x, y, z)
    if (scaleRef.current) {
      if (mine) scaleRef.current.scale.set(localCarry.sx, localCarry.sy, localCarry.sz)
      else scaleRef.current.scale.set(obj.scaleX, obj.scaleY, obj.scaleZ)
    }

    const cam = state.camera.position
    const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z)
    dist.current = d
    outer.current.visible = d < fogFar + h + 8
    if (!near && d < fogFar + 24) setNear(true)

    // Facing: the way it walks; else whoever it's answering; else the nearest player close by
    let want = held ? (mine ? localCarry.rotY : obj.rotY || 0) : r.moving ? r.heading : yaw.current
    if (!r.moving && !held) {
      const me = interiorController.state
      let target: { x: number; z: number } | null = null
      const chat = useWorldStore.getState().chat
      const me_ = npcSender(obj.id)
      let answering: (typeof chat)[number] | undefined
      for (let i = chat.length - 1; i >= Math.max(0, chat.length - 30); i--) {
        if (chat[i].sender === me_) {
          answering = chat[i]
          break
        }
      }
      if (answering?.to && now - answering.t < 9000) {
        const p = getPresenceState().get(answering.to)
        target = p?.inWorld ? { x: p.position.x, z: p.position.z } : { x: me.x, z: me.z }
      } else if (Math.hypot(me.x - x, me.z - z) < 8 + h) target = { x: me.x, z: me.z }
      // Someone standing inside its footprint (reaching to grab it) is no direction at all:
      // facing them there swung it side to side with every step
      const reach = 0.5 * Math.max(Math.abs(obj.scaleX || 1), Math.abs(obj.scaleZ || 1)) + 0.4
      if (target && Math.hypot(target.x - x, target.z - z) > reach) {
        const a = Math.atan2(target.x - x, target.z - z)
        if (Math.abs(angleTo(yaw.current, a)) > 0.12) want = a // ~7°: no twitching at small steps
      }
    }
    const turnRate = held ? 12 : (r.moving ? 2.2 : 0.9) * life.pace
    yaw.current += angleTo(yaw.current, want) * Math.min(1, delta * turnRate)
    outer.current.rotation.set(0, yaw.current, 0)

    // Procedural life on top (animated rigs breathe in their clips already)
    const breathe = (2 * Math.PI) / (3.6 / life.pace)
    if (inner.current) {
      if (life.mode === 'alive') {
        const talking = performance.now() < b.talkUntil
        const k = 0.018 * Math.sin(t * breathe + seed * 6)
        const nod = talking ? 0.025 * Math.sin(t * 9) : 0
        inner.current.scale.set(1 - k * 0.5, 1 + k + nod, 1 - k * 0.5)
        inner.current.rotation.z = 0.02 * Math.sin(t * breathe * 0.5 + seed * 3)
        inner.current.rotation.x = r.moving && life.legs !== 4 ? 0.035 * Math.sin(t * speed * 4) : 0
        inner.current.position.y = r.moving ? 0.015 * Math.abs(Math.sin(t * speed * 4)) : 0
      } else {
        inner.current.scale.set(1, 1, 1)
        inner.current.rotation.set(0, 0, 0)
        inner.current.position.y = 0
      }
    }

    // Sounds: an occasional groan from big things when someone is near; footfalls for still-model walkers
    const pn = performance.now()
    const vocals = obj.mind?.sounds
    if ((size === 'giant' || size === 'large' || vocals?.length) && d < 40 && pn > nextGroan.current && pn > b.talkUntil) {
      // Its own voice's groans/sighs when its mind made some; else a synthesized groan
      const clip = vocals?.length ? vocals[Math.floor(Math.random() * vocals.length)] : null
      if (clip && /^[a-f0-9]{64}\.(mp3|wav)$/.test(clip)) void speak(`${AUTH_URL}/assets/${clip}`, x, y + h * 0.3, z, size)
      else groan(x, y + h * 0.3, z, size, seed)
      nextGroan.current = pn + (18_000 + Math.random() * 25_000) / life.pace
    }
    if (life.mode === 'alive' && r.moving && d < 40) {
      stride.current += delta * speed
      const strideLen = 0.7 * Math.sqrt(h)
      if (stride.current > strideLen) {
        stride.current = 0
        footstep(x, y - h / 2, z, Math.min(1, h / 6))
      }
    }
  })

  if (!life || !obj.asset) return null
  const s: [number, number, number] = [obj.scaleX, obj.scaleY, obj.scaleZ]
  return (
    <group ref={outer} position={[obj.x, obj.y, obj.z]}>
      <group ref={scaleRef} scale={s}>
        <group ref={inner}>
          {near && (
            <Boundary fallback={<StillFallback asset={obj.stillAsset ?? obj.asset} />}>
              <Suspense fallback={<ProxyOnly asset={obj.asset} />}>
                {life.mode === 'animated' ? (
                  <AnimatedRig asset={obj.asset} life={life} body={body} dist={dist} weight={Math.min(1, h / 6)} />
                ) : life.legs === 4 ? (
                  <FourLegged asset={obj.asset} life={life} body={body} h={h} />
                ) : (
                  <StillParts asset={obj.asset} />
                )}
              </Suspense>
            </Boundary>
          )}
        </group>
        {obj.mind && <MindLayer obj={obj} body={body} pos={pos} />}
      </group>
    </group>
  )
}

function ProxyOnly({ asset }: { asset: string }) {
  const proxy = useModelShapes((s) => s.proxies[asset])
  return proxy ? <mesh geometry={proxy}><meshLambertMaterial vertexColors /></mesh> : null
}

function StillFallback({ asset }: { asset: string }) {
  return (
    <Suspense fallback={<ProxyOnly asset={asset} />}>
      <StillParts asset={asset} />
    </Suspense>
  )
}

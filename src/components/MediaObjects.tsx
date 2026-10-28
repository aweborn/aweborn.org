import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { PlacedObject } from '@aweborn/shared/crdt-schema'
import { AUTH_URL } from '../lib/player'
import { audio } from '../audio/engine'
import { interiorController } from '../systems/InteriorController'

/**
 * Media objects (Rough Draft M5): what pictures, sounds and lore look like
 * (and sound like) inside a world.
 *
 *   picture  a framed generated image on a slim stand, facing where it was placed from
 *   sound    a glowing orb; its sound plays in 3D from where it stands
 *              loop  → plays while you're within earshot (ambience, music)
 *              once  → plays as you walk up to it (a voice, a chime), then rests
 *   sign     a little wooden sign; walk close and its lore appears above it
 *
 * Everything goes through the audio engine's world bus, so mute, volume and a
 * hidden tab silence it like every other sound. Nothing loads or plays until
 * you're near.
 */

const assetUrl = (asset: string) => `${AUTH_URL}/assets/${asset}`
const near = (camera: THREE.Camera, x: number, y: number, z: number) =>
  Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z)
/** Distance from the player's character (not the camera, which trails behind it). */
const fromPlayer = (x: number, y: number, z: number) => {
  const s = interiorController.state
  return Math.hypot(s.x - x, s.y - y, s.z - z)
}

// ── Picture ──────────────────────────────────────────────────────────

const FRAME_GEO = new THREE.BoxGeometry(1.72, 1.72, 0.08)
const PIC_GEO = new THREE.PlaneGeometry(1.5, 1.5)
const POST_GEO = new THREE.CylinderGeometry(0.035, 0.05, 1, 10)

export function PictureObject({ obj, fogFar }: { obj: PlacedObject; fogFar: number }) {
  const group = useRef<THREE.Group>(null!)
  const [inRange, setInRange] = useState(false)
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const s = obj.scaleX || 1
  const lift = 0.85 + 0.86 * s // frame bottom ~0.85 above the placement point

  useFrame(({ camera }) => {
    const d = near(camera, obj.x, obj.y + lift, obj.z)
    const visible = d < fogFar + 10
    if (group.current) group.current.visible = visible
    if (!inRange && d < fogFar + 30) setInRange(true)
  })

  useEffect(() => {
    if (!inRange || !obj.asset) return
    let t: THREE.Texture | null = null
    let alive = true
    new THREE.TextureLoader().load(
      assetUrl(obj.asset),
      (loaded) => {
        if (!alive) return loaded.dispose()
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.anisotropy = 4
        t = loaded
        setTex(loaded)
      },
      undefined,
      () => console.warn('[picture] failed to load', obj.asset),
    )
    return () => {
      alive = false
      t?.dispose()
    }
  }, [inRange, obj.asset])

  return (
    <group ref={group} position={[obj.x, obj.y, obj.z]} rotation={[0, obj.rotY, 0]}>
      <mesh geometry={POST_GEO} position={[0, 0.425 * s, -0.02]} scale={[1, 0.85 * s + 0.1, 1]}>
        <meshStandardMaterial color="#3a2b1d" roughness={0.8} />
      </mesh>
      <group position={[0, lift, 0]} scale={[s, s, s]}>
        <mesh geometry={FRAME_GEO}>
          <meshStandardMaterial color="#c9a25b" metalness={0.55} roughness={0.35} />
        </mesh>
        <mesh geometry={PIC_GEO} position={[0, 0, 0.045]}>
          {tex ? (
            // Unlit: a picture reads the same in a dark cave as at noon. Keyed so React builds a
            // fresh material: three won't recompile the placeholder's shader to add a map later.
            <meshBasicMaterial key="pic" map={tex} toneMapped={false} />
          ) : (
            <meshBasicMaterial key="blank" color="#1c1830" />
          )}
        </mesh>
      </group>
    </group>
  )
}

// ── Sound ────────────────────────────────────────────────────────────

const ORB_GEO = new THREE.IcosahedronGeometry(0.22, 2)
const RING_GEO = new THREE.TorusGeometry(0.36, 0.018, 8, 48)
const SOUND_COLORS = { sound: '#7fe3ff', music: '#c59bff', voice: '#ffc37a' } as const
/** Loops play within this many units, and stop a little beyond (no flapping at the edge). */
const EARSHOT = 34
/** One-shots play when you come this close, then rest. */
const TRIGGER = 5
const REST_MS = { sound: 10_000, music: 20_000, voice: 30_000 } as const

export function SoundObject({ obj, fogFar }: { obj: PlacedObject; fogFar: number }) {
  const group = useRef<THREE.Group>(null!)
  const ring = useRef<THREE.Mesh>(null!)
  const kind = obj.media ?? 'sound'
  const loop = obj.loop ?? kind !== 'voice'
  const color = SOUND_COLORS[kind]
  const voice = useRef<{ src: AudioBufferSourceNode; gain: GainNode; panner: PannerNode } | null>(null)
  const clip = useRef<AudioBuffer | null>(null)
  const loading = useRef(false)
  const lastPlayed = useRef(0)
  const playing = useRef(false)
  const y = obj.y + 0.6

  const stop = (fade = 0.4) => {
    const v = voice.current
    if (!v) return
    voice.current = null
    playing.current = false
    const t = v.gain.context.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setTargetAtTime(0, t, fade / 3)
    try {
      v.src.stop(t + fade)
    } catch {
      /* already stopped */
    }
    window.setTimeout(() => v.panner.disconnect(), fade * 1000 + 100)
  }

  const start = () => {
    const bus = audio.worldBus()
    if (!bus || !clip.current || voice.current || !audio.audibleNow) return
    const { ctx, input } = bus
    const panner = ctx.createPanner()
    panner.panningModel = 'equalpower' // cheap on phones; HRTF costs a convolver per orb
    panner.distanceModel = 'inverse'
    panner.refDistance = 2.5
    panner.maxDistance = EARSHOT + 6
    panner.rolloffFactor = 1.3
    if (panner.positionX) {
      panner.positionX.value = obj.x
      panner.positionY.value = y
      panner.positionZ.value = obj.z
    } else panner.setPosition(obj.x, y, obj.z)
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.gain.setTargetAtTime(Math.max(0, Math.min(1, obj.volume ?? 0.8)), ctx.currentTime, 0.15)
    const src = ctx.createBufferSource()
    src.buffer = clip.current
    src.loop = loop
    src.connect(gain).connect(panner).connect(input)
    src.onended = () => {
      if (voice.current?.src === src) {
        voice.current = null
        playing.current = false
        panner.disconnect()
      }
    }
    src.start()
    voice.current = { src, gain, panner }
    playing.current = true
    lastPlayed.current = performance.now()
  }

  // Leaving the world (or deleting the orb) fades it out
  useEffect(
    () => () => {
      const v = voice.current
      voice.current = null
      if (!v) return
      const t = v.gain.context.currentTime
      v.gain.gain.setTargetAtTime(0, t, 0.05)
      try {
        v.src.stop(t + 0.15)
      } catch {
        /* already stopped */
      }
    },
    [],
  )

  useFrame(({ camera, clock }) => {
    const d = near(camera, obj.x, y, obj.z)
    if (group.current) group.current.visible = d < fogFar + 10

    // Breathe; swell while sounding
    const t = clock.elapsedTime
    const k = playing.current ? 1 + 0.18 * Math.sin(t * 6) : 1 + 0.05 * Math.sin(t * 1.5 + obj.x)
    if (ring.current) {
      ring.current.scale.setScalar(k)
      ring.current.rotation.z = t * 0.4
    }

    if (!obj.asset) return
    // Load the clip only once you're near enough to hear it
    if (!clip.current && !loading.current && d < EARSHOT + 10 && audio.worldBus()) {
      loading.current = true
      void audio.loadClip(assetUrl(obj.asset)).then((b) => {
        clip.current = b
        loading.current = false
      })
    }
    if (!clip.current) return
    if (loop) {
      if (d < EARSHOT && !voice.current) start()
      else if (d > EARSHOT + 6 && voice.current) stop()
    } else if (fromPlayer(obj.x, y, obj.z) < TRIGGER && !voice.current && performance.now() - lastPlayed.current > REST_MS[kind]) {
      start()
    }
  })

  return (
    <group ref={group} position={[obj.x, y, obj.z]}>
      <mesh geometry={ORB_GEO}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} roughness={0.3} />
      </mesh>
      <mesh ref={ring} geometry={RING_GEO} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={color} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      <pointLight color={color} intensity={0.6} distance={4} decay={2} />
    </group>
  )
}

// ── Sign (lore) ──────────────────────────────────────────────────────

const BOARD_GEO = new THREE.BoxGeometry(1.1, 0.62, 0.07)
const SIGN_POST_GEO = new THREE.BoxGeometry(0.09, 1.2, 0.09)
/** Read range: the lore card shows inside this distance. */
const READ = 7

/**
 * Where the card's anchor (its bottom centre) lands on screen, held in so the whole card
 * stays visible near the edges of the view: half the CSS width (min(260px, 66vw); 380px on
 * landscape phones) + 8 from the sides, and at least its max-height (40vh) + 8 from the top.
 */
const cardAnchor = new THREE.Vector3()
function cardPosition(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): number[] {
  cardAnchor.setFromMatrixPosition(el.matrixWorld).project(camera)
  const half = Math.min(size.height <= 500 && size.width > size.height ? 190 : 130, size.width * 0.33) + 8
  const x = (cardAnchor.x * 0.5 + 0.5) * size.width
  const y = (-cardAnchor.y * 0.5 + 0.5) * size.height
  return [Math.min(size.width - half, Math.max(half, x)), Math.max(size.height * 0.4 + 8, y)]
}

/**
 * Only the nearest sign in reach shows its card (several in reach would stack
 * into an unreadable pile on a phone). Each sign bids its distance once per
 * frame; the winner is read from the previous frame's bids — O(signs) a frame.
 * The frame key is clock.elapsedTime, which R3F advances once per frame
 * (nothing here calls clock.getElapsedTime() mid-frame; doing so would break it).
 */
const signReader = { t: -1, id: '', d: READ, shown: '' }
function bidToRead(t: number, id: string, d: number): boolean {
  if (signReader.t !== t) {
    signReader.shown = signReader.id
    signReader.t = t
    signReader.id = ''
    signReader.d = READ
  }
  if (d < signReader.d) {
    signReader.d = d
    signReader.id = id
  }
  return signReader.shown === id
}

export function SignObject({ obj, fogFar }: { obj: PlacedObject; fogFar: number }) {
  const group = useRef<THREE.Group>(null!)
  const [reading, setReading] = useState(false)
  const title = useMemo(() => (obj.prompt ?? '').replace(/\s+/g, ' ').slice(0, 60), [obj.prompt])

  useFrame(({ camera, clock }) => {
    const d = near(camera, obj.x, obj.y + 1, obj.z)
    if (group.current) group.current.visible = d < fogFar + 10
    const r = bidToRead(clock.elapsedTime, obj.id, fromPlayer(obj.x, obj.y + 1, obj.z))
    if (r !== reading) setReading(r)
  })

  return (
    <group ref={group} position={[obj.x, obj.y, obj.z]} rotation={[0, obj.rotY, 0]}>
      <mesh geometry={SIGN_POST_GEO} position={[0, 0.6, -0.05]}>
        <meshStandardMaterial color="#5a4128" roughness={0.9} />
      </mesh>
      <mesh geometry={BOARD_GEO} position={[0, 1.15, 0]}>
        <meshStandardMaterial color="#9a7346" roughness={0.75} emissive="#3a2610" emissiveIntensity={0.25} />
      </mesh>
      {reading && obj.text && (
        <Html position={[0, 1.55, 0]} zIndexRange={[30, 0]} className="lore-sign-anchor" calculatePosition={cardPosition}>
          <figure className="lore-sign" aria-live="polite">
            {title && <figcaption className="lore-sign-title">{title}</figcaption>}
            <p className="lore-sign-text">{obj.text}</p>
          </figure>
        </Html>
      )}
    </group>
  )
}

// ── The world's own sound + the listener ─────────────────────────────

/** The world's sound (meta.ambientSound): everywhere inside, soft, looping. */
export function WorldSound({ asset }: { asset: string }) {
  const node = useRef<{ src: AudioBufferSourceNode; gain: GainNode } | null>(null)
  const loading = useRef(false)

  useEffect(() => {
    return () => {
      const n = node.current
      node.current = null
      if (!n) return
      const t = n.gain.context.currentTime
      n.gain.gain.setTargetAtTime(0, t, 0.4)
      try {
        n.src.stop(t + 1.5)
      } catch {
        /* stopped */
      }
    }
  }, [asset])

  // Waits for the first tap (no context before it), then starts once
  useFrame(() => {
    if (node.current || loading.current) return
    const bus = audio.worldBus()
    if (!bus || !audio.audibleNow) return
    loading.current = true
    void audio.loadClip(assetUrl(asset)).then((buf) => {
      loading.current = false
      if (!buf || node.current) return
      const { ctx, input } = bus
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.gain.setTargetAtTime(0.35, ctx.currentTime, 1.2)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(gain).connect(input)
      src.start()
      node.current = { src, gain }
    })
  })
  return null
}

const fwd = new THREE.Vector3()

/** Keeps the ears on the camera while a world has anything that sounds. */
export function SpatialListener() {
  useFrame(({ camera }) => {
    camera.getWorldDirection(fwd)
    audio.setListener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.y, fwd.z)
  })
  return null
}

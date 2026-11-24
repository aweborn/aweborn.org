import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { boundsOf, type Game, type GameBox } from '@aweborn/shared/game'
import type { MatchSlot } from '@aweborn/shared/match'
import { useUniverseStore } from '../../stores/universeStore'
import { useWorldStore } from '../../stores/worldStore'
import { interiorController } from '../../systems/InteriorController'
import { useMatchStore } from '../../lib/match'
import { liveFrame, replayClock, replayFrameAt, useViewStore, type ViewFrame } from '../../lib/matchView'
import { TEAM_COLORS } from '../GameOutlines'
import './Watch.css'

/**
 * The match on view, in the world (Phase 10): the bodies of everyone you don't already
 * see through presence, the match's things (pickups, flags, pieces, who holds the hill),
 * and the lobby's hologram of the same match.
 *
 *  - playing:  NPC slots only (the humans in your match arrive through presence) + items
 *  - watching: every slot, at the arena's real coordinates below the lobby
 *  - a replay: every slot, from the replay's own clock
 *
 * One drawing (`MatchBodies`) serves all three; it is handed a `read` function instead of
 * positions so it can move things every frame without React re-rendering.
 */

const UNKNOWN = '#cfd3e6'
const PICKUP = '#ffe08a'
const PIECE = '#7fd6ff'
const HOLO = '#9fe8ff'
const noRaycast = () => null
export const teamColor = (team: number | undefined) => (team && team > 0 ? TEAM_COLORS[(team - 1) % TEAM_COLORS.length] : UNKNOWN)

export interface MatchDrawingProps {
  /** Who is in each slot (names, teams, NPC or human). Null while a watched match's roster is still loading. */
  roster: readonly MatchSlot[] | null
  game: Game | null
  /** This frame's `{ players, items, hill }`. */
  read: () => ViewFrame | null
  /** Draw only these slots (playing: the NPCs). */
  only?: (slot: number) => boolean
}

interface ItemInfo { id: string; kind: 'pickup' | 'flag' | 'piece'; team?: number }

/** Slots and items change rarely; positions change every frame. This keeps the first two as React state. */
function useCast(read: () => ViewFrame | null, roster: readonly MatchSlot[] | null, only?: (slot: number) => boolean) {
  const [slots, setSlots] = useState<number[]>([])
  const [items, setItems] = useState<ItemInfo[]>([])
  const keys = useRef({ slots: '', items: '' })
  useFrame(() => {
    const f = read()
    const s = (roster ? roster.map((r) => r.slot) : (f?.players.map((p) => p.slot) ?? [])).filter((n) => !only || only(n))
    const sk = s.join(',')
    if (sk !== keys.current.slots) { keys.current.slots = sk; setSlots(s) }
    const ik = f ? f.items.map((i) => `${i.id}:${i.kind}:${i.team ?? 0}`).join(',') : ''
    if (ik !== keys.current.items) { keys.current.items = ik; setItems(f ? f.items.map((i) => ({ id: i.id, kind: i.kind, team: i.team })) : []) }
  })
  return { slots, items }
}

function Body({ color, name, npc, register }: { color: string; name: string | null; npc: boolean; register: (g: THREE.Group | null, m: THREE.MeshStandardMaterial | null) => void }) {
  const group = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  useEffect(() => {
    register(group.current, mat.current)
    return () => register(null, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registered once per body
  }, [])
  return (
    <group ref={group} visible={false}>
      <mesh position={[0, 0.85, 0]} raycast={noRaycast}>
        <capsuleGeometry args={[0.3, 1.1, 6, 16]} />
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.6} transparent />
      </mesh>
      <mesh position={[0, 1.35, -0.3]} raycast={noRaycast}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {(name || npc) && (
        <Html position={[0, 1.95, 0]} center distanceFactor={9} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="name-tag watch-tag" style={{ borderColor: color }}>
            {npc && <span className="watch-ai">AI</span>}
            {name}
          </div>
        </Html>
      )}
    </group>
  )
}

function ItemMesh({ info, register }: { info: ItemInfo; register: (g: THREE.Group | null) => void }) {
  const color = info.kind === 'flag' ? teamColor(info.team) : info.kind === 'piece' ? PIECE : PICKUP
  return (
    <group ref={register} visible={false}>
      {info.kind === 'flag' ? (
        <>
          <mesh position={[0, 1, 0]} raycast={noRaycast}>
            <cylinderGeometry args={[0.04, 0.04, 2, 8]} />
            <meshStandardMaterial color="#e8e8f0" />
          </mesh>
          <mesh position={[0.38, 1.7, 0]} raycast={noRaycast}>
            <boxGeometry args={[0.72, 0.46, 0.03]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} />
          </mesh>
        </>
      ) : info.kind === 'piece' ? (
        <mesh position={[0, 0.25, 0]} raycast={noRaycast}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
        </mesh>
      ) : (
        <mesh position={[0, 0.7, 0]} raycast={noRaycast}>
          <sphereGeometry args={[0.24, 16, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} />
        </mesh>
      )}
    </group>
  )
}

/** The hill's zones (king of the hill: the goals), tinted with the colour of the team holding them. */
function HillTint({ game, read }: { game: Game; read: () => ViewFrame | null }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }), [])
  const group = useRef<THREE.Group>(null)
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(() => {
    const hill = read()?.hill ?? 0
    if (group.current) group.current.visible = hill > 0
    if (hill > 0) mat.color.set(teamColor(hill))
  })
  if (game.template !== 'king-of-the-hill') return null
  return (
    <group ref={group} visible={false}>
      {game.zones.filter((z) => z.kind === 'goal').map((z) => (
        <mesh key={z.id} material={mat} position={[z.at[0], z.at[1] + z.size[1] / 2, z.at[2]]} raycast={noRaycast} renderOrder={3}>
          <boxGeometry args={z.size} />
        </mesh>
      ))}
    </group>
  )
}

/** A match drawn from snapshots or a replay: players as capsules in their team colour, and the match's things. */
export function MatchBodies({ roster, game, read, only }: MatchDrawingProps) {
  const { slots, items } = useCast(read, roster, only)
  const bodies = useRef(new Map<number, { g: THREE.Group; m: THREE.MeshStandardMaterial | null; x: number; z: number }>())
  const things = useRef(new Map<string, THREE.Group>())
  useFrame((state) => {
    const f = read()
    for (const [slot, b] of bodies.current) {
      const p = f?.players.find((x) => x.slot === slot)
      b.g.visible = !!p
      if (!p) continue
      b.g.position.set(p.x, p.y, p.z)
      // Face the way they walk (snapshots carry no facing)
      const dx = p.x - b.x
      const dz = p.z - b.z
      if (dx * dx + dz * dz > 0.0004) {
        b.g.rotation.y = Math.atan2(-dx, -dz)
        b.x = p.x
        b.z = p.z
      }
      if (b.m) b.m.opacity = p.out ? 0.25 : 1
    }
    for (const [id, g] of things.current) {
      const it = f?.items.find((x) => x.id === id)
      g.visible = !!it
      if (!it) continue
      const holder = it.heldBy !== null ? f?.players.find((p) => p.slot === it.heldBy) : undefined
      if (holder) {
        // Carried: it rides above the carrier's head
        g.position.set(holder.x, holder.y + 1.9, holder.z)
        g.scale.setScalar(0.6)
      } else {
        g.position.set(it.x, it.y + (it.kind === 'pickup' ? Math.sin(state.clock.elapsedTime * 2 + it.x) * 0.12 : 0), it.z)
        g.scale.setScalar(1)
      }
    }
  })
  return (
    <group>
      {slots.map((slot) => {
        const r = roster?.find((x) => x.slot === slot)
        return (
          <Body
            key={`${slot}:${r?.name ?? ''}:${r?.team ?? 0}:${r?.kind ?? ''}`}
            color={teamColor(r?.team)}
            name={r?.name ?? null}
            npc={r?.kind === 'npc'}
            register={(g, m) => {
              if (g) bodies.current.set(slot, { g, m, x: 0, z: 0 })
              else bodies.current.delete(slot)
            }}
          />
        )
      })}
      {items.map((info) => (
        <ItemMesh
          key={`${info.id}:${info.kind}:${info.team ?? 0}`}
          info={info}
          register={(g) => {
            if (g) things.current.set(info.id, g)
            else things.current.delete(info.id)
          }}
        />
      ))}
      {game && <HillTint game={game} read={read} />}
    </group>
  )
}

function HoloBox({ box, color, fill }: { box: GameBox; color: string; fill: number }) {
  const [w, h, d] = box.size
  const geo = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  useEffect(() => () => { geo.dispose(); edges.dispose() }, [geo, edges])
  return (
    <group position={[box.at[0], box.at[1] + h / 2, box.at[2]]}>
      {fill > 0 && (
        <mesh geometry={geo} raycast={noRaycast} renderOrder={5}>
          <meshBasicMaterial color={color} transparent opacity={fill} depthWrite={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
      )}
      <lineSegments geometry={edges} raycast={noRaycast} renderOrder={6}>
        <lineBasicMaterial color={color} transparent opacity={0.9} fog={false} />
      </lineSegments>
    </group>
  )
}

/** How wide the miniature is, in metres. */
const HOLO_SIZE = 3
const HOLO_HEIGHT = 1.15

/**
 * The lobby's hologram: the match on view as a miniature floating at chest height in the
 * middle of the lobby box, the arena fitted into about three metres. Shown to you while
 * you stand in the lobby and are tuned in (each person sees the match they chose).
 */
export function Hologram({ roster, game, read }: MatchDrawingProps) {
  const { slots, items } = useCast(read, roster)
  const root = useRef<THREE.Group>(null)
  const pegs = useRef(new Map<number, THREE.Mesh>())
  const dots = useRef(new Map<string, THREE.Mesh>())
  const hillMat = useRef<THREE.MeshBasicMaterial>(null)
  const arena = game?.arena ?? null
  const lobby = game?.lobby ?? null
  const scale = arena ? HOLO_SIZE / Math.max(arena.size[0], arena.size[2]) : 1
  // Pegs keep a readable size whatever the arena's size
  const peg = 0.07 / scale
  useFrame(() => {
    if (!root.current || !lobby) return
    const s = interiorController.state
    const b = boundsOf(lobby)
    root.current.visible = s.x > b.minX - 1 && s.x < b.maxX + 1 && s.z > b.minZ - 1 && s.z < b.maxZ + 1 && s.y > b.minY - 3 && s.y < b.maxY + 3
    if (!root.current.visible) return
    const f = read()
    for (const [slot, m] of pegs.current) {
      const p = f?.players.find((x) => x.slot === slot)
      m.visible = !!p
      if (p) m.position.set(p.x, p.y + peg * 1.6, p.z)
    }
    for (const [id, m] of dots.current) {
      const it = f?.items.find((x) => x.id === id)
      m.visible = !!it
      if (!it) continue
      const holder = it.heldBy !== null ? f?.players.find((p) => p.slot === it.heldBy) : undefined
      if (holder) m.position.set(holder.x, holder.y + peg * 4.2, holder.z)
      else m.position.set(it.x, it.y + peg, it.z)
    }
    if (hillMat.current) {
      const hill = f?.hill ?? 0
      hillMat.current.opacity = hill > 0 ? 0.45 : 0
      if (hill > 0) hillMat.current.color.set(teamColor(hill))
    }
  })
  if (!arena || !lobby || !game) return null
  const hillZones = game.template === 'king-of-the-hill' ? game.zones.filter((z) => z.kind === 'goal') : []
  return (
    <group ref={root} position={[lobby.at[0], lobby.at[1] + HOLO_HEIGHT, lobby.at[2]]} visible={false}>
      {/* The projector's glow on the lobby floor */}
      <mesh position={[0, -HOLO_HEIGHT + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={4}>
        <ringGeometry args={[HOLO_SIZE * 0.42, HOLO_SIZE * 0.5, 40]} />
        <meshBasicMaterial color={HOLO} transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} fog={false} />
      </mesh>
      <group scale={scale}>
        <group position={[-arena.at[0], -arena.at[1], -arena.at[2]]}>
          {/* The arena's floor and outline (its height squashed: the miniature is a table, not a tower) */}
          <mesh position={[arena.at[0], arena.at[1], arena.at[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={4}>
            <planeGeometry args={[arena.size[0], arena.size[2]]} />
            <meshBasicMaterial color={HOLO} transparent opacity={0.16} depthWrite={false} side={THREE.DoubleSide} fog={false} />
          </mesh>
          <HoloBox box={{ at: arena.at, size: [arena.size[0], Math.min(arena.size[1], Math.max(arena.size[0], arena.size[2]) * 0.25), arena.size[2]] }} color={HOLO} fill={0} />
          {game.zones.map((z) => (
            <HoloBox
              key={z.id}
              box={{ at: z.at, size: [z.size[0], Math.min(z.size[1], peg * 2), z.size[2]] }}
              color={z.kind === 'keep-out' ? '#ff6b5a' : z.team ? teamColor(z.team) : '#7fe0a0'}
              fill={0.22}
            />
          ))}
          {hillZones.map((z) => (
            <mesh key={z.id} position={[z.at[0], z.at[1] + peg, z.at[2]]} raycast={noRaycast} renderOrder={6}>
              <boxGeometry args={[z.size[0], peg * 2, z.size[2]]} />
              <meshBasicMaterial ref={hillMat} transparent opacity={0} depthWrite={false} fog={false} />
            </mesh>
          ))}
          {slots.map((slot) => (
            <mesh
              key={`${slot}:${roster?.find((x) => x.slot === slot)?.team ?? 0}`}
              visible={false}
              raycast={noRaycast}
              renderOrder={7}
              ref={(m) => {
                if (m) pegs.current.set(slot, m)
                else pegs.current.delete(slot)
              }}
            >
              <capsuleGeometry args={[peg, peg * 1.6, 4, 10]} />
              <meshBasicMaterial color={teamColor(roster?.find((x) => x.slot === slot)?.team)} fog={false} />
            </mesh>
          ))}
          {items.map((info) => (
            <mesh
              key={`${info.id}:${info.kind}:${info.team ?? 0}`}
              visible={false}
              raycast={noRaycast}
              renderOrder={7}
              ref={(m) => {
                if (m) dots.current.set(info.id, m)
                else dots.current.delete(info.id)
              }}
            >
              <octahedronGeometry args={[peg * (info.kind === 'flag' ? 1.1 : 0.75)]} />
              <meshBasicMaterial color={info.kind === 'flag' ? teamColor(info.team) : info.kind === 'piece' ? PIECE : PICKUP} fog={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

/** While you play: which slots an NPC is in right now (the roster, plus swaps since the start). */
function useNpcSlots(roster: readonly MatchSlot[] | null) {
  // `swap` events say who has the slot now: value 1 = an NPC took it over, 0 = the human is back
  const now = useRef(new Map<number, boolean>())
  const seen = useRef<unknown>(null)
  useEffect(() => { now.current.clear() }, [roster])
  return (slot: number) => {
    const snap = useMatchStore.getState().snap
    if (snap && snap !== seen.current) {
      seen.current = snap
      for (const e of snap.events) if (e.type === 'swap' && e.slot !== undefined) now.current.set(e.slot, e.value === 1)
    }
    return now.current.get(slot) ?? roster?.find((r) => r.slot === slot)?.kind === 'npc'
  }
}

export function WatchWorld() {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const worldGame = useWorldStore((s) => s.meta?.game ?? null)
  const matchWorld = useMatchStore((s) => s.worldId)
  const playing = useMatchStore((s) => s.playing)
  const watching = useMatchStore((s) => s.watching)
  const watchRoster = useMatchStore((s) => s.watchRoster)
  const watchGame = useViewStore((s) => s.watchGame)
  const replay = useViewStore((s) => s.replay)
  const isNpc = useNpcSlots(playing?.roster ?? null)
  if (!worldId) return null
  if (replay) {
    // A replay plays where it happened; from another world the strip shows a mini-map instead
    if (replay.record.setup.worldId !== worldId) return null
    const read = () => replayFrameAt(replay, replayClock.t)
    return (
      <>
        <MatchBodies key={replay.id} roster={replay.roster} game={replay.game} read={read} />
        <Hologram key={`h${replay.id}`} roster={replay.roster} game={replay.game} read={read} />
      </>
    )
  }
  if (matchWorld !== worldId) return null
  if (watching) {
    const game = watchGame ?? worldGame
    return (
      <>
        <MatchBodies key={watching} roster={watchRoster} game={game} read={liveFrame} />
        <Hologram key={`h${watching}`} roster={watchRoster} game={game} read={liveFrame} />
      </>
    )
  }
  if (playing) return <MatchBodies key={playing.matchId} roster={playing.roster} game={worldGame} read={liveFrame} only={isNpc} />
  return null
}

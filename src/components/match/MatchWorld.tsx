import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { boundsOf, type Game, type GameBox, type GameLobby } from '@aweborn/shared/game'
import { useMatchGame, useMatchStore } from '../../lib/match'
import { usePlayStore } from '../../lib/matchPlay'
import { useOwnsCurrentWorld } from '../../lib/worldActor'
import { interiorController } from '../../systems/InteriorController'
import { TEAM_COLORS } from '../GameOutlines'
import './MatchWorld.css'

/**
 * What a player sees of the game in the 3D world (Phase 10, play layer).
 *
 * In the lobby, for everyone: the ring glowing on the floor (brighter while you stand
 * in it), a label floating over it, and a soft outline of the lobby. Slice 1 drew
 * outlines for owners only; players need the ring to know where to stand.
 *
 * While playing: the arena's walls fade in as you come near an edge (so the boundary
 * reads without a cage around the whole view), goals and keep-out zones are tinted,
 * and your team's spawn is marked on the floor.
 */

const RING = '#9fe8ff'
const RING_ON = '#b8ffd0'
const ARENA = '#ffd27a'
const GOAL = '#7fe0a0'
const KEEP_OUT = '#ff6b5a'
/** A wall starts to show this far from it (m). */
const WALL_NEAR = 7

const noRaycast = () => null
const teamColor = (team: number) => TEAM_COLORS[(team - 1) % TEAM_COLORS.length]

function Edges({ box, color, opacity = 0.5, fill = 0 }: { box: GameBox; color: string; opacity?: number; fill?: number }) {
  const [w, h, d] = box.size
  const geo = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  useEffect(() => () => { geo.dispose(); edges.dispose() }, [geo, edges])
  return (
    <group position={[box.at[0], box.at[1] + h / 2, box.at[2]]}>
      {fill > 0 && (
        <mesh geometry={geo} raycast={noRaycast} renderOrder={3}>
          <meshBasicMaterial color={color} transparent opacity={fill} depthWrite={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
      )}
      <lineSegments geometry={edges} raycast={noRaycast}>
        <lineBasicMaterial color={color} transparent opacity={opacity} fog={false} />
      </lineSegments>
    </group>
  )
}

function LobbyMarks({ lobby, showBox }: { lobby: GameLobby; showBox: boolean }) {
  const inRing = usePlayStore((s) => s.inRing)
  const state = useMatchStore((s) => s.lobby)
  // The ready check's card sits where this label floats: one thing to read at a time
  const found = useMatchStore((s) => s.found !== null)
  const band = useRef<THREE.MeshBasicMaterial>(null)
  const disc = useRef<THREE.MeshBasicMaterial>(null)
  const { at, radius } = lobby.ring
  const color = inRing ? RING_ON : RING

  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4)
    if (band.current) band.current.opacity = inRing ? 1 : 0.6 + 0.3 * pulse
    if (disc.current) disc.current.opacity = inRing ? 0.3 + 0.12 * pulse : 0.08 + 0.08 * pulse
  })

  let label = 'Stand here to play'
  if (state && !state.ready) label = 'Not open yet'
  else if (state?.queued) label = `In the pool · ${Math.max(1, state.pool)}${state.held ? ' · on hold' : ''}`
  else if (state?.held) label = 'Queue on hold'
  else if (state && state.pool > 0) label = `Stand here to play · ${state.pool} waiting`

  return (
    <group>
      {showBox && <Edges box={lobby} color={RING} opacity={0.22} />}
      <group position={[at[0], at[1] + 0.08, at[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh raycast={noRaycast} renderOrder={4}>
          <circleGeometry args={[Math.max(0.1, radius - 0.2), 48]} />
          <meshBasicMaterial ref={disc} color={color} transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
        <mesh raycast={noRaycast} renderOrder={5}>
          <ringGeometry args={[Math.max(0.1, radius - 0.22), radius, 64]} />
          <meshBasicMaterial ref={band} color={color} transparent opacity={0.8} depthWrite={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
      </group>
      {!found && (
        <Html position={[at[0], at[1] + 2.9, at[2]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`match-ring-label${inRing ? ' is-on' : ''}`}>{label}</div>
        </Html>
      )}
    </group>
  )
}

/** The arena's four walls: each one fades in as the player comes near it. */
function ArenaWalls({ arena, solid }: { arena: GameBox; solid: boolean }) {
  const b = boundsOf(arena)
  const [w, h, d] = arena.size
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const walls = useMemo(() => [
    { pos: [b.minX, b.minY + h / 2, arena.at[2]] as const, rotY: Math.PI / 2, len: d },
    { pos: [b.maxX, b.minY + h / 2, arena.at[2]] as const, rotY: Math.PI / 2, len: d },
    { pos: [arena.at[0], b.minY + h / 2, b.minZ] as const, rotY: 0, len: w },
    { pos: [arena.at[0], b.minY + h / 2, b.maxZ] as const, rotY: 0, len: w },
  ], [b.minX, b.maxX, b.minY, b.minZ, b.maxZ, arena.at, w, h, d])

  useFrame(() => {
    const s = interiorController.state
    const dist = [Math.abs(s.x - b.minX), Math.abs(s.x - b.maxX), Math.abs(s.z - b.minZ), Math.abs(s.z - b.maxZ)]
    for (let i = 0; i < 4; i++) {
      const m = mats.current[i]
      if (!m) continue
      const near = Math.max(0, 1 - dist[i] / WALL_NEAR)
      m.opacity = near * near * (solid ? 0.38 : 0.28)
      m.visible = m.opacity > 0.005
    }
  })

  return (
    <group>
      <Edges box={arena} color={ARENA} opacity={0.3} />
      {walls.map((wall, i) => (
        <mesh key={i} position={wall.pos} rotation={[0, wall.rotY, 0]} raycast={noRaycast} renderOrder={3}>
          <planeGeometry args={[wall.len, h]} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m }} color={ARENA} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
      ))}
    </group>
  )
}

function ArenaMarks({ game, team }: { game: Game; team: number }) {
  return (
    <group>
      {game.arena && <ArenaWalls arena={game.arena} solid={game.settings.edge === 'wall'} />}
      {game.zones.map((z) => {
        if (z.kind === 'keep-out') return <Edges key={z.id} box={z} color={KEEP_OUT} opacity={0.7} fill={0.16} />
        if (z.kind === 'goal') return <Edges key={z.id} box={z} color={z.team ? teamColor(z.team) : GOAL} opacity={0.75} fill={0.13} />
        const mine = z.team === team
        const c = teamColor(z.team ?? 1)
        return (
          <group key={z.id}>
            <Edges box={z} color={c} opacity={mine ? 0.8 : 0.3} />
            {mine && (
              <>
                <mesh position={[z.at[0], z.at[1] + 0.07, z.at[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={4}>
                  <ringGeometry args={[Math.max(0.2, Math.min(z.size[0], z.size[2]) / 2 - 0.35), Math.min(z.size[0], z.size[2]) / 2 - 0.1, 40]} />
                  <meshBasicMaterial color={c} transparent opacity={0.85} depthWrite={false} side={THREE.DoubleSide} fog={false} />
                </mesh>
                <Html position={[z.at[0], z.at[1] + z.size[1] + 0.4, z.at[2]]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
                  <div className="match-ring-label" style={{ borderColor: c, color: c }}>Your spawn</div>
                </Html>
              </>
            )}
          </group>
        )
      })}
    </group>
  )
}

export function MatchWorld() {
  // While playing: the match's own zones (its game as it started); in the lobby: the world's game
  const game = useMatchGame()
  const team = useMatchStore((s) => s.playing?.you.team ?? null)
  const owner = useOwnsCurrentWorld()
  if (!game) return null
  if (team !== null) return <ArenaMarks game={game} team={team} />
  // Owners already see the lobby's box from the Game tab's outlines
  return game.lobby ? <LobbyMarks lobby={game.lobby} showBox={!owner} /> : null
}

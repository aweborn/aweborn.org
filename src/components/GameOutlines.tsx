import { useMatchStore } from '../lib/match'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Game, GameBox, Vec3 } from '@aweborn/shared/game'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useOwnsCurrentWorld } from '../lib/worldActor'
import { useGameDraftStore } from '../lib/game'

/**
 * The game's places drawn in the world, for its creator and builders (Phase 10, slice 1):
 * the arena (the stage), its zones, the lobby, the ring and the arrival point, as
 * see-through boxes with bright edges. Shows the draft being edited in the Game tab,
 * else the saved game. Everyone else sees nothing yet (the lobby's look comes with
 * slices 3 and 4).
 */

const ARENA = '#ffd27a'
const LOBBY = '#9fe8ff'
const GOAL = '#7fe0a0'
const KEEP_OUT = '#ff6b5a'
export const TEAM_COLORS = ['#ff5a5a', '#5aa0ff', '#5ad08a', '#ffc94a', '#b98cff', '#4ad0c8', '#ff9a4a', '#ff8ad0']

/** Never a tap or kick target. */
const noRaycast = () => null

function BoxOutline({ box, color, fill = 0.06 }: { box: GameBox; color: string; fill?: number }) {
  const [w, h, d] = box.size
  const geo = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo])
  useEffect(() => () => { geo.dispose(); edges.dispose() }, [geo, edges])
  return (
    <group position={[box.at[0], box.at[1] + h / 2, box.at[2]]}>
      <mesh geometry={geo} raycast={noRaycast} renderOrder={3}>
        <meshBasicMaterial color={color} transparent opacity={fill} depthWrite={false} side={THREE.DoubleSide} fog={false} />
      </mesh>
      <lineSegments geometry={edges} raycast={noRaycast}>
        <lineBasicMaterial color={color} transparent opacity={0.85} fog={false} />
      </lineSegments>
    </group>
  )
}

function Ring({ at, radius, color }: { at: Vec3; radius: number; color: string }) {
  return (
    <mesh position={[at[0], at[1] + 0.06, at[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={4}>
      <ringGeometry args={[Math.max(0.1, radius - 0.18), radius, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} fog={false} />
    </mesh>
  )
}

/** Where players arrive: a small marker on the lobby floor. */
function Arrival({ at }: { at: Vec3 }) {
  return (
    <mesh position={[at[0], at[1] + 0.07, at[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={4}>
      <circleGeometry args={[0.45, 24]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.75} depthWrite={false} side={THREE.DoubleSide} fog={false} />
    </mesh>
  )
}

export function GameOutlines() {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const owner = useOwnsCurrentWorld()
  const saved = useWorldStore((s) => s.meta?.game ?? null)
  const draftWorld = useGameDraftStore((s) => s.worldId)
  const draft = useGameDraftStore((s) => s.draft)
  // An owner playing a match sees the match's own markings (MatchWorld), not the setup outlines over them
  const playing = useMatchStore((s) => s.playing !== null)
  const game: Game | null = draft && draftWorld === worldId ? draft : saved
  if (!owner || !game || playing) return null
  return (
    <group>
      {game.arena && <BoxOutline box={game.arena} color={ARENA} fill={0.04} />}
      {game.zones.map((z) => (
        <BoxOutline
          key={z.id}
          box={z}
          color={z.kind === 'keep-out' ? KEEP_OUT : z.team ? TEAM_COLORS[(z.team - 1) % TEAM_COLORS.length] : z.kind === 'goal' ? GOAL : TEAM_COLORS[0]}
          fill={z.kind === 'keep-out' ? 0.14 : 0.1}
        />
      ))}
      {game.lobby && (
        <>
          <BoxOutline box={game.lobby} color={LOBBY} />
          <Ring at={game.lobby.ring.at} radius={game.lobby.ring.radius} color={LOBBY} />
          <Arrival at={game.lobby.arrival} />
        </>
      )}
    </group>
  )
}

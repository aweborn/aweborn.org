import { useEffect, useRef } from 'react'
import { boundsOf, type Game } from '@aweborn/shared/game'
import type { MatchSlot } from '@aweborn/shared/match'
import { useUniverseStore } from '../../stores/universeStore'
import { useWorldStore } from '../../stores/worldStore'
import { interiorController } from '../../systems/InteriorController'
import { useMatchStore } from '../../lib/match'
import {
  clockOf, closeReplay, currentView, openReplay, playReplay, replayClock, replayFrameAt, replayScoreAt, seekReplay, tickReplay, tuneOut, useViewStore,
  type Replay, type ViewScore,
} from '../../lib/matchView'
import { teamName } from '../GamePanel'
import { cycleFollow, enterGhost, leaveGhost } from './GhostCamera'
import { Scores, resultText } from './WatchChip'
import { teamColor } from './WatchWorld'
import './Watch.css'

/**
 * What sits on the screen while you watch (Phase 10): a slim strip for the match you are
 * tuned into (score, round, clock, who else is watching, Fly in, Stop), its result when
 * it ends, the replay player (play/pause, scrub bar, speed, event markers), and the
 * ghost camera's two buttons. From another world a replay shows a top-down mini-map
 * instead of bodies in the arena.
 */

const phaseText = (s: ViewScore) => (s.phase === 'countdown' ? `Starts in ${clockOf(s.left)}` : s.phase === 'break' ? 'Break' : s.phase === 'finished' ? 'Finished' : clockOf(s.left))

function ScoreLine({ score, rounds, watching }: { score: ViewScore; rounds: number; watching?: number }) {
  return (
    <div className="watch-line">
      <Scores scores={score.scores} />
      <span className="watch-line-meta">
        {rounds > 1 && <span>Round {score.round}/{rounds}</span>}
        <span className="watch-clock">{phaseText(score)}</span>
        {watching !== undefined && <span>👁 {watching}</span>}
      </span>
    </div>
  )
}

/** Fly in / Follow / Back to my body. */
function GhostButtons({ game, roster, here }: { game: Game | null; roster: readonly MatchSlot[] | null; here: boolean }) {
  const ghost = useViewStore((s) => s.ghost)
  const follow = useViewStore((s) => s.follow)
  if (!here || !game?.arena) return null
  if (!ghost) {
    return (
      <button id="watch-fly" type="button" className="watch-btn" onClick={() => enterGhost(game, interiorController.state)}>
        🎥 Fly in
      </button>
    )
  }
  const slots = () => currentView(game)?.frame()?.players.filter((p) => !p.out).map((p) => p.slot) ?? []
  const name = follow !== null ? (roster?.find((r) => r.slot === follow)?.name ?? `Player ${follow + 1}`) : null
  return (
    <>
      <button id="watch-follow" type="button" className={`watch-btn${name ? ' is-on' : ''}`} onClick={() => cycleFollow(slots())}>
        {name ? `Following ${name} ▸` : 'Follow ▸'}
      </button>
      <button id="watch-body" type="button" className="watch-btn watch-btn--primary" onClick={leaveGhost}>
        Back to my body
      </button>
    </>
  )
}

/** The strip for a running match you are tuned into, and its result when it ends. */
function LiveStrip({ worldId }: { worldId: string }) {
  const watching = useMatchStore((s) => s.watching)
  const snap = useMatchStore((s) => (s.snap && s.snap.matchId === s.watching ? s.snap : null))
  const ended = useMatchStore((s) => (s.ended && !s.ended.you && s.ended.matchId === s.watching ? s.ended : null))
  const roster = useMatchStore((s) => s.watchRoster)
  const worldGame = useWorldStore((s) => s.meta?.game ?? null)
  const watchGame = useViewStore((s) => s.watchGame)
  const ghost = useViewStore((s) => s.ghost)
  const game = watchGame ?? worldGame
  // The result stays up for a while, then the view lets go by itself
  useEffect(() => {
    if (!ended) return
    leaveGhost()
    const t = setTimeout(() => tuneOut(worldId), 25_000)
    return () => clearTimeout(t)
  }, [ended, worldId])
  if (!watching) return null
  if (ended) {
    const r = ended.result
    return (
      <div className="watch-strip" role="status">
        <div className="watch-line">
          <Scores scores={r.rounds.some((n) => n > 0) && (game?.settings.rounds ?? 1) > 1 ? r.rounds : r.scores} winner={r.winner} />
          <span className="watch-result">{resultText(r.winner, r.scores.length)}</span>
        </div>
        <div className="watch-actions">
          <button id="watch-replay" type="button" className="watch-btn watch-btn--primary" onClick={() => void openReplay(ended.matchId, worldId, teamName)}>
            ▶ Watch the replay
          </button>
          <button type="button" className="watch-btn" onClick={() => tuneOut(worldId)}>Close</button>
        </div>
      </div>
    )
  }
  return (
    <div className={`watch-strip${ghost ? ' is-ghost' : ''}`} role="status" aria-label="Watching a match">
      {snap ? (
        <ScoreLine score={{ phase: snap.phase, round: snap.round, left: snap.left, scores: snap.scores, rounds: snap.rounds }} rounds={game?.settings.rounds ?? 1} watching={snap.watching} />
      ) : (
        <div className="watch-line"><span className="watch-line-meta">Tuning in…</span></div>
      )}
      <div className="watch-actions">
        <GhostButtons game={game} roster={roster} here />
        {!ghost && <button id="watch-stop" type="button" className="watch-btn" onClick={() => tuneOut(worldId)}>Stop</button>}
      </div>
    </div>
  )
}

/** A replay from above, for when you are not in the world it was played in: arena, zones, players and items as dots. */
function ReplayMiniMap({ replay }: { replay: Replay }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const arena = replay.game.arena
    if (!canvas || !arena) return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr)
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr)
      const c = canvas.getContext('2d')
      if (!c || w === 0) return
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, w, h)
      const b = boundsOf(arena)
      const k = Math.min((w - 16) / arena.size[0], (h - 16) / arena.size[2])
      const px = (x: number) => w / 2 + (x - arena.at[0]) * k
      const pz = (z: number) => h / 2 + (z - arena.at[2]) * k
      c.fillStyle = 'rgba(159, 232, 255, 0.07)'
      c.strokeStyle = 'rgba(159, 232, 255, 0.8)'
      c.lineWidth = 1.5
      c.fillRect(px(b.minX), pz(b.minZ), arena.size[0] * k, arena.size[2] * k)
      c.strokeRect(px(b.minX), pz(b.minZ), arena.size[0] * k, arena.size[2] * k)
      const f = replayFrameAt(replay, replayClock.t)
      for (const z of replay.game.zones) {
        const zb = boundsOf(z)
        const held = replay.game.template === 'king-of-the-hill' && z.kind === 'goal' && f.hill > 0
        const col = held ? teamColor(f.hill) : z.kind === 'keep-out' ? '#ff6b5a' : z.team ? teamColor(z.team) : '#7fe0a0'
        c.globalAlpha = held ? 0.5 : 0.22
        c.fillStyle = col
        c.fillRect(px(zb.minX), pz(zb.minZ), z.size[0] * k, z.size[2] * k)
        c.globalAlpha = 0.9
        c.strokeStyle = col
        c.lineWidth = 1
        c.strokeRect(px(zb.minX), pz(zb.minZ), z.size[0] * k, z.size[2] * k)
      }
      c.globalAlpha = 1
      for (const it of f.items) {
        const holder = it.heldBy !== null ? f.players.find((p) => p.slot === it.heldBy) : undefined
        const x = px(holder?.x ?? it.x) + (holder ? 6 : 0)
        const y = pz(holder?.z ?? it.z) - (holder ? 6 : 0)
        c.fillStyle = it.kind === 'flag' ? teamColor(it.team) : it.kind === 'piece' ? '#7fd6ff' : '#ffe08a'
        c.strokeStyle = '#0b0b1c'
        c.beginPath()
        c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y)
        c.closePath()
        c.fill()
        c.stroke()
      }
      for (const p of f.players) {
        const slot = replay.roster.find((r) => r.slot === p.slot)
        c.globalAlpha = p.out ? 0.3 : 1
        c.fillStyle = teamColor(slot?.team)
        c.strokeStyle = slot?.kind === 'npc' ? '#ffffff' : '#0b0b1c'
        c.lineWidth = 1.5
        c.beginPath()
        c.arc(px(p.x), pz(p.z), 5.5, 0, Math.PI * 2)
        c.fill()
        c.stroke()
      }
      c.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [replay])
  if (!replay.game.arena) return null
  return <canvas ref={ref} className="watch-map" role="img" aria-label="The arena from above, with the players moving" />
}

function ReplayStrip({ replay, worldId }: { replay: Replay; worldId: string | null }) {
  const tick = useViewStore((s) => s.tick)
  const playing = useViewStore((s) => s.playing)
  const speed = useViewStore((s) => s.speed)
  const ghost = useViewStore((s) => s.ghost)
  const here = replay.record.setup.worldId === worldId
  // The replay's clock runs on animation frames while it is open
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      tickReplay(now - last)
      last = now
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [replay])
  const score = replayScoreAt(replay, tick)
  const result = replay.record.result
  const done = tick >= replay.last
  return (
    <div className={`watch-strip watch-strip--replay${ghost ? ' is-ghost' : ''}`} role="group" aria-label="Replay">
      <div className="watch-line">
        <span className="watch-badge">Replay</span>
        <Scores scores={score.scores} winner={done ? result?.winner : undefined} />
        <span className="watch-line-meta">
          {replay.game.settings.rounds > 1 && <span>Round {score.round}/{replay.game.settings.rounds}</span>}
          <span className="watch-clock">{done && result ? resultText(result.winner, score.scores.length) : phaseText(score)}</span>
        </span>
        {!ghost && <button id="watch-replay-close" type="button" className="watch-btn watch-x" onClick={closeReplay} aria-label="Close the replay">✕</button>}
      </div>
      {!here && (
        <>
          <ReplayMiniMap replay={replay} />
          <p className="watch-note">Played in another world: this is its arena from above. Go there to watch it in the arena itself.</p>
        </>
      )}
      <div className="watch-scrub">
        <button id="watch-play" type="button" className="watch-btn watch-play" onClick={() => playReplay(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="watch-bar">
          <div className="watch-marks" aria-hidden="true">
            {replay.marks.map((m, i) => (
              <span key={i} className="watch-mark" style={{ left: `${(m.tick / replay.last) * 100}%`, background: m.team ? teamColor(m.team) : undefined }} />
            ))}
          </div>
          <input
            id="watch-seek"
            type="range"
            className="watch-range"
            min={0}
            max={replay.last}
            step={1}
            value={Math.min(tick, replay.last)}
            onChange={(e) => seekReplay(Number(e.target.value))}
            aria-label="Replay position"
            aria-valuetext={`${clockOf(tick)} of ${clockOf(replay.last)}`}
          />
        </div>
        <span className="watch-time">{clockOf(tick)}<span> / {clockOf(replay.last)}</span></span>
        <button id="watch-speed" type="button" className="watch-btn watch-speed" onClick={() => useViewStore.setState({ speed: speed === 1 ? 2 : speed === 2 ? 4 : 1 })} aria-label={`Speed ${speed}×`}>
          {speed}×
        </button>
      </div>
      {!ghost && replay.marks.length > 0 && (
        <ul className="watch-events" aria-label="Moments">
          {replay.marks.map((m, i) => (
            <li key={i}>
              <button type="button" className={`watch-event${m.tick <= tick ? ' is-past' : ''}`} onClick={() => seekReplay(Math.max(0, m.tick - 20))} style={m.team ? { borderColor: teamColor(m.team) } : undefined}>
                <span className="watch-event-time">{clockOf(m.tick)}</span> <span aria-hidden="true">{m.icon}</span> {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {here && (
        <div className="watch-actions">
          <GhostButtons game={replay.game} roster={replay.roster} here={here} />
        </div>
      )}
    </div>
  )
}

export function WatchLayer() {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const playing = useMatchStore((s) => s.playing !== null)
  const watchWorld = useMatchStore((s) => s.worldId)
  const replay = useViewStore((s) => s.replay)
  const sheet = useViewStore((s) => s.sheet)
  // The ghost camera belongs to the world it was started in
  useEffect(() => leaveGhost, [worldId])
  if (playing) return null
  // On a phone the sheet takes the strip's place while it is open
  if (replay) return <div className={sheet ? 'watch-under-sheet' : undefined}><ReplayStrip replay={replay} worldId={worldId} /></div>
  if (!worldId || watchWorld !== worldId) return null
  return <div className={sheet ? 'watch-under-sheet' : undefined}><LiveStrip worldId={worldId} /></div>
}

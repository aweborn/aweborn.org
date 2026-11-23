import { useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { Game } from '@aweborn/shared/game'
import type { MatchSlot } from '@aweborn/shared/match'
import { useUniverseStore } from '../../stores/universeStore'
import { useWorldStore } from '../../stores/worldStore'
import { useNameStore, displayName } from '../../stores/nameStore'
import { getPlayerSnapshot, subscribePlayer } from '../../lib/player'
import { sendMatch, useMatchStore, type Found } from '../../lib/match'
import { answerAgain, useMatchPlay, usePlayStore } from '../../lib/matchPlay'
import { teamName } from '../GamePanel'
import { LevelStepper } from './LobbyChip'
import { MatchHud, teamColor, useNow } from './MatchHud'
import './MatchPlay.css'

/**
 * The play layer's overlays (Phase 10): the ready check when a match is found, the
 * HUD while playing, and the results. Also where the session glue runs
 * (`useMatchPlay`): this component is mounted exactly while the player is in a world
 * that has a game.
 */

const teamVar = (team: number) => ({ '--team': teamColor(team) }) as CSSProperties

/** The roster grouped by team, each slot one line (NPCs marked AI). */
function Roster({ roster, teams, me, scores }: { roster: MatchSlot[]; teams: number; me: number; scores?: Map<number, { score: number; left: boolean }> }) {
  const byTeam = Array.from({ length: Math.max(teams, ...roster.map((s) => s.team)) }, (_, i) => roster.filter((s) => s.team === i + 1))
  return (
    <div className={`match-roster${byTeam.length === 1 ? ' match-roster--one' : ''}`}>
      {byTeam.map((slots, i) => (
        <div key={i} className="match-team" style={teamVar(i + 1)}>
          {byTeam.length > 1 && <p className="match-team-name">{teamName(i + 1)}</p>}
          <ul className="match-team-list">
            {slots.map((s) => {
              const r = scores?.get(s.slot)
              return (
                <li key={s.slot} className={`match-slot${s.slot === me ? ' is-me' : ''}${r?.left ? ' is-left' : ''}`}>
                  <span className="match-slot-name">{s.name || 'Player'}</span>
                  {s.slot === me && <span className="match-slot-you">(you)</span>}
                  {s.kind === 'npc' && <span className="match-slot-tag">AI</span>}
                  {r?.left && <span className="match-slot-tag">left</span>}
                  {r && <span className="match-slot-score">{r.score}</span>}
                </li>
              )
            })}
            {slots.length === 0 && <li className="match-slot match-slot--empty">open</li>}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ReadyCheck({ found, game, worldId }: { found: Found & { at: number }; game: Game; worldId: string }) {
  const now = useNow(200)
  const names = useNameStore((s) => s.names)
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  const [level, setLevel] = useState(3)
  const [voted, setVoted] = useState<string | null>(null)
  const left = Math.max(0, found.readyMs - (now - found.at))
  const empty = Math.max(0, game.settings.players.max - found.roster.length)
  const myIds = player ? [player.playerId, ...(player.characters ?? [])] : []
  const proposal = found.npc
  const mine = proposal ? myIds.includes(proposal.by) : false
  const voteKey = proposal ? `${found.matchId}:${proposal.by}:${proposal.level}` : null
  const teams = game.settings.teams

  return (
    <section id="match-ready" className="match-card match-ready" role="dialog" aria-labelledby="match-ready-title" style={teamVar(found.you.team)}>
      <div className="match-ready-head">
        <div>
          <h2 id="match-ready-title" className="match-card-title">Match found</h2>
          <p className="match-ready-team">{teams > 1 ? <>You are on <strong>{teamName(found.you.team)}</strong></> : 'Everyone plays together'}</p>
        </div>
        <span className="match-ready-secs" role="timer" aria-label={`Starts in ${Math.ceil(left / 1000)} seconds`}>{Math.ceil(left / 1000)}</span>
      </div>
      <div className="match-ready-bar" aria-hidden="true"><span style={{ width: `${(left / Math.max(1, found.readyMs)) * 100}%` }} /></div>
      <p className="match-ready-hint">Starting soon. Step out of the ring to decline.</p>
      <Roster roster={found.roster} teams={teams} me={found.you.slot} />
      {game.npc.fill && game.npcRoster.length > 0 && (proposal || empty > 0) && (
        <div className="match-npc">
          {proposal ? (
            <>
              <p className="match-npc-text">
                {mine ? 'You asked' : <><strong>{displayName(proposal.by, names)}</strong> asks</>}: fill the empty slots with level {proposal.level} NPCs? <span className="match-npc-votes">{proposal.votes} of {proposal.needed} agree</span>
              </p>
              {!mine && voted !== voteKey && (
                <div className="lobby-row">
                  <button id="match-npc-yes" type="button" className="lobby-btn lobby-btn--primary" onClick={() => { setVoted(voteKey); sendMatch(worldId, { t: 'npc-vote', yes: true }) }}>Yes</button>
                  <button id="match-npc-no" type="button" className="lobby-btn" onClick={() => { setVoted(voteKey); sendMatch(worldId, { t: 'npc-vote', yes: false }) }}>No</button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="match-npc-text">{empty === 1 ? 'One slot is empty.' : `${empty} slots are empty.`} Fill {empty === 1 ? 'it' : 'them'} with NPCs? Everyone must agree.</p>
              <div className="lobby-row">
                <LevelStepper id="match-npc-level" value={level} onChange={setLevel} />
                <button id="match-npc-propose" type="button" className="lobby-btn lobby-btn--primary" onClick={() => sendMatch(worldId, { t: 'npc-propose', level })}>Ask everyone</button>
              </div>
            </>
          )}
        </div>
      )}
      <p className="match-ready-note">Matches are recorded and can be replayed.</p>
    </section>
  )
}

function Results({ game }: { game: Game | null }) {
  const ended = useMatchStore((s) => s.ended)
  const again = usePlayStore((s) => s.again)
  if (!ended?.you) return null
  const { result, roster, you } = ended
  const teams = Math.max(game?.settings.teams ?? 1, result.scores.length)
  const coop = teams === 1
  const scores = new Map(result.players.map((p) => [p.slot, { score: p.score, left: p.left }]))
  const title = coop ? 'Match over' : result.winner > 0 ? `${teamName(result.winner)} wins` : 'A draw'
  const sub = coop ? null : result.winner === 0 ? 'Nobody takes it this time.' : result.winner === you.team ? 'That is your team. Well played!' : 'Good game.'
  const line = (v: number[]) => Array.from({ length: teams }, (_, i) => v[i] ?? 0)
  const manyRounds = result.rounds.reduce((a, b) => a + b, 0) > 1 || (game?.settings.rounds ?? 1) > 1

  return (
    <div className="match-results-wrap">
      <section id="match-results" className="match-card match-results" role="dialog" aria-labelledby="match-results-title" style={result.winner > 0 && !coop ? teamVar(result.winner) : undefined}>
        <h2 id="match-results-title" className={`match-card-title match-results-title${result.winner > 0 && !coop ? ' is-team' : ''}`}>{title}</h2>
        {sub && <p className="match-results-sub">{sub}</p>}
        <div className="match-tally">
          {manyRounds && !coop && (
            <p className="match-tally-row"><span className="match-tally-label">Rounds</span>
              {line(result.rounds).map((v, i) => <span key={i} className="match-tally-num" style={teamVar(i + 1)}>{v}</span>)}
            </p>
          )}
          <p className="match-tally-row"><span className="match-tally-label">{manyRounds && !coop ? 'Last round' : 'Score'}</span>
            {line(result.scores).map((v, i) => <span key={i} className="match-tally-num" style={teamVar(i + 1)}>{v}</span>)}
          </p>
        </div>
        <Roster roster={roster} teams={teams} me={you.slot} scores={scores} />
        {ended.awe > 0 && <p id="match-awe" className="match-awe">+{ended.awe} awe</p>}
        <div className="match-results-btns">
          {again === true ? (
            <p className="match-results-wait" role="status">Waiting for your team…</p>
          ) : ended.again ? (
            <button id="match-again" type="button" className="lobby-cta" disabled={again !== null} onClick={() => answerAgain(true)}>Play again together</button>
          ) : null}
          <button id="match-back" type="button" className="lobby-btn match-results-back" disabled={again === false} onClick={() => answerAgain(false)}>Back to the lobby</button>
        </div>
      </section>
    </div>
  )
}

function Toasts() {
  const toasts = usePlayStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="match-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="match-toast" style={t.team ? teamVar(t.team) : undefined}>{t.text}</div>
      ))}
    </div>
  )
}

export function MatchLayer() {
  useMatchPlay()
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const game = useWorldStore((s) => s.meta?.game ?? null)
  const found = useMatchStore((s) => s.found)
  const playing = useMatchStore((s) => Boolean(s.playing))
  const over = useMatchStore((s) => Boolean(s.ended?.you))
  return (
    <>
      {found && !playing && game && worldId && <ReadyCheck found={found} game={game} worldId={worldId} />}
      {playing && !over && <MatchHud />}
      {!over && <Toasts />}
      {over && <Results game={game} />}
    </>
  )
}

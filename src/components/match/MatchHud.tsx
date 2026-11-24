import { useEffect, useState, type CSSProperties } from 'react'
import type { Game } from '@aweborn/shared/game'
import { MATCH_TICK_MS } from '@aweborn/shared/match'
import { sendMatch, useMatchGame, useMatchStore, type Snap } from '../../lib/match'
import { usePlayStore } from '../../lib/matchPlay'
import { teamName } from '../GamePanel'
import { TEAM_COLORS } from '../GameOutlines'
import './MatchPlay.css'

/**
 * The match HUD (Phase 10, play layer): what a player needs while playing and nothing
 * more. `MatchStrip` is the score / round / clock strip; it sits in the game layer's
 * chip row (LobbyChip renders it while playing), so it shares that row with the watch
 * chip instead of covering it. `MatchHud` is the rest: phase banners, the
 * out-of-bounds warning, what you carry. All of it stays in the top half of a phone
 * screen, clear of the sticks and the action buttons.
 */

export const teamColor = (team: number) => TEAM_COLORS[(team - 1) % TEAM_COLORS.length]

/** A clock that re-renders its caller every `ms` (performance.now()). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** m:ss */
export const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`

/** Seconds left in the snapshot's phase, counted down between snapshots. */
function secondsLeft(snap: Snap, snapAt: number, now: number): number {
  // Don't run past the next snapshot by more than a second (a stalled connection shouldn't empty the clock)
  const since = Math.min(1000, Math.max(0, now - snapAt))
  return Math.max(0, (snap.left * MATCH_TICK_MS - since) / 1000)
}

export function MatchStrip() {
  const playing = useMatchStore((s) => s.playing)
  const snap = useMatchStore((s) => s.snap)
  const snapAt = useMatchStore((s) => s.snapAt)
  const worldId = useMatchStore((s) => s.worldId)
  const over = useMatchStore((s) => Boolean(s.ended))
  const game = useMatchGame()
  const now = useNow(250)
  const [sure, setSure] = useState(false)
  useEffect(() => {
    if (!sure) return
    const t = setTimeout(() => setSure(false), 5000)
    return () => clearTimeout(t)
  }, [sure])
  if (!playing) return null

  const teams = Math.max(game?.settings.teams ?? 1, snap?.scores.length ?? 1)
  const rounds = game?.settings.rounds ?? 1
  const scores = Array.from({ length: teams }, (_, i) => snap?.scores[i] ?? 0)
  const left = snap ? secondsLeft(snap, snapAt, now) : null
  const time = !snap ? '–:––' : snap.phase === 'playing' ? clock(Math.ceil(left ?? 0)) : snap.phase === 'finished' ? 'End' : '·:··'

  return (
    <div id="match-strip" className="match-strip" role="status" aria-label="Match score">
      <div className={`match-strip-scores${teams > 4 ? ' is-many' : ''}`}>
        {scores.map((score, i) => {
          const team = i + 1
          const mine = team === playing.you.team
          const won = snap?.rounds[i] ?? 0
          return (
            <span key={team} className={`match-score${mine ? ' is-mine' : ''}`} style={{ '--team': teamColor(team) } as CSSProperties} aria-label={`${teams === 1 ? 'Score' : teamName(team)} ${score}${mine && teams > 1 ? ' (your team)' : ''}`}>
              {teams > 1 && teams <= 4 && <span className="match-score-name">{teams > 2 ? teamName(team).slice(0, 1) : teamName(team)}</span>}
              <span className="match-score-value">{score}</span>
              {rounds > 1 && won > 0 && <span className="match-score-rounds" aria-label={`${won} rounds won`}>{'●'.repeat(Math.min(won, 9))}</span>}
            </span>
          )
        })}
      </div>
      <div className="match-strip-clock">
        <span className="match-strip-time">{time}</span>
        {rounds > 1 && <span className="match-strip-round">Round {snap?.round ?? 1} of {rounds}</span>}
      </div>
      {!over && (
        <button
          id="match-leave"
          type="button"
          className={`match-leave${sure ? ' is-sure' : ''}`}
          onClick={() => {
            if (!sure) return setSure(true)
            setSure(false)
            if (worldId) sendMatch(worldId, { t: 'leave' })
          }}
          aria-label={sure ? 'Tap again to leave the match' : 'Leave the match'}
        >
          {sure ? 'Leave?' : 'Leave'}
        </button>
      )}
    </div>
  )
}

function Banner({ snap, snapAt, now, game }: { snap: Snap; snapAt: number; now: number; game: Game | null }) {
  const left = secondsLeft(snap, snapAt, now)
  if (snap.phase === 'countdown') {
    return (
      <div className="match-banner" role="status">
        <span className="match-banner-small">Round {snap.round}</span>
        <span className="match-banner-big">{Math.max(1, Math.ceil(left))}</span>
      </div>
    )
  }
  if (snap.phase === 'break') {
    const more = snap.round < (game?.settings.rounds ?? 1)
    return (
      <div className="match-banner" role="status">
        <span className="match-banner-mid">Round over</span>
        {more && <span className="match-banner-small">Next round in {Math.max(1, Math.ceil(left))}</span>}
      </div>
    )
  }
  return null
}

export function MatchHud() {
  const playing = useMatchStore((s) => s.playing)
  const snap = useMatchStore((s) => s.snap)
  const snapAt = useMatchStore((s) => s.snapAt)
  const game = useMatchGame()
  const oob = usePlayStore((s) => s.oob)
  const now = useNow(200)
  if (!playing) return null
  if (!snap) return <div className="match-banner" role="status"><span className="match-banner-mid">Get ready…</span></div>

  const me = snap.players.find((p) => p.slot === playing.you.slot)
  const limit = game?.settings.edgeSeconds ?? 10
  // The referee's own count when it sends one (ticks spent outside), else what the game's boxes say
  let warn: { title: string; secs: number } | null = null
  if (snap.phase === 'playing' && !me?.out) {
    const title = oob?.kind === 'keep-out' ? 'Keep out' : 'Out of bounds'
    if (me?.outside && me.outside > 0) warn = { title, secs: limit - (me.outside * MATCH_TICK_MS + Math.min(1000, now - snapAt)) / 1000 }
    else if (oob) warn = { title, secs: limit - (now - oob.since) / 1000 }
  }
  const held = me?.carrying ? snap.items.find((i) => i.id === me.carrying) : null
  const carrying = !me?.carrying ? null : held?.kind === 'flag' ? `🚩 You have the ${held.team ? `${teamName(held.team)} ` : ''}flag` : held?.kind === 'piece' ? '🧩 Carrying a piece' : '✋ Carrying'

  return (
    <>
      <Banner snap={snap} snapAt={snapAt} now={now} game={game} />
      {(carrying || me?.out) && snap.phase === 'playing' && (
        <div className="match-carry" role="status" style={held?.team ? ({ '--team': teamColor(held.team) } as CSSProperties) : undefined}>
          {me?.out ? 'You are out this round' : carrying}
        </div>
      )}
      {warn && (
        <div id="match-warning" className="match-warning" role="alert">
          <span className="match-warning-title">{warn.title}</span>
          <span className="match-warning-secs">{Math.max(0, Math.ceil(warn.secs))}</span>
          <span className="match-warning-sub">Get back or you return to your spawn</span>
        </div>
      )}
    </>
  )
}

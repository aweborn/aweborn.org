import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TEMPLATE_DEFAULTS, type GameTemplate } from '@aweborn/shared/game'
import type { LobbyMatchRow, MatchSummary } from '@aweborn/shared/match-protocol'
import { useUniverseStore } from '../../stores/universeStore'
import { useSheetStore } from '../../stores/sheetStore'
import { sendMatch, useMatchStore } from '../../lib/match'
import { agoOf, closeReplay, loadWatchLists, openReplay, tuneIn, tuneOut, useViewStore, type WatchTab } from '../../lib/matchView'
import { teamName } from '../GamePanel'
import { teamColor } from './WatchWorld'
import './Watch.css'

/**
 * The 👁 chip and its sheet (Phase 10, spectating and replays): the world's running
 * matches to tune into, the ones that just finished, and your own characters' replays.
 * Hidden while you are playing a match yourself.
 */

/** Scores as numbers in their team's colour: "3 – 1". */
export function Scores({ scores, winner }: { scores: readonly number[]; winner?: number | null }) {
  return (
    <span className="watch-scores" aria-label={scores.map((v, i) => `${teamName(i + 1)} ${v}`).join(', ')}>
      {scores.map((v, i) => (
        <span key={i} className={`watch-score${winner === i + 1 ? ' is-winner' : ''}`} style={{ color: teamColor(i + 1) }}>
          {i > 0 && <span className="watch-score-sep">–</span>}
          {v}
        </span>
      ))}
    </span>
  )
}

/** "Red won", "Draw", or just "Finished" for a game with one side. */
export function resultText(winner: number | null | undefined, teams: number): string {
  if (winner === null || winner === undefined) return 'Ended'
  if (teams <= 1) return 'Finished'
  return winner === 0 ? 'Draw' : `${teamName(winner)} won`
}

const TABS: { id: WatchTab; label: string }[] = [{ id: 'live', label: 'Live' }, { id: 'finished', label: 'Finished' }, { id: 'mine', label: 'Mine' }]

function LiveRow({ m, on, worldId }: { m: LobbyMatchRow; on: boolean; worldId: string }) {
  return (
    <li>
      <button
        type="button"
        className={`watch-row${on ? ' is-on' : ''}`}
        aria-pressed={on}
        onClick={() => (on ? tuneOut(worldId) : (tuneIn(worldId, m.id), useViewStore.setState({ sheet: false })))}
      >
        <span className="watch-row-main">
          <Scores scores={m.scores} />
          <span className="watch-row-title">{m.phase === 'countdown' ? 'Starting' : m.phase === 'break' ? `Round ${m.round} over` : `Round ${m.round}`}</span>
        </span>
        <span className="watch-row-meta">
          <span>{m.players} {m.players === 1 ? 'player' : 'players'}</span>
          <span>👁 {m.watching} watching</span>
          {on && <span className="watch-row-on">Watching: tap to stop</span>}
        </span>
      </button>
    </li>
  )
}

interface FinishedRow { id: string; endedAt: number; winner: number | null; scores: number[]; names: string | null }

function ReplayRow({ id, title, sub, scores, winner, result, worldId }: { id: string; title: string; sub: string; scores: number[]; winner: number | null; result: string; worldId: string | null }) {
  const loading = useViewStore((s) => s.loading === id)
  return (
    <li>
      <button type="button" className="watch-row" disabled={loading} onClick={() => void openReplay(id, worldId, teamName)}>
        <span className="watch-row-main">
          <Scores scores={scores} winner={winner} />
          <span className="watch-row-title">{title}</span>
          <span className="watch-row-play" aria-hidden="true">{loading ? '…' : '▶'}</span>
        </span>
        <span className="watch-row-meta">
          <span>{result}</span>
          <span>{sub}</span>
        </span>
      </button>
    </li>
  )
}

function WatchSheet({ worldId }: { worldId: string }) {
  const tab = useViewStore((s) => s.tab)
  const lobby = useMatchStore((s) => s.lobby)
  const watching = useMatchStore((s) => s.watching)
  const finishedApi = useViewStore((s) => (s.finishedFor === worldId ? s.finished : null))
  const mine = useViewStore((s) => s.mine)
  const error = useViewStore((s) => s.replayError ?? s.listError)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    loadWatchLists(worldId)
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [worldId, tab])
  const live = (lobby?.matches ?? []).filter((m) => !m.endedAt)
  // Just-finished matches arrive with the lobby; older ones come from the server's list
  const finished: FinishedRow[] = (lobby?.matches ?? []).filter((m) => m.endedAt).map((m) => ({ id: m.id, endedAt: m.endedAt ?? 0, winner: m.winner ?? null, scores: m.scores, names: null }))
  for (const m of finishedApi ?? []) {
    const names = m.roster.map((r) => r.name).join(', ')
    const have = finished.find((f) => f.id === m.id)
    if (have) have.names = names
    else if (m.endedAt) finished.push({ id: m.id, endedAt: m.endedAt, winner: m.winner, scores: m.scores, names })
  }
  finished.sort((a, b) => b.endedAt - a.endedAt)
  const close = () => useViewStore.setState({ sheet: false, replayError: null })
  return createPortal(
    <section className="planner watch-sheet" role="dialog" aria-label="Watch matches">
      <header className="planner-head">
        <h2 className="planner-title">👁 Watch</h2>
        <button type="button" className="planner-close watch-close" onClick={close} aria-label="Close">✕</button>
      </header>
      <div className="watch-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} id={`watch-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} className={`watch-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => useViewStore.setState({ tab: t.id, replayError: null })}>
            {t.label}
            {t.id === 'live' && live.length > 0 && <span className="watch-tab-count">{live.length}</span>}
          </button>
        ))}
      </div>
      {error && <p className="watch-error" role="alert">{error}</p>}
      <div className="watch-body">
        {tab === 'live' && (
          live.length === 0 ? (
            <p className="watch-empty">No match is running right now. When one starts it shows up here, and you can watch it from the lobby.</p>
          ) : (
            <>
              <ul className="watch-list">{live.map((m) => <LiveRow key={m.id} m={m} on={watching === m.id} worldId={worldId} />)}</ul>
              {watching && <button type="button" className="watch-btn watch-btn--wide" onClick={() => tuneOut(worldId)}>Stop watching</button>}
            </>
          )
        )}
        {tab === 'finished' && (
          finished.length === 0 ? (
            <p className="watch-empty">{finishedApi === null ? 'Loading…' : 'No finished matches here yet. Every match is recorded: they appear here as replays.'}</p>
          ) : (
            <ul className="watch-list">
              {finished.map((m) => (
                <ReplayRow key={m.id} id={m.id} worldId={worldId} scores={m.scores} winner={m.winner} title={resultText(m.winner, m.scores.length)} result={`finished ${agoOf(m.endedAt, now)}`} sub={m.names ?? ''} />
              ))}
            </ul>
          )
        )}
        {tab === 'mine' && (
          !mine || mine.length === 0 ? (
            <p className="watch-empty">{mine === null ? 'Loading…' : 'Your characters’ replays collect here: every match you play is kept, and it is yours to watch again.'}</p>
          ) : (
            <ul className="watch-list">{mine.map((m) => <MineRow key={m.id} m={m} worldId={worldId} now={now} />)}</ul>
          )
        )}
      </div>
    </section>,
    document.body,
  )
}

function MineRow({ m, worldId, now }: { m: MatchSummary; worldId: string; now: number }) {
  const you = m.roster.find((r) => r.you)
  const teams = m.scores.length
  const result = m.winner === null ? 'Ended early' : teams <= 1 ? 'Finished' : m.winner === 0 ? 'Draw' : you ? (you.team === m.winner ? 'Won' : 'Lost') : resultText(m.winner, teams)
  const game = TEMPLATE_DEFAULTS[m.template as GameTemplate]?.label ?? 'Game'
  return <ReplayRow id={m.id} worldId={worldId} scores={m.scores} winner={m.winner} title={m.worldName || 'A world'} result={`${result} · ${game}`} sub={agoOf(m.endedAt ?? m.startedAt, now)} />
}

export function WatchChip() {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const playing = useMatchStore((s) => s.playing !== null)
  const liveCount = useMatchStore((s) => (s.worldId === worldId ? (s.lobby?.matches.filter((m) => !m.endedAt).length ?? 0) : 0))
  const tuned = useMatchStore((s) => s.watching !== null)
  const replaying = useViewStore((s) => s.replay !== null)
  const open = useViewStore((s) => s.sheet)
  // One sheet at a time: ours closes when a Make sheet opens, and theirs when ours does
  useEffect(() => useSheetStore.subscribe((s) => { if (s.sheet && useViewStore.getState().sheet) useViewStore.setState({ sheet: false }) }), [])
  useEffect(() => {
    if (playing) {
      useViewStore.setState({ sheet: false })
      closeReplay()
    }
  }, [playing])
  // The lobby normally arrives because the play layer says hello on entering; if nothing has come, ask once ourselves
  useEffect(() => {
    if (!worldId) return
    const t = setTimeout(() => {
      const m = useMatchStore.getState()
      if (!(m.worldId === worldId && m.lobby) && !m.playing) sendMatch(worldId, { t: 'hello' })
    }, 3000)
    return () => clearTimeout(t)
  }, [worldId])
  if (!worldId || playing) return null
  const toggle = () => {
    if (!open) useSheetStore.getState().close()
    useViewStore.setState({ sheet: !open, replayError: null })
  }
  return (
    <>
      <button id="watch-chip" type="button" className={`watch-chip${tuned || replaying ? ' is-on' : ''}`} aria-expanded={open} aria-label={`Watch: ${liveCount} ${liveCount === 1 ? 'match' : 'matches'} running`} onClick={toggle}>
        <span aria-hidden="true">👁</span>
        <span className="watch-chip-count">{liveCount}</span>
      </button>
      {open && <WatchSheet worldId={worldId} />}
    </>
  )
}

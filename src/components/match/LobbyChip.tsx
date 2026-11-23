import { useEffect, useRef, useState } from 'react'
import { GAME_LIMITS, TEMPLATE_DEFAULTS, gameMissing, type Game } from '@aweborn/shared/game'
import { useUniverseStore } from '../../stores/universeStore'
import { useWorldStore } from '../../stores/worldStore'
import { useNameStore, displayName } from '../../stores/nameStore'
import { sendMatch, useMatchStore } from '../../lib/match'
import { usePlayStore } from '../../lib/matchPlay'
import { useOwnsCurrentWorld } from '../../lib/worldActor'
import { MatchStrip, clock } from './MatchHud'
import './MatchPlay.css'

/**
 * The lobby at a glance (Phase 10, play layer): one chip in the game layer's row that
 * says what the pool is doing, and a small sheet behind it with what the game is, how
 * to join (stand in the ring), who is waiting, links between players, "play now with
 * NPCs", rejoining a match that is still running, and the hosts' controls.
 *
 * While the player is in a match the chip's place in the row is taken by the score
 * strip (MatchStrip), so the row never holds both.
 */

/** A level picker 1..5 (how sharp the NPCs play). */
export function LevelStepper({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  const [lo, hi] = GAME_LIMITS.npcLevel
  return (
    <span className="lobby-stepper" role="group" aria-label="NPC level">
      <button id={`${id}-less`} type="button" className="lobby-step" disabled={value <= lo} onClick={() => onChange(value - 1)} aria-label="Easier NPCs">−</button>
      <output className="lobby-step-value" aria-live="polite">Level {value}</output>
      <button id={`${id}-more`} type="button" className="lobby-step" disabled={value >= hi} onClick={() => onChange(value + 1)} aria-label="Sharper NPCs">+</button>
    </span>
  )
}

export function gameFacts(g: Game): string {
  const s = g.settings
  const players = s.players.min === s.players.max ? `${s.players.max} players` : `${s.players.min}–${s.players.max} players`
  const teams = s.teams === 1 ? 'one team' : `${s.teams} teams`
  const rounds = s.rounds === 1 ? `one ${clock(s.roundSeconds)} round` : `${s.rounds} rounds of ${clock(s.roundSeconds)}`
  return `${players} · ${teams} · ${rounds}`
}

function LobbySheet({ game, worldId, onClose }: { game: Game; worldId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const lobby = useMatchStore((s) => s.lobby)
  const error = useMatchStore((s) => s.error)
  const alone = usePlayStore((s) => s.alone)
  const inRing = usePlayStore((s) => s.inRing)
  const names = useNameStore((s) => s.names)
  const owner = useOwnsCurrentWorld()
  const [level, setLevel] = useState(3)
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const t = TEMPLATE_DEFAULTS[game.template]
  const npcs = game.npc.fill && game.npcRoster.length > 0
  const missing = gameMissing(game)
  const ready = lobby ? lobby.ready : missing.length === 0
  const running = lobby?.matches.filter((m) => m.endedAt === undefined).length ?? 0
  const who = (id: string, name: string) => name || displayName(id, names)

  let status = 'Nobody is waiting yet.'
  if (!ready) status = owner ? 'The game is not ready yet.' : 'The creators are still setting this game up.'
  else if (lobby?.queued) status = lobby.pool > 1 ? `You and ${lobby.pool - 1} more are in the pool.` : 'You are in the pool. Waiting for more players…'
  else if (lobby && lobby.pool > 0) status = `${lobby.pool} waiting in the pool.`
  if (ready && lobby?.held) status += ' The hosts are holding the queue.'

  return (
    <dialog
      ref={ref}
      id="lobby-sheet"
      className="lobby-sheet"
      aria-labelledby="lobby-sheet-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="lobby-panel">
        <div className="lobby-head">
          <div>
            <p className="lobby-eyebrow">This world's game</p>
            <h2 id="lobby-sheet-title" className="lobby-title">🎯 {t.label}</h2>
          </div>
          <button id="lobby-close" type="button" className="lobby-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="lobby-body">{t.blurb}</p>
        <p className="lobby-facts">{gameFacts(game)}</p>

        <div className="lobby-block">
          <p className="lobby-how">
            <strong>To play:</strong> stand in the glowing ring. You are matched when enough players are waiting; step out to leave the pool.
          </p>
          <p id="lobby-status" className={`lobby-status${lobby?.queued ? ' is-on' : ''}`} role="status">{status}</p>
          {running > 0 && <p className="lobby-note">{running === 1 ? 'One match is' : `${running} matches are`} being played right now.</p>}
          {!ready && owner && (
            <ul className="lobby-missing">
              {missing.map((m) => <li key={m}>{m}</li>)}
              {missing.length === 0 && <li>Save the game again from Make → Game.</li>}
            </ul>
          )}
        </div>

        {lobby?.rejoin && (
          <button id="lobby-rejoin" type="button" className="lobby-cta" onClick={() => { sendMatch(worldId, { t: 'rejoin', matchId: lobby.rejoin as string }); onClose() }}>
            ↩ Rejoin your match
          </button>
        )}

        {ready && npcs && lobby?.queued && alone && (
          <div className="lobby-block lobby-block--npc">
            <p className="lobby-how"><strong>Nobody else here?</strong> Start now with NPC players in the other slots.</p>
            <div className="lobby-row">
              <LevelStepper id="lobby-npc-level" value={level} onChange={setLevel} />
              <button id="lobby-play-now" type="button" className="lobby-btn lobby-btn--primary" disabled={asked} onClick={() => { setAsked(true); sendMatch(worldId, { t: 'play-now', level }); setTimeout(() => setAsked(false), 4000) }}>
                Play now with NPCs
              </button>
            </div>
          </div>
        )}
        {ready && npcs && !(lobby?.queued && alone) && !inRing && (
          <p className="lobby-note">Alone? Stand in the ring for a moment and you can start with NPC players.</p>
        )}

        {lobby && lobby.asks.length > 0 && (
          <div className="lobby-block">
            <p className="lobby-label">Asks</p>
            <ul className="lobby-list">
              {lobby.asks.map((a) => (
                <li key={`${a.from}-${a.kind}`} className="lobby-item">
                  <span className="lobby-item-text"><strong>{who(a.from, a.name)}</strong> wants to play {a.kind === 'with' ? 'with you' : 'against you'}</span>
                  <span className="lobby-item-btns">
                    <button type="button" className="lobby-btn lobby-btn--primary" onClick={() => sendMatch(worldId, { t: 'link-answer', from: a.from, yes: true })}>Accept</button>
                    <button type="button" className="lobby-btn" onClick={() => sendMatch(worldId, { t: 'link-answer', from: a.from, yes: false })}>Decline</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {lobby && lobby.links.length > 0 && (
          <div className="lobby-block">
            <p className="lobby-label">Your links</p>
            <ul className="lobby-list">
              {lobby.links.map((l) => (
                <li key={`${l.with}-${l.kind}`} className="lobby-item">
                  <span className="lobby-item-text">Playing {l.kind} <strong>{who(l.with, l.name)}</strong></span>
                  <button type="button" className="lobby-btn" onClick={() => sendMatch(worldId, { t: 'unlink', with: l.with })} aria-label={`Remove the link with ${who(l.with, l.name)}`}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {owner && ready && (
          <div className="lobby-block">
            <p className="lobby-label">Host</p>
            <div className="lobby-row lobby-row--wrap">
              <button id="lobby-host-start" type="button" className="lobby-btn lobby-btn--primary" disabled={!lobby || lobby.pool < 1} onClick={() => sendMatch(worldId, { t: 'host', cmd: 'start' })}>Start now</button>
              {lobby?.held
                ? <button id="lobby-host-release" type="button" className="lobby-btn" onClick={() => sendMatch(worldId, { t: 'host', cmd: 'release' })}>Release the queue</button>
                : <button id="lobby-host-hold" type="button" className="lobby-btn" onClick={() => sendMatch(worldId, { t: 'host', cmd: 'hold' })}>Hold the queue</button>}
            </div>
            <p className="lobby-note">Start now begins with whoever is in the pool. Hold keeps everyone waiting until you release.</p>
          </div>
        )}

        {error && <p className="lobby-error" role="alert">{error}</p>}
      </div>
    </dialog>
  )
}

export function LobbyChip() {
  const game = useWorldStore((s) => s.meta?.game ?? null)
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const lobby = useMatchStore((s) => s.lobby)
  const playing = useMatchStore((s) => Boolean(s.playing))
  const open = usePlayStore((s) => s.sheet)
  const owner = useOwnsCurrentWorld()
  const setOpen = (sheet: boolean) => usePlayStore.setState({ sheet })

  if (!game) return null
  if (playing) return <MatchStrip />

  const ready = lobby ? lobby.ready : gameMissing(game).length === 0
  let text = 'Play'
  let tone = ''
  if (!ready) { text = owner ? 'Game not ready' : 'Not open yet'; tone = ' is-off' }
  else if (lobby?.rejoin) { text = 'Rejoin'; tone = ' is-on' }
  else if (lobby?.queued) { text = lobby.pool > 1 ? `In the pool · ${lobby.pool}` : 'In the pool'; tone = ' is-on' }
  else if (lobby && lobby.pool > 0) text = `${lobby.pool} waiting`
  const asks = lobby?.asks.length ?? 0

  return (
    <>
      <button id="lobby-chip" type="button" className={`lobby-chip${tone}`} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Game: ${text}${asks ? `, ${asks} asking to play` : ''}`}>
        <span aria-hidden="true">🎯</span>
        <span className="lobby-chip-text">{text}</span>
        {asks > 0 && <span className="lobby-chip-badge" aria-hidden="true">{asks === 1 ? '1 ask' : `${asks} asks`}</span>}
      </button>
      {open && worldId && <LobbySheet game={game} worldId={worldId} onClose={() => setOpen(false)} />}
    </>
  )
}

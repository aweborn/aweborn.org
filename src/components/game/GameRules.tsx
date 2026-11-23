import { GAME_LIMITS, type Game, type GameSettings } from '@aweborn/shared/game'
import { useGameDraftStore } from '../../lib/game'
import { Section, Segmented, Stepper, Toggle } from './controls'

const EDGE_LABEL = { soft: 'Countdown', wall: 'Wall', instant: 'Straight back' } as const

/** Game ▸ Rules: the template's settings (teams, players, rounds, the clock, how players move, the arena's edge). */
export function GameRules({ g }: { g: Game }) {
  const edit = useGameDraftStore.getState().edit
  const setSettings = (patch: Partial<GameSettings>) => edit((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
  const L = GAME_LIMITS
  const s = g.settings
  return (
    <>
      <Section title="Players">
        <Stepper id="game-teams" label="Teams" value={s.teams} text={s.teams === 1 ? 'One side' : String(s.teams)} min={1} max={L.teams} onChange={(teams) => setSettings({ teams })} />
        <Stepper id="game-min" label="Players to start" value={s.players.min} min={1} max={s.players.max} onChange={(min) => setSettings({ players: { ...s.players, min } })} />
        <Stepper id="game-max" label="Most players" value={s.players.max} min={Math.max(s.teams, s.players.min)} max={L.players} onChange={(max) => setSettings({ players: { ...s.players, max } })} />
      </Section>
      <Section title="The match">
        <Stepper id="game-rounds" label="Rounds" value={s.rounds} min={1} max={L.rounds} onChange={(rounds) => setSettings({ rounds })} />
        <Stepper id="game-round-length" label="Round length" value={s.roundSeconds} text={`${Math.round(s.roundSeconds / 60)} min`} step={60} min={L.roundSeconds[0]} max={L.roundSeconds[1]} onChange={(roundSeconds) => setSettings({ roundSeconds })} />
        <Stepper id="game-score" label="Score to win" value={s.scoreToWin} step={s.scoreToWin >= 30 ? 10 : 1} min={1} max={L.scoreToWin} onChange={(scoreToWin) => setSettings({ scoreToWin })} />
      </Section>
      <Section title="Moving">
        <Stepper id="game-speed" label="Speed" value={s.traits.speedMul} text={`${s.traits.speedMul}×`} step={0.25} min={0.25} max={3} onChange={(speedMul) => setSettings({ traits: { ...s.traits, speedMul } })} />
        <Stepper id="game-gravity" label="Gravity" value={s.traits.gravityMul} text={`${s.traits.gravityMul}×`} step={0.25} min={0.25} max={3} onChange={(gravityMul) => setSettings({ traits: { ...s.traits, gravityMul } })} />
        <Toggle id="game-fly" label="Jetpack" checked={s.traits.fly} onChange={(fly) => setSettings({ traits: { ...s.traits, fly } })} />
      </Section>
      <Section title="The edge">
        <Segmented id="game-edge" label="Leaving the arena" value={s.edge} options={[['soft', EDGE_LABEL.soft], ['wall', EDGE_LABEL.wall], ['instant', EDGE_LABEL.instant]] as const} onChange={(edge) => setSettings({ edge })} />
        {s.edge === 'soft' && (
          <Stepper id="game-edge-seconds" label="Countdown" value={s.edgeSeconds} text={`${s.edgeSeconds} s`} min={L.edgeSeconds[0]} max={L.edgeSeconds[1]} onChange={(edgeSeconds) => setSettings({ edgeSeconds })} />
        )}
      </Section>
    </>
  )
}

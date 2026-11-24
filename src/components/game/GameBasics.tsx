import { GAME_TEMPLATES, TEMPLATE_DEFAULTS, defaultSettings, type Game, type GameTemplate } from '@aweborn/shared/game'
import { useGameDraftStore } from '../../lib/game'
import { ConfirmButton, Section } from './controls'

/** Game ▸ Game: what kind of game it is, what a match still needs, and removing it. */
export function GameBasics({ g, missing, canRemove, busy, onRemove }: { g: Game; missing: string[]; canRemove: boolean; busy: boolean; onRemove: () => void }) {
  const edit = useGameDraftStore.getState().edit
  const pickTemplate = (template: GameTemplate) =>
    edit((d) => {
      if (d.template === template) return d
      // Keep what the creator set by hand; take the new template's own teams and score
      const fresh = defaultSettings(template)
      return { ...d, template, settings: { ...d.settings, teams: fresh.teams, scoreToWin: fresh.scoreToWin } }
    })
  return (
    <>
      <Section title="What kind of game" hint={TEMPLATE_DEFAULTS[g.template].blurb}>
        <div className="game-templates" role="group" aria-label="Game template">
          {GAME_TEMPLATES.map((t) => (
            <button key={t} id={`game-template-${t}`} type="button" className={`game-template${g.template === t ? ' is-on' : ''}`} aria-pressed={g.template === t} onClick={() => pickTemplate(t)}>
              {TEMPLATE_DEFAULTS[t].label}
            </button>
          ))}
        </div>
      </Section>

      <section className="game-section" id="game-checklist-section">
        <h3 className="game-section-title">Before a match can start</h3>
        {missing.length ? (
          <ul className="game-missing">
            {missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        ) : (
          <p className="game-ready">Everything a match needs is here. Players who stand in the lobby ring are matched.</p>
        )}
      </section>

      {canRemove && (
        <Section title="Remove" hint="Takes the game off this world. What you built stays.">
          <div className="game-adds">
            <ConfirmButton id="game-remove" label="Remove game" sure="Sure? Remove" disabled={busy} onConfirm={onRemove} />
          </div>
        </Section>
      )}
    </>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { TEMPLATE_DEFAULTS, type Game, type GameCredit } from '@aweborn/shared/game'
import { LIBRARY_NAME, bringLibraryGame, listLibraryGames, saveGameToLibrary, useGameDraftStore, type LibraryGame } from '../../lib/game'
import { ConfirmButton, Section, here } from './controls'

/**
 * Game ▸ Library (slice 7): games travel. Save this world's game to the Library
 * (versioned, credited), see what it was based on, and bring a Library game here: its
 * arena lands where you stand and it replaces this world's game.
 */

/** A raw account id is not a name anyone should read. */
const looksLikeId = (s: string) => s.length >= 16 && !/\s/.test(s) && /\d/.test(s)

function creditText(c: GameCredit, games: LibraryGame[] | null): string {
  const known = games?.find((x) => x.id === c.libraryId)
  const who = c.byName || (known && known.by === c.by ? known.byName : looksLikeId(c.by) ? '' : c.by)
  return `${c.name || known?.name || 'a Library game'} v${c.version}${who ? ` by ${who}` : ''}`
}

export function GameLibrary({ worldId, g, saved, dirty }: { worldId: string; g: Game; saved: Game | null; dirty: boolean }) {
  const [games, setGames] = useState<LibraryGame[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [which, setWhich] = useState<'mine' | 'all'>('mine')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const r = await listLibraryGames()
    if (r.ok) setGames(r.data)
    else setLoadError(r.message)
  }, [])
  useEffect(() => { void load() }, [load])

  const trimmed = name.trim()
  const nameOk = trimmed.length >= LIBRARY_NAME.min && trimmed.length <= LIBRARY_NAME.max
  const canSave = Boolean(saved) && !dirty
  const save = async () => {
    if (busy || !canSave || !nameOk) return
    setBusy(true); setError(null); setDone(null)
    const r = await saveGameToLibrary(worldId, trimmed)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    setDone(`Saved to the Library as “${r.data.name}”, v${r.data.version}.`)
    setWhich('mine')
    void load()
  }
  const bring = async (lib: LibraryGame) => {
    if (busy) return
    setBusy(true); setError(null); setDone(null)
    // The arena's floor middle goes where you stand: the same rule as marking the arena
    const r = await bringLibraryGame(worldId, lib.id, here(1))
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    // The game that came back is the saved one: edit from it
    useGameDraftStore.getState().saved(r.data)
    setDone(`“${lib.name}” is now this world’s game. Its arena is where you stand.`)
  }

  const shown = (games ?? []).filter((x) => (which === 'mine' ? x.mine : !x.mine))

  return (
    <>
      {g.credits.length > 0 && (
        <Section title="Credit">
          <ul className="game-credits" id="game-credits">
            {[...g.credits].reverse().map((c, i) => (
              <li key={`${c.libraryId}-${c.version}-${i}`}>{i === 0 ? 'Based on ' : 'which was based on '}{creditText(c, games)}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Save this game to the Library" hint="Its rules, places, NPCs and what stands on the stage, so it can come to life in other worlds. You keep the credit. Saving again makes the next version.">
        <form className="game-lib-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <input
            id="game-lib-name" className="game-input" type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Name this game" aria-label="Name in the Library" minLength={LIBRARY_NAME.min} maxLength={LIBRARY_NAME.max}
            autoComplete="off" autoCapitalize="words" enterKeyHint="done"
          />
          <button id="game-lib-save" type="submit" className="game-btn game-btn--primary" disabled={busy || !canSave || !nameOk}>{busy ? 'Saving…' : 'Save to Library'}</button>
        </form>
        {!canSave && <p className="game-hint" id="game-lib-why">{saved ? 'Save your changes first (the button below), then it can go to the Library.' : 'Save the game first (the button below), then it can go to the Library.'}</p>}
        {error && <p className="game-error" role="alert" id="game-lib-error">{error}</p>}
        {done && <p className="game-ready" role="status" id="game-lib-done">{done}</p>}
      </Section>

      <Section title="Bring a game here" hint="Stand where the arena’s middle should be. Bringing one replaces this world’s game.">
        <div className="game-seg game-seg--full" role="group" aria-label="Whose games">
          <button id="game-lib-mine" type="button" className={`game-seg-btn${which === 'mine' ? ' is-on' : ''}`} aria-pressed={which === 'mine'} onClick={() => setWhich('mine')}>Mine</button>
          <button id="game-lib-all" type="button" className={`game-seg-btn${which === 'all' ? ' is-on' : ''}`} aria-pressed={which === 'all'} onClick={() => setWhich('all')}>Everyone’s</button>
        </div>
        {loadError ? (
          <div className="game-adds">
            <span className="game-error" role="alert">{loadError}</span>
            <button id="game-lib-retry" type="button" className="game-btn" onClick={() => void load()}>Try again</button>
          </div>
        ) : games === null ? (
          <p className="game-hint">Loading the Library…</p>
        ) : shown.length === 0 ? (
          <p className="game-hint" id="game-lib-empty">{which === 'mine' ? 'You haven’t saved a game to the Library yet.' : 'No games from other creators yet.'}</p>
        ) : (
          <ul className="game-cards" id="game-lib-list" aria-label={which === 'mine' ? 'My Library games' : 'Everyone’s Library games'}>
            {shown.map((lib) => (
              <li key={lib.id} className="game-card game-card--lib">
                <span className="game-lib-text">
                  <span className="game-lib-name">{lib.name}</span>
                  <span className="game-lib-meta">{TEMPLATE_DEFAULTS[lib.template]?.label ?? 'Game'} · v{lib.version} · by {lib.mine ? 'you' : lib.byName || 'a creator'}</span>
                </span>
                <ConfirmButton id={`game-lib-bring-${lib.id}`} label="Bring here" sure="Replaces this world’s game" disabled={busy} onConfirm={() => void bring(lib)} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}

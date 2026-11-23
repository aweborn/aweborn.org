import { useEffect, useRef, useState } from 'react'
import { gameMissing, newGame, type Game } from '@aweborn/shared/game'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useSheet, useSheetStore } from '../stores/sheetStore'
import { useOwnsCurrentWorld } from '../lib/worldActor'
import { saveGame, useGameDraftStore } from '../lib/game'
import { useScrollHint } from '../hooks/useScrollHint'
import { MakeTabs } from './MakeTabs'
import { GameBasics } from './game/GameBasics'
import { GamePlaces } from './game/GamePlaces'
import { GameRules } from './game/GameRules'
import { GameNpcs } from './game/GameNpcs'
import { GameCards } from './game/GameCards'
import { GameLibrary } from './game/GameLibrary'
import './GamePanel.css'

/**
 * The Game tab (Phase 10): the world's creator and builders turn their world into a
 * game. Six sections you jump between (`game/*.tsx`): the template (Game), the arena,
 * zones and lobby marked where you stand (Places), the settings (Rules), who may play
 * as an NPC (NPCs), When ▸ If ▸ Do cards (Cards) and travel between worlds (Library).
 * Outlines in the world (GameOutlines) show the draft as you go. One Save for all of
 * it, and what a match still needs is one tap away from every section.
 *
 * Owners only. On a phone it is a tab of the 🧱 Make sheet (the sheet sits above the
 * sticks, so you can walk with it open); on desktop a 🎯 Game pill above ✧ Plan.
 * The server validates, versions and stores every save (POST /api/player/world/game).
 */

/** Other layers name teams the same way: the implementation lives with the tab's other words. */
export { teamName } from './game/labels'

const SUBTABS = [['game', 'Game'], ['places', 'Places'], ['rules', 'Rules'], ['npcs', 'NPCs'], ['cards', 'Cards'], ['library', 'Library']] as const
type SubTab = (typeof SUBTABS)[number][0]

export function GamePanel() {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const owner = useOwnsCurrentWorld()
  const saved = useWorldStore((s) => s.meta?.game ?? null)
  const loaded = useWorldStore((s) => s.loaded)
  const [open, setOpen] = useSheet('game')
  const anySheet = useSheetStore((s) => s.sheet !== null)
  const draftWorld = useGameDraftStore((s) => s.worldId)
  const draft = useGameDraftStore((s) => s.draft)
  const dirty = useGameDraftStore((s) => s.dirty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [tab, setTab] = useState<SubTab>('game')
  const subtabs = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useScrollHint(subtabs, [open, tab, Boolean(draft)])

  const canHaveGame = Boolean(worldId) && worldId !== ORIGIN_WORLD_ID && owner

  // Leaving the world drops the draft (it belongs to that world)
  useEffect(() => () => useGameDraftStore.getState().clear(), [worldId])

  // Open: edit the saved game (or a new one). A save by another builder replaces a draft you haven't touched.
  const savedKey = saved ? JSON.stringify(saved) : ''
  useEffect(() => {
    if (!open || !worldId || !loaded) return
    const st = useGameDraftStore.getState()
    if (st.worldId === worldId && st.draft && st.dirty) return
    st.start(worldId, saved ?? newGame())
    // `saved` is read fresh; savedKey says when it changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, worldId, loaded, savedKey])

  // Someone who stops being an owner (or isn't one) has no Game tab
  useEffect(() => {
    if (open && worldId && loaded && !canHaveGame) setOpen(false)
  }, [open, worldId, loaded, canHaveGame, setOpen])

  // A new section starts at its top, and its tab stays in view when the row scrolls sideways
  useEffect(() => {
    body.current?.scrollTo?.(0, 0)
    document.getElementById(`game-sub-${tab}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  if (!worldId || !canHaveGame) return null

  if (!open) {
    // Desktop pill (touch opens it from the Make sheet's tabs); out of the way while another sheet is open
    if (anySheet) return null
    return (
      <button id="game-open" className="planner-open game-open" type="button" onClick={() => setOpen(true)}>
        🎯 Game{saved ? '' : ' · set up'}
      </button>
    )
  }

  const g: Game | null = draftWorld === worldId ? draft : null

  const save = async () => {
    if (!g || busy) return
    setBusy(true)
    setError(null)
    setNotes([])
    const r = await saveGame(worldId, g)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    useGameDraftStore.getState().saved(r.data.game)
    setNotes(r.data.warnings)
  }
  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotes([])
    const r = await saveGame(worldId, null)
    setBusy(false)
    if (!r.ok) { setError(r.message); return }
    useGameDraftStore.getState().start(worldId, newGame())
  }

  const missing = g ? gameMissing(g) : []
  const status = !saved ? 'Not saved yet' : dirty ? `v${saved.version} · unsaved` : `v${saved.version} · saved`
  const showChecklist = () => {
    if (tab === 'game') document.getElementById('game-checklist-section')?.scrollIntoView?.({ block: 'nearest' })
    else setTab('game')
  }

  return (
    <aside id="game-panel" className="planner game-panel" aria-label="Game setup">
      <MakeTabs current="game" />
      <header className="planner-head game-head">
        <h2 className="planner-title">🎯 Game</h2>
        <span className={`game-status${dirty ? ' is-dirty' : ''}`}>{status}</span>
        {g && (
          <button id="game-checklist" type="button" className={`game-todo${missing.length ? '' : ' is-ready'}`} onClick={showChecklist} aria-label={missing.length ? `${missing.length} to do before a match can start. Show them.` : 'Ready for a match'}>
            <span>{missing.length ? `${missing.length} to do` : '✓ Ready'}</span>
          </button>
        )}
        <button id="game-close" className="planner-close" type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>

      {!g ? (
        <p className="game-hint">Loading this world…</p>
      ) : (
        <>
          <nav ref={subtabs} className="game-subtabs" role="tablist" aria-label="Game setup sections">
            {SUBTABS.map(([name, label]) => (
              <button key={name} id={`game-sub-${name}`} type="button" role="tab" aria-selected={tab === name} aria-controls="game-body" className={`game-subtab${tab === name ? ' is-on' : ''}`} onClick={() => setTab(name)}>
                {label}
                {name === 'npcs' && g.npcRoster.length > 0 && <span className="game-subtab-count">{g.npcRoster.length}</span>}
                {name === 'cards' && g.rules.length > 0 && <span className="game-subtab-count">{g.rules.length}</span>}
              </button>
            ))}
          </nav>

          <div ref={body} id="game-body" className="game-body" role="tabpanel" aria-labelledby={`game-sub-${tab}`}>
            {tab === 'game' && <GameBasics g={g} missing={missing} canRemove={Boolean(saved)} busy={busy} onRemove={() => void remove()} />}
            {tab === 'places' && <GamePlaces g={g} />}
            {tab === 'rules' && <GameRules g={g} />}
            {tab === 'npcs' && <GameNpcs g={g} />}
            {tab === 'cards' && <GameCards g={g} />}
            {tab === 'library' && <GameLibrary worldId={worldId} g={g} saved={saved} dirty={dirty} />}
          </div>

          <footer className="game-foot">
            {error && <p className="game-error" role="alert">{error}</p>}
            {notes.map((n) => <p key={n} className="game-note">Saved, with a fix: {n}</p>)}
            <div className="game-foot-btns">
              <button id="game-save" type="button" className="game-btn game-btn--save" disabled={busy || (!dirty && Boolean(saved))} onClick={() => void save()}>
                {busy ? 'Saving…' : !dirty && saved ? 'Saved' : 'Save game'}
              </button>
            </div>
          </footer>
        </>
      )}
    </aside>
  )
}

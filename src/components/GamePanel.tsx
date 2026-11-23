import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  GAME_LIMITS, GAME_TEMPLATES, TEMPLATE_DEFAULTS, defaultSettings, gameMissing, newGame,
  type Game, type GameBox, type GameSettings, type GameTemplate, type GameZone, type Vec3, type ZoneKind,
} from '@aweborn/shared/game'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useSheet, useSheetStore } from '../stores/sheetStore'
import { interiorController } from '../systems/InteriorController'
import { useOwnsCurrentWorld } from '../lib/worldActor'
import { saveGame, useGameDraftStore } from '../lib/game'
import { MakeTabs } from './MakeTabs'
import './GamePanel.css'

/**
 * The Game tab (Phase 10, slice 1): the world's creator and builders turn their world
 * into a game on paper. Pick a template and its settings, then walk to where the arena,
 * its zones and the lobby should go and mark them where you stand. Outlines in the world
 * (GameOutlines) show the draft as you go. Nothing runs yet: matches come in slice 2.
 *
 * Owners only. On a phone it is a tab of the 🧱 Make sheet (the sheet sits above the
 * sticks, so you can walk with it open); on desktop a 🎯 Game pill above ✧ Plan.
 * The server validates, versions and stores every save (POST /api/player/world/game).
 */

const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Gold', 'Violet', 'Teal', 'Orange', 'Pink']
export const teamName = (n: number) => TEAM_NAMES[n - 1] ?? `Team ${n}`

const ZONE_LABEL: Record<ZoneKind, string> = { spawn: 'Spawn', 'keep-out': 'Keep-out', goal: 'Goal' }
const EDGE_LABEL = { soft: 'Countdown', wall: 'Wall', instant: 'Straight back' } as const

/** Where the player stands, rounded to half a metre (boxes snap, so two marks line up). */
function here(drop = 0): Vec3 {
  const s = interiorController.state
  const r = (v: number) => Math.round(v * 2) / 2
  return [r(s.x), r(s.y - drop), r(s.z)]
}

const fmtSize = (b: GameBox) => `${b.size[0]} × ${b.size[2]} m, ${b.size[1]} m tall`

function Stepper({ id, label, value, text, step = 1, min, max, onChange }: {
  id: string; label: string; value: number; text?: string; step?: number; min: number; max: number; onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)))
  return (
    <div className="game-row">
      <span className="game-row-label" id={`${id}-label`}>{label}</span>
      <span className="game-stepper" role="group" aria-labelledby={`${id}-label`}>
        <button id={`${id}-less`} type="button" className="game-step" disabled={value <= min} onClick={() => set(value - step)} aria-label={`Less: ${label}`}>−</button>
        <output className="game-step-value" aria-live="polite">{text ?? value}</output>
        <button id={`${id}-more`} type="button" className="game-step" disabled={value >= max} onClick={() => set(value + step)} aria-label={`More: ${label}`}>+</button>
      </span>
    </div>
  )
}

function Segmented<T extends string>({ id, label, value, options, onChange }: {
  id: string; label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void
}) {
  return (
    <div className="game-row game-row--wrap">
      <span className="game-row-label" id={`${id}-label`}>{label}</span>
      <span className="game-seg" role="group" aria-labelledby={`${id}-label`}>
        {options.map(([v, text]) => (
          <button key={v} id={`${id}-${v}`} type="button" className={`game-seg-btn${value === v ? ' is-on' : ''}`} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </span>
    </div>
  )
}

/** Width / depth / height of a marked box. */
function SizeSteppers({ id, box, xz, height, onChange }: {
  id: string; box: GameBox; xz: readonly [number, number]; height: readonly [number, number]; onChange: (size: Vec3) => void
}) {
  const [w, h, d] = box.size
  const step = xz[1] > 100 ? 4 : 1
  return (
    <>
      <Stepper id={`${id}-w`} label="Width" value={w} text={`${w} m`} step={step} min={xz[0]} max={xz[1]} onChange={(v) => onChange([v, h, d])} />
      <Stepper id={`${id}-d`} label="Depth" value={d} text={`${d} m`} step={step} min={xz[0]} max={xz[1]} onChange={(v) => onChange([w, h, v])} />
      <Stepper id={`${id}-h`} label="Height" value={h} text={`${h} m`} step={step > 1 ? 2 : 1} min={height[0]} max={height[1]} onChange={(v) => onChange([w, v, d])} />
    </>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="game-section">
      <h3 className="game-section-title">{title}</h3>
      {hint && <p className="game-hint">{hint}</p>}
      {children}
    </section>
  )
}

/** Asks "Sure?" on the first tap. */
function ConfirmButton({ id, label, sure, disabled, onConfirm }: { id: string; label: string; sure: string; disabled?: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <button
      id={id}
      type="button"
      className={`game-btn${armed ? ' game-btn--danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) { setArmed(false); onConfirm(); return }
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 3500)
      }}
    >
      {armed ? sure : label}
    </button>
  )
}

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
  const [zoneKind, setZoneKind] = useState<ZoneKind>('spawn')

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
  const edit = useGameDraftStore.getState().edit
  const setSettings = (patch: Partial<GameSettings>) => edit((d) => ({ ...d, settings: { ...d.settings, ...patch } }))

  const pickTemplate = (template: GameTemplate) =>
    edit((d) => {
      if (d.template === template) return d
      // Keep what the creator set by hand; take the new template's own teams and score
      const fresh = defaultSettings(template)
      return { ...d, template, settings: { ...d.settings, teams: fresh.teams, scoreToWin: fresh.scoreToWin } }
    })

  const markArena = () => edit((d) => ({ ...d, arena: { at: here(1), size: d.arena?.size ?? [40, 20, 40] } }))
  const markLobby = () =>
    edit((d) => {
      const at = here()
      // A new lobby gets its ring and arrival point in the middle; moving one carries them along
      const size = d.lobby?.size ?? ([12, 6, 12] as Vec3)
      const shift = (p: Vec3): Vec3 => (d.lobby ? [p[0] + at[0] - d.lobby.at[0], p[1] + at[1] - d.lobby.at[1], p[2] + at[2] - d.lobby.at[2]] : at)
      return { ...d, lobby: { at, size, ring: { at: shift(d.lobby?.ring.at ?? at), radius: d.lobby?.ring.radius ?? 2 }, arrival: shift(d.lobby?.arrival ?? at) } }
    })
  const addZone = (kind: ZoneKind, team?: number) =>
    edit((d) => {
      const zone: Partial<GameZone> & { kind: ZoneKind } = { kind, at: here(), size: kind === 'goal' ? [6, 4, 6] : [4, 3, 4], ...(team ? { team } : {}) }
      return { ...d, zones: [...d.zones, zone as GameZone] }
    })
  const editZone = (id: string, patch: Partial<GameZone>) => edit((d) => ({ ...d, zones: d.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }))
  const dropZone = (id: string) => edit((d) => ({ ...d, zones: d.zones.filter((z) => z.id !== id) }))

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

  const L = GAME_LIMITS
  const missing = g ? gameMissing(g) : []
  const teamsWithoutSpawn = g ? Array.from({ length: g.settings.teams }, (_, i) => i + 1).filter((t) => !g.zones.some((z) => z.kind === 'spawn' && z.team === t)) : []
  const status = !saved ? 'Not saved yet' : dirty ? `v${saved.version} · unsaved changes` : `v${saved.version} · saved`

  return (
    <aside id="game-panel" className="planner game-panel" aria-label="Game setup">
      <MakeTabs current="game" />
      <header className="planner-head">
        <h2 className="planner-title">🎯 Game</h2>
        <span className={`game-status${dirty ? ' is-dirty' : ''}`}>{status}</span>
        <button id="game-close" className="planner-close" type="button" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>

      {!g ? (
        <p className="game-hint">Loading this world…</p>
      ) : (
        <>
          <div className="game-body">
            <Section title="What kind of game" hint={TEMPLATE_DEFAULTS[g.template].blurb}>
              <div className="game-templates" role="group" aria-label="Game template">
                {GAME_TEMPLATES.map((t) => (
                  <button key={t} id={`game-template-${t}`} type="button" className={`game-template${g.template === t ? ' is-on' : ''}`} aria-pressed={g.template === t} onClick={() => pickTemplate(t)}>
                    {TEMPLATE_DEFAULTS[t].label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="The arena" hint="The stage every match copies. Walk to its middle, then mark it. Only you and your builders can place or move things there.">
              <div className="game-place">
                <span className="game-place-text">{g.arena ? fmtSize(g.arena) : 'Not marked'}</span>
                <button id="game-arena-mark" type="button" className="game-btn game-btn--primary" onClick={markArena}>{g.arena ? 'Move here' : 'Mark here'}</button>
              </div>
              {g.arena && <SizeSteppers id="game-arena" box={g.arena} xz={L.arenaSize} height={L.arenaHeight} onChange={(size) => edit((d) => (d.arena ? { ...d, arena: { ...d.arena, size } } : d))} />}
            </Section>

            {g.arena && (
              <Section title="Zones" hint="Inside the arena. Stand where a zone should go, then add it.">
                <div className="game-seg game-seg--full" role="group" aria-label="Zone to add">
                  {(['spawn', 'goal', 'keep-out'] as const).map((k) => (
                    <button key={k} id={`game-zone-kind-${k}`} type="button" className={`game-seg-btn${zoneKind === k ? ' is-on' : ''}`} aria-pressed={zoneKind === k} onClick={() => setZoneKind(k)}>{ZONE_LABEL[k]}</button>
                  ))}
                </div>
                <div className="game-adds">
                  {zoneKind === 'spawn' ? (
                    teamsWithoutSpawn.length ? (
                      teamsWithoutSpawn.map((t) => (
                        <button key={t} id={`game-zone-add-spawn-${t}`} type="button" className="game-btn game-btn--primary" disabled={g.zones.length >= L.zones} onClick={() => addZone('spawn', t)}>
                          ＋ {g.settings.teams === 1 ? 'Spawn' : `${teamName(t)} spawn`} here
                        </button>
                      ))
                    ) : (
                      <span className="game-hint">Every team has its spawn.</span>
                    )
                  ) : (
                    <button id={`game-zone-add-${zoneKind}`} type="button" className="game-btn game-btn--primary" disabled={g.zones.length >= L.zones} onClick={() => addZone(zoneKind)}>
                      ＋ {ZONE_LABEL[zoneKind]} here
                    </button>
                  )}
                </div>
                {g.zones.length > 0 && (
                  <ul className="game-zones" aria-label="Zones">
                    {g.zones.map((z) => (
                      <li key={z.id} className={`game-zone game-zone--${z.kind}`}>
                        <span className="game-zone-name">
                          {z.kind === 'spawn' && g.settings.teams > 1 ? `${teamName(z.team ?? 1)} spawn` : ZONE_LABEL[z.kind]}
                          <span className="game-zone-size">{z.size[0]} × {z.size[2]} m</span>
                        </span>
                        <span className="game-zone-btns">
                          {z.kind === 'keep-out' && (
                            <button id={`game-zone-ret-${z.id}`} type="button" className="game-btn" onClick={() => editZone(z.id, { ret: z.ret === 'instant' ? 'soft' : 'instant' })} aria-label={`Keep-out return: ${z.ret === 'instant' ? 'straight back' : 'countdown'}`}>
                              {z.ret === 'instant' ? 'Straight back' : 'Countdown'}
                            </button>
                          )}
                          <button id={`game-zone-smaller-${z.id}`} type="button" className="game-step" disabled={z.size[0] <= L.zoneSize[0]} onClick={() => editZone(z.id, { size: [z.size[0] - 1, z.size[1], z.size[2] - 1] })} aria-label="Smaller">−</button>
                          <button id={`game-zone-bigger-${z.id}`} type="button" className="game-step" onClick={() => editZone(z.id, { size: [z.size[0] + 1, z.size[1], z.size[2] + 1] })} aria-label="Bigger">+</button>
                          <button id={`game-zone-move-${z.id}`} type="button" className="game-btn" onClick={() => editZone(z.id, { at: here() })}>Here</button>
                          <button id={`game-zone-remove-${z.id}`} type="button" className="game-step game-step--remove" onClick={() => dropZone(z.id)} aria-label="Remove zone">×</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            <Section title="The lobby" hint="Where players arrive, wait and watch: a box beside or above the arena. The ring is where they stand to play.">
              <div className="game-place">
                <span className="game-place-text">{g.lobby ? fmtSize(g.lobby) : 'Not marked'}</span>
                <button id="game-lobby-mark" type="button" className="game-btn game-btn--primary" onClick={markLobby}>{g.lobby ? 'Move here' : 'Mark here'}</button>
              </div>
              {g.lobby && (
                <>
                  <SizeSteppers id="game-lobby" box={g.lobby} xz={L.lobbySize} height={[3, L.lobbySize[1]]} onChange={(size) => edit((d) => (d.lobby ? { ...d, lobby: { ...d.lobby, size } } : d))} />
                  <div className="game-adds">
                    <button id="game-ring-mark" type="button" className="game-btn" onClick={() => edit((d) => (d.lobby ? { ...d, lobby: { ...d.lobby, ring: { ...d.lobby.ring, at: here() } } } : d))}>Ring here</button>
                    <button id="game-arrival-mark" type="button" className="game-btn" onClick={() => edit((d) => (d.lobby ? { ...d, lobby: { ...d.lobby, arrival: here() } } : d))}>Arrive here</button>
                  </div>
                  <Stepper id="game-ring-radius" label="Ring size" value={g.lobby.ring.radius} text={`${g.lobby.ring.radius} m`} step={0.5} min={L.ringRadius[0]} max={L.ringRadius[1]} onChange={(radius) => edit((d) => (d.lobby ? { ...d, lobby: { ...d.lobby, ring: { ...d.lobby.ring, radius } } } : d))} />
                </>
              )}
            </Section>

            <Section title="Rules">
              <Stepper id="game-teams" label="Teams" value={g.settings.teams} text={g.settings.teams === 1 ? 'One side' : String(g.settings.teams)} min={1} max={L.teams} onChange={(teams) => setSettings({ teams })} />
              <Stepper id="game-min" label="Players to start" value={g.settings.players.min} min={1} max={g.settings.players.max} onChange={(min) => setSettings({ players: { ...g.settings.players, min } })} />
              <Stepper id="game-max" label="Most players" value={g.settings.players.max} min={Math.max(g.settings.teams, g.settings.players.min)} max={L.players} onChange={(max) => setSettings({ players: { ...g.settings.players, max } })} />
              <Stepper id="game-rounds" label="Rounds" value={g.settings.rounds} min={1} max={L.rounds} onChange={(rounds) => setSettings({ rounds })} />
              <Stepper id="game-round-length" label="Round length" value={g.settings.roundSeconds} text={`${Math.round(g.settings.roundSeconds / 60)} min`} step={60} min={L.roundSeconds[0]} max={L.roundSeconds[1]} onChange={(roundSeconds) => setSettings({ roundSeconds })} />
              <Stepper id="game-score" label="Score to win" value={g.settings.scoreToWin} step={g.settings.scoreToWin >= 30 ? 10 : 1} min={1} max={L.scoreToWin} onChange={(scoreToWin) => setSettings({ scoreToWin })} />
              <Stepper id="game-speed" label="Speed" value={g.settings.traits.speedMul} text={`${g.settings.traits.speedMul}×`} step={0.25} min={0.25} max={3} onChange={(speedMul) => setSettings({ traits: { ...g.settings.traits, speedMul } })} />
              <Stepper id="game-gravity" label="Gravity" value={g.settings.traits.gravityMul} text={`${g.settings.traits.gravityMul}×`} step={0.25} min={0.25} max={3} onChange={(gravityMul) => setSettings({ traits: { ...g.settings.traits, gravityMul } })} />
              <label className="game-row game-toggle" htmlFor="game-fly">
                <span className="game-row-label">Jetpack</span>
                <input id="game-fly" type="checkbox" role="switch" checked={g.settings.traits.fly} onChange={(e) => setSettings({ traits: { ...g.settings.traits, fly: e.target.checked } })} />
              </label>
              <Segmented id="game-edge" label="Leaving the arena" value={g.settings.edge} options={[['soft', EDGE_LABEL.soft], ['wall', EDGE_LABEL.wall], ['instant', EDGE_LABEL.instant]] as const} onChange={(edge) => setSettings({ edge })} />
              {g.settings.edge === 'soft' && (
                <Stepper id="game-edge-seconds" label="Countdown" value={g.settings.edgeSeconds} text={`${g.settings.edgeSeconds} s`} min={L.edgeSeconds[0]} max={L.edgeSeconds[1]} onChange={(edgeSeconds) => setSettings({ edgeSeconds })} />
              )}
            </Section>

            <Section title="Before a match can start">
              {missing.length ? (
                <ul className="game-missing">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              ) : (
                <p className="game-ready">Everything a match needs is here. Matches themselves come next; players already arrive in your lobby.</p>
              )}
            </Section>
          </div>

          <footer className="game-foot">
            {error && <p className="game-error" role="alert">{error}</p>}
            {notes.map((n) => <p key={n} className="game-note">Saved, with a fix: {n}</p>)}
            <div className="game-foot-btns">
              {saved && <ConfirmButton id="game-remove" label="Remove game" sure="Sure? Remove" disabled={busy} onConfirm={() => void remove()} />}
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

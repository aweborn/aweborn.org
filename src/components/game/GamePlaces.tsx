import { useState } from 'react'
import { GAME_LIMITS, type Game, type GameZone, type Vec3, type ZoneKind } from '@aweborn/shared/game'
import { useGameDraftStore } from '../../lib/game'
import { Section, SizeSteppers, Stepper, fmtSize, here } from './controls'
import { ZONE_LABEL, teamName, zoneName } from './labels'

/** Game ▸ Places: the arena, its zones and the lobby, each marked where the creator stands. */
export function GamePlaces({ g }: { g: Game }) {
  const edit = useGameDraftStore.getState().edit
  const [zoneKind, setZoneKind] = useState<ZoneKind>('spawn')
  const L = GAME_LIMITS

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
  const teamsWithoutSpawn = Array.from({ length: g.settings.teams }, (_, i) => i + 1).filter((t) => !g.zones.some((z) => z.kind === 'spawn' && z.team === t))

  return (
    <>
      <Section title="The arena" hint="The stage every match plays on. Walk to its middle, then mark it. Only you and your builders can place or move things there.">
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
                    {zoneName(g, z)}
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
    </>
  )
}

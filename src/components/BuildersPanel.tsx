import { useEffect, useMemo, useState } from 'react'
import { MAX_CO_CREATORS as MAX_BUILDERS } from '@aweborn/shared/world-policy'
import { usePresence, getPresenceState } from '../hooks/usePresence'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useNameStore, requestNames, displayName } from '../stores/nameStore'
import { AUTH_URL } from '../lib/player'

/**
 * Builders (Rough Draft M1, 2026-10-27): the world's creator picks who else
 * may build here. Builders can move and remove anything and shape the
 * terrain, sky and physics, just like the creator; everyone else can still
 * place their own things and kick anything. Lists the players here now plus
 * anyone who's already a builder. The server enforces it and syncs the list
 * to everyone through the world itself.
 */
export function BuildersPanel({ worldId, creatorIds }: { worldId: string; creatorIds: readonly string[] }) {
  const { players } = usePresence()
  const entry = useUniverseStore((s) => s.worlds.get(worldId))
  const meta = useWorldStore((s) => s.meta)
  const synced = useMemo(() => entry?.coCreators ?? meta?.coCreators ?? [], [entry, meta])
  const [pending, setPending] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const names = useNameStore((s) => s.names)
  const builders = pending ?? synced

  // Here now (live presence), plus existing builders who are away
  const here = useMemo(() => {
    const live = getPresenceState()
    return [...players.keys()].filter((id) => live.get(id)?.inWorld === worldId && !creatorIds.includes(id) && !id.startsWith('guest'))
    // players changes on join/leave; that's when this list should change
  }, [players, worldId, creatorIds])
  const rows = useMemo(() => [...new Set([...here, ...synced])], [here, synced])

  useEffect(() => {
    requestNames(rows)
  }, [rows])

  const toggle = async (id: string) => {
    const on = builders.includes(id)
    if (!on && builders.length >= MAX_BUILDERS) return setError(`Up to ${MAX_BUILDERS} builders per world.`)
    const next = on ? builders.filter((b) => b !== id) : [...builders, id]
    setPending(next)
    setError(null)
    const res = await fetch(`${AUTH_URL}/api/player/world/policy`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldId, coCreators: next }),
    }).catch(() => null)
    const body = res ? ((await res.json().catch(() => ({}))) as { message?: string }) : null
    if (!res?.ok) setError(body?.message ?? "Couldn't change builders. Please try again.")
    setPending(null) // the synced list (from the server, via the world) takes over
  }

  return (
    <div className="builders" role="group" aria-labelledby="builders-title">
      <span id="builders-title" className="plant-policy__label">
        Builders
      </span>
      <p className="builders-hint">Builders can move and remove anything and shape this world, like you.</p>
      {rows.length === 0 ? (
        <p className="builders-empty">When friends are here, they show up so you can make them builders.</p>
      ) : (
        <ul className="builders-list">
          {rows.map((id) => {
            const on = builders.includes(id)
            const away = !here.includes(id)
            return (
              <li key={id} className="builders-row">
                <span className="builders-name">
                  {displayName(id, names)}
                  {away && <span className="builders-away"> · away</span>}
                </span>
                <button
                  id={`builder-toggle-${id}`}
                  type="button"
                  className={`plant-policy__btn builders-toggle${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  aria-label={`${displayName(id, names)} ${on ? 'is a builder' : 'is not a builder'}`}
                  disabled={pending !== null}
                  onClick={() => void toggle(id)}
                >
                  {on ? 'Builder ✓' : 'Make builder'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p className="plant-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

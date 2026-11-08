import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MAX_CO_CREATORS as MAX_BUILDERS, isWorldOwnerId } from '@aweborn/shared/world-policy'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import type { BuildRequestView, MyBuildRequest } from '@aweborn/shared/build-requests'
import { usePresence, getPresenceState } from '../hooks/usePresence'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useNameStore, requestNames, displayName } from '../stores/nameStore'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'
import {
  answerAsk,
  askerName,
  askToBuild,
  changeBuilder,
  myAsk,
  relativeTime,
  useBuildRequestsStore,
  withdrawAsk,
} from '../lib/builders'

/**
 * Builders (Rough Draft M1, 2026-10-27; asks and account-wide rights 2026-11-07).
 *
 * The creator and every builder can add builders and answer asks to build; only
 * the creator removes a builder; anyone can step down. Every character on an
 * account shares its rights. Shown in the world (Plant panel) and in the World
 * Index, for any world you own; everyone else gets "Ask to build". The server
 * enforces it all and syncs the list to everyone through the world itself.
 */

const NONE: readonly string[] = []

type Roles = { creator?: string; coCreators?: readonly string[] }

function useMyCharacters(): readonly string[] {
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot)
  return player && !player.isGuest ? player.characters : NONE
}

/** The world's creator and builders: live from the universe (or the world you're in), else what the World Index knows. */
function useRoles(worldId: string, fallback?: Roles): { creator: string; synced: readonly string[] } {
  const entry = useUniverseStore((s) => s.worlds.get(worldId))
  const here = useUniverseStore((s) => s.activeWorldId === worldId)
  const meta = useWorldStore((s) => s.meta)
  const live = here ? meta : null
  return {
    creator: entry?.creator ?? live?.creator ?? fallback?.creator ?? '',
    synced: entry?.coCreators ?? live?.coCreators ?? fallback?.coCreators ?? NONE,
  }
}

/**
 * Builders if you own this world, "Ask to build" if you don't (and `canAsk`: the
 * World Index only offers it for worlds you've been inside). Nothing for worlds nobody owns.
 */
export function WorldBuilders({ worldId, fallback, canAsk = true }: { worldId: string; fallback?: Roles; canAsk?: boolean }) {
  const mine = useMyCharacters()
  const { creator, synced } = useRoles(worldId, fallback)
  if (!creator || creator === 'system' || worldId === ORIGIN_WORLD_ID) return null
  const owner = mine.some((c) => isWorldOwnerId(c, { creator, coCreators: synced }))
  if (owner) return <BuildersPanel worldId={worldId} fallback={fallback} />
  return canAsk ? <AskToBuild worldId={worldId} /> : null
}

/** A button that asks "Sure?" on the first tap (removing and stepping down can't be undone by you). */
function ConfirmButton({ id, label, sure, busy, onConfirm }: { id: string; label: string; sure: string; busy: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return (
    <button
      id={id}
      type="button"
      className={`builders-btn${armed ? ' builders-btn--danger' : ''}`}
      disabled={busy}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
          return
        }
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 3500)
      }}
    >
      {armed ? sure : label}
    </button>
  )
}

/** One ask: who, where (optional), when, and Decline / Approve. Also used in the World Index's list of asks. */
export function AskRow({ ask, showWorld = false, onOpenWorld }: { ask: BuildRequestView; showWorld?: boolean; onOpenWorld?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = askerName(ask)
  const answer = async (approve: boolean) => {
    setBusy(true)
    setError(null)
    const r = await answerAsk(ask.worldId, ask.requester, approve)
    setBusy(false)
    if (!r.ok) setError(r.message)
  }
  return (
    <li className="builders-ask">
      <div className="builders-ask-who">
        <span className="builders-name">{name}</span>
        <span className="builders-ask-when">
          {showWorld && (
            <>
              wants to build in{' '}
              {onOpenWorld ? (
                <button type="button" className="builders-world-link" onClick={onOpenWorld}>{ask.worldName}</button>
              ) : (
                <strong>{ask.worldName}</strong>
              )}{' '}
              ·{' '}
            </>
          )}
          asked {relativeTime(ask.askedAt)}
        </span>
        {error && <span className="builders-error" role="alert">{error}</span>}
      </div>
      <div className="builders-ask-btns">
        <button
          id={`ask-decline-${ask.worldId}-${ask.requester}`}
          type="button"
          className="builders-btn"
          disabled={busy}
          onClick={() => void answer(false)}
          aria-label={`Decline ${name}`}
        >
          Decline
        </button>
        <button
          id={`ask-approve-${ask.worldId}-${ask.requester}`}
          type="button"
          className="builders-btn builders-btn--primary"
          disabled={busy}
          onClick={() => void answer(true)}
          aria-label={`Make ${name} a builder`}
        >
          Approve
        </button>
      </div>
    </li>
  )
}

export function BuildersPanel({ worldId, fallback }: { worldId: string; fallback?: Roles }) {
  const mine = useMyCharacters()
  const { creator, synced } = useRoles(worldId, fallback)
  const { players } = usePresence()
  const names = useNameStore((s) => s.names)
  const allAsks = useBuildRequestsStore((s) => s.requests)
  const asks = useMemo(() => allAsks.filter((a) => a.worldId === worldId), [allAsks, worldId])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // The server's answer counts until the synced list (through the world) catches up
  const syncedKey = synced.join(',')
  const [local, setLocal] = useState<{ list: string[]; base: string } | null>(null)
  const builders: readonly string[] = local && local.base === syncedKey ? local.list : synced
  const creatorSide = mine.includes(creator)

  // Players in this world now who could become builders
  const here = useMemo(() => {
    const live = getPresenceState()
    return [...players.keys()].filter(
      (id) => live.get(id)?.inWorld === worldId && id !== creator && !mine.includes(id) && !builders.includes(id) && !id.startsWith('guest'),
    )
    // players changes on join/leave; that's when this list should change
  }, [players, worldId, creator, mine, builders])

  useEffect(() => {
    requestNames([creator, ...builders, ...here].filter(Boolean))
  }, [creator, builders, here])

  const change = async (key: string, c: { add: string } | { remove: string }) => {
    setBusy(key)
    setError(null)
    const r = await changeBuilder(worldId, c)
    setBusy(null)
    if (r.ok) setLocal({ list: r.data.coCreators, base: syncedKey })
    else setError(r.message)
  }
  const full = builders.length >= MAX_BUILDERS

  return (
    <div className="builders" role="group" aria-labelledby={`builders-title-${worldId}`}>
      <span id={`builders-title-${worldId}`} className="plant-policy__label">
        Builders
      </span>
      <p className="builders-hint">
        Builders can move and remove anything and shape this world, like {creatorSide ? 'you' : 'its creator'}. They can add
        builders and answer asks too; only the creator removes one.
      </p>

      {asks.length > 0 && (
        <>
          <span className="builders-sub">Asking to build</span>
          <ul className="builders-list" aria-label="Asks to build">
            {asks.map((a) => (
              <AskRow key={a.requester} ask={a} />
            ))}
          </ul>
        </>
      )}

      <ul className="builders-list" aria-label="Builders">
        <li className="builders-row">
          <span className="builders-name">
            {displayName(creator, names)}
            <span className="builders-away"> · {creatorSide ? 'creator (you)' : 'creator'}</span>
          </span>
        </li>
        {builders.map((id) => {
          const me = mine.includes(id)
          return (
            <li key={id} className="builders-row">
              <span className="builders-name">
                {displayName(id, names)}
                {me && <span className="builders-away"> · you</span>}
              </span>
              {me ? (
                <ConfirmButton id={`builder-leave-${id}`} label="Step down" sure="Sure? Step down" busy={busy !== null} onConfirm={() => void change(id, { remove: id })} />
              ) : creatorSide ? (
                <ConfirmButton id={`builder-remove-${id}`} label="Remove" sure="Sure? Remove" busy={busy !== null} onConfirm={() => void change(id, { remove: id })} />
              ) : null}
            </li>
          )
        })}
      </ul>

      {here.length > 0 && (
        <>
          <span className="builders-sub">Here now</span>
          <ul className="builders-list" aria-label="Players here now">
            {here.map((id) => (
              <li key={id} className="builders-row">
                <span className="builders-name">{displayName(id, names)}</span>
                <button
                  id={`builder-add-${id}`}
                  type="button"
                  className="builders-btn"
                  disabled={busy !== null || full}
                  onClick={() => void change(id, { add: id })}
                  aria-label={`Make ${displayName(id, names)} a builder`}
                >
                  {busy === id ? '…' : 'Make builder'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {builders.length === 0 && here.length === 0 && asks.length === 0 && (
        <p className="builders-empty">No builders yet. Friends can ask from their World Index, or show up here so you can add them.</p>
      )}
      {full && <p className="builders-empty">{MAX_BUILDERS} builders is the most a world can have.</p>}
      {error && (
        <p className="builders-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** For a world you don't own: ask its creator and builders to let you build. */
export function AskToBuild({ worldId }: { worldId: string }) {
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot)
  const saved = Boolean(player && !player.isGuest && !player.isAnonymous)
  const [state, setState] = useState<MyBuildRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!saved) return
    let live = true
    void myAsk(worldId).then((r) => {
      // Couldn't tell (offline): offer the button; asking says what's wrong
      if (live) setState(r.ok ? r.data : { status: 'none' })
    })
    return () => {
      live = false
    }
  }, [worldId, saved])

  const run = async (fn: typeof askToBuild) => {
    setBusy(true)
    setError(null)
    const r = await fn(worldId)
    setBusy(false)
    if (r.ok) setState(r.data)
    else {
      setError(r.message)
      if (r.retryAt) setState({ status: 'declined', retryAt: r.retryAt })
    }
  }

  if (state?.status === 'builder') return null
  return (
    <div className="builders builders--ask" role="group" aria-label="Build here">
      <span className="plant-policy__label">Build here</span>
      {!saved ? (
        <p className="builders-hint">Asking to build needs a saved player: Save your player (top left, or ••• More on a phone).</p>
      ) : state?.status === 'open' ? (
        <>
          <p className="builders-hint">
            You asked {state.askedAt ? relativeTime(state.askedAt) : ''}. The creator and builders will see it, even if they&rsquo;re away.
          </p>
          <button id="ask-withdraw" type="button" className="builders-btn" disabled={busy} onClick={() => void run(withdrawAsk)}>
            Take it back
          </button>
        </>
      ) : state?.status === 'declined' ? (
        <p className="builders-hint">
          Not this time. You can ask again {state.retryAt ? relativeTime(state.retryAt) : 'later'}.
        </p>
      ) : (
        <>
          <p className="builders-hint">Builders can move and remove anything and shape this world. Ask its creator and builders to let you in.</p>
          <button id="ask-to-build" type="button" className="builders-btn builders-btn--primary" disabled={busy || state === null} onClick={() => void run(askToBuild)}>
            {busy ? 'Asking…' : 'Ask to build'}
          </button>
        </>
      )}
      {error && (
        <p className="builders-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

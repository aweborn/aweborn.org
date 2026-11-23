import { create } from 'zustand'
import type { LobbyState, MatchIntent, MatchMessage } from '@aweborn/shared/match-protocol'
import type { MatchResult, MatchSlot } from '@aweborn/shared/match'
import { notePresenceLinkAlive, setPresenceInstance } from '../hooks/usePresence'

/**
 * A world's lobby and matches, client side (Phase 10): the socket's `match` messages in,
 * intents out, and the store everything that draws a lobby, a match, a spectator view or
 * a replay reads. The server decides; this only holds what it said.
 *
 * `snap` is the latest snapshot of the match being played or watched and `prevSnap` the
 * one before it (draw between them: snapshots arrive ten times a second).
 */

export type Snap = Extract<MatchMessage, { t: 'snap' }>
export type Found = Extract<MatchMessage, { t: 'found' }>

export interface MatchClientState {
  /** The world these belong to (cleared on leaving it). */
  worldId: string | null
  lobby: LobbyState | null
  /** A ready check in progress, and when its latest message arrived (performance.now()): `readyMs` is the time left as of then. */
  found: (Found & { at: number }) | null
  /** The match this player is in. */
  playing: { matchId: string; you: { slot: number; team: number }; roster: MatchSlot[]; gameVersion: number } | null
  /** The running match this player is tuned into from the lobby. */
  watching: string | null
  /** The watched match's roster (snapshots carry no names or teams): filled by the view layer from the match's record, and by its `end`. */
  watchRoster: MatchSlot[] | null
  snap: Snap | null
  prevSnap: Snap | null
  /** When `snap` arrived (performance.now()), for drawing between snapshots. */
  snapAt: number
  /** The match that just ended (results screen), until dismissed. */
  ended: { matchId: string; result: MatchResult; roster: MatchSlot[]; awe: number; again: boolean; you: { slot: number; team: number } | null } | null
  error: string | null
  reset: () => void
}

const EMPTY = { worldId: null, lobby: null, found: null, playing: null, watching: null, watchRoster: null, snap: null, prevSnap: null, snapAt: 0, ended: null, error: null }

export const useMatchStore = create<MatchClientState>((set) => ({
  ...EMPTY,
  reset: () => {
    setPresenceInstance(null)
    set({ ...EMPTY })
  },
}))

type Sender = (worldId: string, intent: MatchIntent) => void
let sender: Sender | null = null

/** useCRDT, on socket open. */
export function setMatchSender(send: Sender | null): void {
  sender = send
  if (send) for (const fn of senderListeners) fn()
}

/** Called every time the socket (re)opens: the play layer says `hello` again. */
const senderListeners = new Set<() => void>()
export function onMatchSender(fn: () => void): () => void {
  senderListeners.add(fn)
  return () => senderListeners.delete(fn)
}

/** Ask the server for something in this world's lobby or match. */
export function sendMatch(worldId: string, intent: MatchIntent): void {
  sender?.(worldId, intent)
}

/** Things outside the store that react to a message (teleports, sounds): the play layer registers here. */
type Listener = (worldId: string, msg: MatchMessage) => void
const listeners = new Set<Listener>()
export function onMatch(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** useCRDT, for every `match` message. */
export function onMatchMessage(worldId: string | null, data: Uint8Array): void {
  let msg: MatchMessage
  try {
    msg = JSON.parse(new TextDecoder().decode(data)) as MatchMessage
  } catch {
    return
  }
  if (!worldId || !msg || typeof msg !== 'object') return
  // The socket is alive: players who went into (or out of) an instance are gone, not out of signal
  notePresenceLinkAlive()
  const s = useMatchStore.getState()
  const now = performance.now()
  switch (msg.t) {
    case 'lobby':
      useMatchStore.setState({ worldId, lobby: msg })
      break
    case 'found':
      useMatchStore.setState({ worldId, found: { ...msg, at: now } })
      break
    case 'cancel':
      if (s.found?.matchId === msg.matchId) useMatchStore.setState({ found: null })
      break
    case 'start':
      // Into the instance's presence group: nobody from the lobby is there
      setPresenceInstance(msg.matchId)
      useMatchStore.setState({ worldId, found: null, ended: null, watching: null, snap: null, prevSnap: null, playing: { matchId: msg.matchId, you: msg.you, roster: msg.roster, gameVersion: msg.gameVersion } })
      break
    case 'snap':
      if (s.playing?.matchId === msg.matchId || s.watching === msg.matchId) useMatchStore.setState({ prevSnap: s.snap?.matchId === msg.matchId ? s.snap : null, snap: msg, snapAt: now })
      break
    case 'end':
      useMatchStore.setState({ ...(s.watching === msg.matchId ? { watchRoster: msg.roster } : {}), ended: { matchId: msg.matchId, result: msg.result, roster: msg.roster, awe: msg.awe, again: msg.again, you: s.playing?.matchId === msg.matchId ? s.playing.you : null } })
      break
    case 'back':
      setPresenceInstance(null)
      useMatchStore.setState({ playing: null, snap: null, prevSnap: null })
      break
    case 'error':
      useMatchStore.setState({ error: msg.message })
      break
    case 'move':
      break
  }
  for (const fn of listeners) fn(worldId, msg)
}

/** Tune into a running match from the lobby (null = stop watching). */
export function watchMatch(worldId: string, matchId: string | null): void {
  useMatchStore.setState({ watching: matchId, watchRoster: null, ...(matchId ? {} : { snap: null, prevSnap: null }) })
  sendMatch(worldId, { t: 'watch', matchId })
}

import { useEffect } from 'react'
import { create } from 'zustand'
import { RULE_ANNOUNCEMENTS, boundsOf, inBounds, type Game } from '@aweborn/shared/game'
import type { MatchEvent, MatchSlot } from '@aweborn/shared/match'
import type { MatchMessage } from '@aweborn/shared/match-protocol'
import type { InteriorMods } from '@aweborn/shared/sim/interior'
import { onMatch, onMatchSender, sendMatch, useMatchStore } from './match'
import { setPresenceInstance } from '../hooks/usePresence'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useSheetStore } from '../stores/sheetStore'
import { interiorController } from '../systems/InteriorController'
import { teamName } from '../components/GamePanel'

/**
 * Playing in a world that has a game (Phase 10, slices 2 to 4), the part that isn't
 * drawing: saying hello to the lobby, telling the server when the player steps into or
 * out of the ring, and doing what the server's messages ask of the player's own body
 * (placed at a spawn, moved back, returned to the lobby) and movement (the match's
 * traits and walled edge, as modifiers on the interior step).
 *
 * The server decides everything; this only reports where the player stands and obeys.
 * Started by `useMatchPlay()` from MatchLayer, which is mounted exactly while the
 * player is in a world with a game.
 */

/** How often the ring is checked. */
const RING_POLL_MS = 250
/** Alone in the pool this long: offer "Play now with NPCs". */
const ALONE_MS = 3000
/** If the lobby disagrees with where we stand for this long, say it again (a lost message). */
const RESEND_MS = 2500
const TOAST_MS = 3800

export interface PlayToast { id: number; text: string; team?: number; until: number }

interface PlayState {
  /** Standing in the lobby's ring right now. */
  inRing: boolean
  /** Queued with nobody else in the pool for a few seconds. */
  alone: boolean
  toasts: PlayToast[]
  /** What this player answered on the results screen (null = not yet). */
  again: boolean | null
  /** While playing: out of bounds by the game's own boxes, and since when (performance.now()). */
  oob: { kind: 'arena' | 'keep-out'; since: number } | null
  /** The lobby sheet (behind the chip) is open. A match being found closes it. */
  sheet: boolean
}

const EMPTY: PlayState = { inRing: false, alone: false, toasts: [], again: null, oob: null, sheet: false }
export const usePlayStore = create<PlayState>(() => ({ ...EMPTY }))

let toastId = 0
export function playToast(text: string, team?: number): void {
  const now = performance.now()
  const t: PlayToast = { id: ++toastId, text, team, until: now + TOAST_MS }
  usePlayStore.setState((s) => ({ toasts: [...s.toasts.filter((x) => x.until > now), t].slice(-3) }))
  setTimeout(() => usePlayStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), TOAST_MS + 50)
}

/** Is the point inside the ring (a short cylinder standing on the lobby floor)? */
export function inRing(game: Game | null | undefined, x: number, y: number, z: number): boolean {
  const r = game?.lobby?.ring
  if (!r) return false
  const dx = x - r.at[0], dz = z - r.at[2]
  return dx * dx + dz * dz <= r.radius * r.radius && y >= r.at[1] - 1 && y <= r.at[1] + 3
}

/** A match's movement rules as step modifiers (traits always; the box only when the edge is a wall). */
export function matchMods(game: Game): InteriorMods {
  const t = game.settings.traits
  return { speedMul: t.speedMul, gravityMul: t.gravityMul, fly: t.fly, ...(game.settings.edge === 'wall' && game.arena ? { wall: boundsOf(game.arena) } : {}) }
}

/**
 * Where the player is out of bounds, from the game's boxes: 'arena' outside the stage,
 * 'keep-out' inside a keep-out zone, null when fine. Only the kinds that count down
 * (an instant edge or zone sends you straight back: nothing to warn about).
 */
export function outOfBounds(game: Game, x: number, y: number, z: number): 'arena' | 'keep-out' | null {
  if (game.arena && game.settings.edge === 'soft' && !inBounds(boundsOf(game.arena), x, y, z)) return 'arena'
  for (const zone of game.zones) {
    if (zone.kind === 'keep-out' && zone.ret !== 'instant' && inBounds(boundsOf(zone), x, y, z)) return 'keep-out'
  }
  return null
}

const slotName = (roster: MatchSlot[], slot: number | undefined, me: number): string => {
  if (slot === me) return 'You'
  return roster.find((s) => s.slot === slot)?.name || 'Someone'
}

/** One line for an event worth a toast, or null. `me` is this player's slot. */
export function eventText(ev: MatchEvent, roster: MatchSlot[], me: number, items: { id: string; kind: string }[] = []): { text: string; team?: number } | null {
  const who = slotName(roster, ev.slot, me)
  const team = ev.team ?? roster.find((s) => s.slot === ev.slot)?.team
  const mine = ev.slot === me
  const kind = items.find((i) => i.id === ev.item)?.kind
  switch (ev.type) {
    case 'goal': return { text: `${who} reached the goal`, team }
    case 'capture': return { text: team ? `${teamName(team)} captured the flag` : `${who} captured the flag`, team }
    case 'pickup':
      if (kind === 'flag') return { text: mine ? 'You have the flag' : `${who} took the flag`, team }
      return mine ? { text: kind === 'piece' ? 'You picked up a piece' : 'Picked up', team } : null
    case 'drop': return kind === 'flag' ? { text: mine ? 'You dropped the flag' : `${who} dropped the flag`, team } : null
    case 'hill': return team ? { text: `${teamName(team)} took the hill`, team } : { text: 'The hill is open' }
    case 'piece': return { text: mine ? 'Piece placed' : `${who} placed a piece`, team }
    case 'announce': {
      const text = RULE_ANNOUNCEMENTS[ev.value ?? -1]
      return text ? { text } : null
    }
    // Being placed for a round's start is not a penalty: the countdown says it all
    case 'return': return mine && ev.why !== 'round' ? { text: 'Back to your spawn' } : null
    case 'out': return { text: mine ? 'You are out this round' : `${who} is out`, team }
    case 'leave': return mine ? null : { text: `${who} left the match`, team }
    case 'swap': return { text: ev.value === 0 ? `${who === 'You' ? 'You are' : `${who} is`} back` : `An NPC took over for ${who === 'You' ? 'you' : who}`, team }
    case 'round-end': return ev.team ? { text: `${teamName(ev.team)} takes the round`, team: ev.team } : null
    default: return null
  }
}

function currentGame(): Game | null {
  return useWorldStore.getState().meta?.game ?? null
}

/** The glue's own memory of the session (not for drawing). */
const session = { queued: false, queuedAt: 0, aloneSince: 0, inMatch: false, matchId: null as string | null }

function poll(worldId: string): void {
  const m = useMatchStore.getState()
  const game = currentGame()
  const now = performance.now()
  // Never while playing or while the results are up: the player isn't in the lobby
  const s = interiorController.state
  const was = usePlayStore.getState().oob
  const kind = game && m.playing && !m.ended && m.snap?.phase === 'playing' ? outOfBounds(game, s.x, s.y, s.z) : null
  if (kind !== (was?.kind ?? null)) usePlayStore.setState({ oob: kind ? { kind, since: now } : null })
  if (!game?.lobby || m.playing || m.ended?.you) {
    if (usePlayStore.getState().inRing || usePlayStore.getState().alone) usePlayStore.setState({ inRing: false, alone: false })
    session.aloneSince = 0
    return
  }
  const on = inRing(game, s.x, s.y, s.z)
  if (on !== usePlayStore.getState().inRing) usePlayStore.setState({ inRing: on })
  if (m.lobby?.ready) {
    const lost = !m.found && m.lobby.queued !== on && now - session.queuedAt > RESEND_MS
    if (on !== session.queued || lost) {
      session.queued = on
      session.queuedAt = now
      sendMatch(worldId, { t: 'queue', on })
    }
  }
  const alone = Boolean(m.lobby?.queued && m.lobby.pool <= 1 && !m.found)
  if (!alone) session.aloneSince = 0
  else if (!session.aloneSince) session.aloneSince = now
  const offer = alone && now - session.aloneSince >= ALONE_MS
  if (offer !== usePlayStore.getState().alone) usePlayStore.setState({ alone: offer })
}

let errorTimer: ReturnType<typeof setTimeout> | null = null

function onMessage(worldId: string, msg: MatchMessage): void {
  if (worldId !== useUniverseStore.getState().activeWorldId) return
  const game = currentGame()
  switch (msg.t) {
    case 'start': {
      // The same match again (the socket came back and we said hello): still where we stood, nothing to redo
      const same = session.inMatch && session.matchId === msg.matchId
      session.inMatch = true
      session.matchId = msg.matchId
      session.queued = false
      interiorController.mods = game ? matchMods(game) : null
      if (same) break
      interiorController.hold = true
      // The server already spread the team across its spawn: no scatter
      interiorController.arriveAt({ x: msg.spawn[0], y: msg.spawn[1], z: msg.spawn[2] }, { x: msg.face[0], z: msg.face[2] }, 0)
      useSheetStore.getState().close()
      usePlayStore.setState({ toasts: [], again: null, inRing: false, alone: false, oob: null, sheet: false })
      break
    }
    case 'lobby': {
      // The server only sends the lobby to players who are not in a match. If we think we are
      // in one (the connection was gone long enough for our slot to be given away, or the
      // match ended meanwhile) and no `start` or snapshot follows, we are out: back to the lobby.
      const p = useMatchStore.getState().playing
      if (!p || !session.inMatch) break
      const at = performance.now()
      setTimeout(() => {
        const m = useMatchStore.getState()
        if (m.playing?.matchId !== p.matchId || m.snapAt > at || m.ended?.matchId === p.matchId) return
        if (worldId !== useUniverseStore.getState().activeWorldId) return
        session.inMatch = false
        session.matchId = null
        interiorController.mods = null
        interiorController.hold = false
        setPresenceInstance(null)
        useMatchStore.setState({ playing: null, snap: null, prevSnap: null })
        usePlayStore.setState({ oob: null, toasts: [] })
        const g = currentGame()
        if (g?.lobby) interiorController.arriveAt({ x: g.lobby.arrival[0], y: g.lobby.arrival[1], z: g.lobby.arrival[2] }, g.arena ? { x: g.arena.at[0], z: g.arena.at[2] } : undefined, 1)
        playToast(m.lobby?.rejoin === p.matchId ? 'You lost your connection. Your match is still on: rejoin from the 🎯 chip.' : 'You lost your connection to the match.')
      }, 2500)
      break
    }
    case 'found':
      usePlayStore.setState({ sheet: false })
      break
    case 'move':
      if (useMatchStore.getState().playing?.matchId !== msg.matchId) break
      interiorController.arriveAt({ x: msg.to[0], y: msg.to[1], z: msg.to[2] }, msg.face ? { x: msg.face[0], z: msg.face[2] } : undefined, 0)
      break
    case 'snap': {
      const p = useMatchStore.getState().playing
      if (!p || p.matchId !== msg.matchId) break
      // The referee doesn't stop anyone walking off early: stand still until the round is on
      interiorController.hold = msg.phase === 'countdown' || msg.phase === 'break'
      for (const ev of msg.events) {
        const t = eventText(ev, p.roster, p.you.slot, msg.items)
        if (t) playToast(t.text, t.team)
      }
      break
    }
    case 'end':
      interiorController.hold = false
      break
    case 'cancel':
      playToast('Someone stepped out. Still looking…')
      break
    case 'back': {
      interiorController.mods = null
      interiorController.hold = false
      // Only a player's body goes back (someone watching never left the lobby)
      const mine = session.inMatch || Boolean(useMatchStore.getState().ended?.you)
      session.inMatch = false
      session.matchId = null
      session.queued = false
      if (mine) {
        interiorController.arriveAt({ x: msg.to[0], y: msg.to[1], z: msg.to[2] }, game?.arena ? { x: game.arena.at[0], z: game.arena.at[2] } : undefined, 1)
        // The results close when the server puts the player back
        if (useMatchStore.getState().ended?.you) useMatchStore.setState({ ended: null })
      }
      usePlayStore.setState({ again: null, toasts: [], oob: null })
      break
    }
    case 'error':
      if (errorTimer) clearTimeout(errorTimer)
      errorTimer = setTimeout(() => useMatchStore.setState({ error: null }), 5000)
      break
    default:
      break
  }
}

/** Answer the results screen: play again together, or back to the lobby. */
export function answerAgain(yes: boolean): void {
  const worldId = useMatchStore.getState().worldId ?? useUniverseStore.getState().activeWorldId
  if (!worldId) return
  usePlayStore.setState({ again: yes })
  sendMatch(worldId, { t: 'again', yes })
}

/**
 * Run the session glue while mounted: hello (on entering, on every socket open, and
 * when the game's version changes), the ring poll, the message handler, and a clean
 * slate on leaving the world.
 */
export function useMatchPlay(): void {
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const loaded = useWorldStore((s) => s.loaded)
  const version = useWorldStore((s) => s.meta?.game?.version)

  useEffect(() => {
    if (!worldId) return
    const off = onMatch(onMessage)
    const timer = setInterval(() => poll(worldId), RING_POLL_MS)
    return () => {
      off()
      clearInterval(timer)
      interiorController.mods = null
      interiorController.hold = false
      session.queued = false
      session.inMatch = false
      session.matchId = null
      session.aloneSince = 0
      usePlayStore.setState({ ...EMPTY })
      useMatchStore.getState().reset()
    }
  }, [worldId])

  useEffect(() => {
    if (!worldId || !loaded || version === undefined) return
    const hello = () => {
      // The server starts from scratch for this socket: the ring poll re-sends where we stand
      session.queued = false
      sendMatch(worldId, { t: 'hello' })
    }
    hello()
    return onMatchSender(hello)
  }, [worldId, loaded, version])
}

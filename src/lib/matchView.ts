import { create } from 'zustand'
import type { Game } from '@aweborn/shared/game'
import { MATCH_SIM_VERSION, MATCH_TICK_MS, initMatch, spawnPoint, stepMatch, unpackSamples, type MatchEvent, type MatchFrame, type MatchPhase, type MatchRecord, type MatchSlot, type MatchState } from '@aweborn/shared/match'
import type { MatchSummary, SnapItem, SnapPlayer } from '@aweborn/shared/match-protocol'
import { AUTH_URL } from './player'
import { useMatchStore, watchMatch } from './match'

/**
 * Seeing a match you are not controlling (Phase 10): the watched match's snapshots drawn
 * between ticks, and replays played back on a local clock. Everything that draws a match
 * (the bodies in the arena, the hologram, the mini-map, the ghost camera) asks
 * `currentView()` what to draw right now, so live and recorded matches look the same.
 *
 * A replay's positions are the recorded samples. Its score, clock, items and who is out
 * come from running the record through the referee up to the tick on view (`exactAt`:
 * the same step the server ran, so it is what happened). A record made by another
 * version of the referee is followed through its events instead (see `buildReplay`).
 */

export interface ViewFrame { players: SnapPlayer[]; items: SnapItem[]; hill: number }

/** Score line for the strip above the view (live: from the snap; replay: rebuilt from events). */
export interface ViewScore { phase: MatchPhase; round: number; left: number; scores: number[]; rounds: number[] }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
/** Farther than this between two samples is a teleport (a return to spawn), not a walk: don't glide. */
const JUMP_M = 6

// ── Live: between the last two snapshots ───────────────────────────────

/** The match being played or watched, drawn between `prevSnap` and `snap` (one tick behind, so it never has to guess ahead). */
export function liveFrame(now = performance.now()): ViewFrame | null {
  const { snap, prevSnap, snapAt } = useMatchStore.getState()
  if (!snap) return null
  if (!prevSnap) return snap
  const a = clamp((now - snapAt) / MATCH_TICK_MS, 0, 1)
  const mix = <T extends { x: number; y: number; z: number }>(to: T, from: T | undefined): T => {
    if (!from || Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > JUMP_M) return to
    return { ...to, x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a, z: from.z + (to.z - from.z) * a }
  }
  return {
    players: snap.players.map((p) => mix(p, prevSnap.players.find((o) => o.slot === p.slot))),
    items: snap.items.map((i) => mix(i, prevSnap.items.find((o) => o.id === i.id))),
    hill: snap.hill,
  }
}

// ── Replays ────────────────────────────────────────────────────────────

interface Track { t: number[]; x: number[]; y: number[]; z: number[] }
interface ScoreStep extends ViewScore { tick: number; roundStart: number; hill: number; out: number[] }
interface ItemStep { tick: number; heldBy: number | null; x: number; y: number; z: number; shown: boolean }

/** An event worth a marker on the scrub bar. */
export interface ReplayMark { tick: number; type: MatchEvent['type']; team?: number; slot?: number; label: string; icon: string }

export interface Replay {
  id: string
  record: MatchRecord
  game: Game
  roster: MatchSlot[]
  /** The last tick anything happened on. */
  last: number
  tracks: Map<number, Track>
  steps: ScoreStep[]
  items: Map<string, { kind: SnapItem['kind']; team?: number; steps: ItemStep[] }>
  marks: ReplayMark[]
  /** The referee's own state, tick by tick, when this build can run the record (null: follow the events). */
  exact: { frames: Map<number, MatchFrame>; keys: MatchState[]; cur: MatchState } | null
}

/** A referee state is kept every this many ticks, so a scrub steps at most this far. */
const KEY_TICKS = 50

/** The referee's state at a whole tick: stepped from the nearest kept state. Null if this record can't be run here. */
function exactAt(r: Replay, tick: number): MatchState | null {
  const x = r.exact
  if (!x) return null
  const want = clamp(Math.floor(tick), 0, r.last)
  try {
    let st = x.cur
    if (st.tick > want || want - st.tick > KEY_TICKS) {
      // Jumped: start from the last kept state at or before the tick (keeping more on the way if it is far)
      st = x.keys[Math.min(x.keys.length - 1, Math.floor(want / KEY_TICKS))]
    }
    while (st.tick < want && st.phase !== 'finished') {
      const f = x.frames.get(st.tick + 1)
      st = stepMatch(r.record.setup, st, f ? unpackSamples(f.s) : [], f?.c ?? []).state
      if (st.tick % KEY_TICKS === 0 && st.tick / KEY_TICKS === x.keys.length) x.keys.push(st)
    }
    x.cur = st
    return st
  } catch {
    r.exact = null
    return null
  }
}

/** Index of the last entry at or before `t` (-1 if none). `ticks` ascends. */
function lastAtOrBefore(ticks: readonly number[], t: number): number {
  let lo = 0
  let hi = ticks.length - 1
  let at = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ticks[mid] <= t) { at = mid; lo = mid + 1 } else hi = mid - 1
  }
  return at
}

/** Where a slot is at tick `t`: its latest sample at or before it, eased toward the next. */
function trackAt(r: Replay, slot: number, t: number): { x: number; y: number; z: number } {
  const k = r.tracks.get(slot)
  if (!k || k.t.length === 0) {
    const [x, y, z] = spawnPoint(r.record.setup, slot)
    return { x, y, z }
  }
  const i = Math.max(0, lastAtOrBefore(k.t, t))
  const n = i + 1
  if (n >= k.t.length || t <= k.t[i]) return { x: k.x[i], y: k.y[i], z: k.z[i] }
  const gap = k.t[n] - k.t[i]
  const far = Math.hypot(k.x[n] - k.x[i], k.y[n] - k.y[i], k.z[n] - k.z[i])
  // A long silence (signal lost) or a jump (sent back to spawn): hold, then snap
  if (gap > 10 || far > JUMP_M) return { x: k.x[i], y: k.y[i], z: k.z[i] }
  const a = (t - k.t[i]) / gap
  return { x: k.x[i] + (k.x[n] - k.x[i]) * a, y: k.y[i] + (k.y[n] - k.y[i]) * a, z: k.z[i] + (k.z[n] - k.z[i]) * a }
}

/**
 * The scoreboard over time, from the events alone. The contract doesn't say whether a
 * `score` event's `value` is the points added or the team's new score, nor whether a
 * `goal` is followed by a `score`, so all four readings are tried and the one that ends
 * on the recorded result is used (points added, goals not counted, when nothing settles it).
 */
function scoreSteps(record: MatchRecord, absolute: boolean, goals: boolean): ScoreStep[] {
  const teams = Math.max(1, record.setup.game.settings.teams)
  const first = record.events.find((e) => e.type === 'round-start')
  let cur: ScoreStep = { tick: 0, phase: 'countdown', round: 1, left: first ? first.tick : 0, scores: Array(teams).fill(0), rounds: Array(teams).fill(0), roundStart: first ? first.tick : 0, hill: 0, out: [] }
  const steps = [cur]
  const gone = new Set<number>()
  for (const e of record.events) {
    const next: ScoreStep = { ...cur, tick: e.tick, scores: [...cur.scores], rounds: [...cur.rounds], out: [...cur.out] }
    const ti = (e.team ?? 0) - 1
    if (e.type === 'round-start') {
      next.phase = 'playing'
      next.round = e.value ?? (cur.phase === 'break' ? cur.round + 1 : cur.round)
      next.scores = Array(teams).fill(0)
      next.roundStart = e.tick
      next.hill = 0
      next.out = [...gone]
    } else if (e.type === 'score' && ti >= 0 && ti < teams) {
      next.scores[ti] = absolute ? (e.value ?? next.scores[ti]) : next.scores[ti] + (e.value ?? 1)
    } else if (e.type === 'goal' && goals && ti >= 0 && ti < teams) {
      next.scores[ti] += e.value ?? 1
    } else if (e.type === 'round-end') {
      next.phase = 'break'
      if (ti >= 0 && ti < teams) next.rounds[ti] += 1
    } else if (e.type === 'match-end') {
      next.phase = 'finished'
    } else if (e.type === 'hill') {
      next.hill = e.team ?? 0
    } else if (e.type === 'out' && e.slot !== undefined) {
      if (!next.out.includes(e.slot)) next.out.push(e.slot)
    } else if (e.type === 'leave' && e.slot !== undefined) {
      gone.add(e.slot)
      if (!next.out.includes(e.slot)) next.out.push(e.slot)
    } else continue
    steps.push(next)
    cur = next
  }
  return steps
}

const sameScores = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i])

const EVENT_ICON: Partial<Record<MatchEvent['type'], string>> = {
  'round-start': '▶', 'round-end': '■', 'match-end': '🏁', goal: '🥅', score: '＋', capture: '⚑', 'out-of-bounds': '↩', 'keep-out': '⛔', out: '✕', pickup: '◆', leave: '🚪', swap: '⇄', hill: '⛰',
}

/** Team names live in GamePanel (`teamName`); labels here take one so this file stays free of components. */
export type TeamNamer = (team: number) => string

function markLabel(e: MatchEvent, roster: readonly MatchSlot[], team: TeamNamer): string {
  const who = e.slot !== undefined ? (roster.find((s) => s.slot === e.slot)?.name ?? `Player ${e.slot + 1}`) : null
  const side = e.team ? team(e.team) : null
  switch (e.type) {
    case 'round-start': return 'Round starts'
    case 'round-end': return side ? `${side} takes the round` : 'Round over'
    case 'match-end': return 'Match over'
    case 'goal': return `${who ?? side ?? 'Someone'} reaches the goal`
    case 'score': return `${side ?? who ?? 'Someone'} scores`
    case 'capture': return `${who ?? side ?? 'Someone'} captures the flag`
    case 'out-of-bounds': return `${who ?? 'Someone'} out of bounds`
    case 'keep-out': return `${who ?? 'Someone'} in a keep-out`
    case 'out': return `${who ?? 'Someone'} is out`
    case 'pickup': return `${who ?? 'Someone'} picks up`
    case 'leave': return `${who ?? 'Someone'} leaves`
    case 'swap': return `${who ?? 'A player'} swapped`
    case 'hill': return side ? `${side} holds the hill` : 'The hill is open'
    default: return e.type
  }
}

/** Events that get a marker. Chatty ones (per-second scoring, every pickup) are left out when there are many. */
function marksOf(record: MatchRecord, team: TeamNamer): ReplayMark[] {
  const count = (t: MatchEvent['type']) => record.events.reduce((n, e) => n + (e.type === t ? 1 : 0), 0)
  const always: MatchEvent['type'][] = ['round-start', 'round-end', 'match-end', 'goal', 'capture', 'out-of-bounds', 'out', 'leave']
  const ifFew: MatchEvent['type'][] = ['score', 'pickup', 'hill', 'keep-out', 'swap']
  const keep = new Set<MatchEvent['type']>([...always, ...ifFew.filter((t) => count(t) <= 24)])
  return record.events
    .filter((e) => keep.has(e.type))
    .slice(0, 200)
    .map((e) => ({ tick: e.tick, type: e.type, team: e.team, slot: e.slot, label: markLabel(e, record.setup.slots, team), icon: EVENT_ICON[e.type] ?? '•' }))
}

/**
 * Turn a record into something that can be asked "what did tick t look like?".
 *
 * The event-following below is the fallback for records this build's referee can't run
 * (another sim version). Items there: the record holds no item positions, only events,
 * so an item appears the first time an event places it: carried from its
 * `pickup` (drawn above the carrier; that spot is remembered as its home), set down where
 * its carrier stood on `drop` / `piece` (or at the event's `to`), back home on `capture`.
 * Pickups of the collect game vanish when taken, so they are never drawn in a replay.
 */
export function buildReplay(record: MatchRecord, team: TeamNamer = (n) => `Team ${n}`): Replay {
  const tracks = new Map<number, Track>()
  for (const f of record.frames) {
    for (let i = 0; i + 3 < f.s.length; i += 4) {
      let k = tracks.get(f.s[i])
      if (!k) tracks.set(f.s[i], (k = { t: [], x: [], y: [], z: [] }))
      k.t.push(f.t)
      k.x.push(f.s[i + 1] / 100)
      k.y.push(f.s[i + 2] / 100)
      k.z.push(f.s[i + 3] / 100)
    }
  }
  const want = record.result?.scores
  const readings: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]]
  let steps = scoreSteps(record, false, false)
  if (want) {
    for (const [absolute, goals] of readings) {
      const s = scoreSteps(record, absolute, goals)
      // Compare the last round's score before the end (the end itself changes nothing)
      if (sameScores(s[s.length - 1].scores, want)) { steps = s; break }
    }
    const end = steps[steps.length - 1]
    if (end.phase === 'finished' && record.result) end.rounds = [...record.result.rounds]
  }
  const lastFrame = record.frames.length ? record.frames[record.frames.length - 1].t : 0
  const lastEvent = record.events.length ? record.events[record.events.length - 1].tick : 0
  const r: Replay = {
    id: record.setup.matchId,
    record,
    game: record.setup.game,
    roster: record.setup.slots,
    last: Math.max(1, lastFrame, lastEvent, record.result?.ticks ?? 0),
    tracks,
    steps,
    items: new Map(),
    marks: marksOf(record, team),
    exact: null,
  }
  if (record.setup.simVersion === MATCH_SIM_VERSION) {
    try {
      const first = initMatch(record.setup)
      r.exact = { frames: new Map(record.frames.map((f) => [f.t, f])), keys: [first], cur: first }
    } catch {
      r.exact = null
    }
  }
  // Items, followed through the events that move them
  const template = record.setup.game.template
  const kind: SnapItem['kind'] = template === 'capture-the-flag' ? 'flag' : template === 'build-together' ? 'piece' : 'pickup'
  const home = new Map<string, { x: number; y: number; z: number }>()
  const held = new Map<number, string>()
  const put = (id: string, step: ItemStep) => {
    let it = r.items.get(id)
    if (!it) {
      const n = /(\d+)\D*$/.exec(id)
      r.items.set(id, (it = { kind, team: kind === 'flag' && n ? Number(n[1]) : undefined, steps: [] }))
    }
    it.steps.push(step)
  }
  for (const e of record.events) {
    const at = e.to ? { x: e.to[0], y: e.to[1], z: e.to[2] } : e.slot !== undefined ? trackAt(r, e.slot, e.tick) : null
    if (e.type === 'pickup' && e.item && e.slot !== undefined) {
      if (kind === 'pickup') continue
      if (!home.has(e.item) && at) home.set(e.item, at)
      held.set(e.slot, e.item)
      put(e.item, { tick: e.tick, heldBy: e.slot, x: at?.x ?? 0, y: at?.y ?? 0, z: at?.z ?? 0, shown: true })
    } else if (e.type === 'drop' || e.type === 'piece' || e.type === 'capture') {
      const id = e.item ?? (e.slot !== undefined ? held.get(e.slot) : undefined)
      if (!id || kind === 'pickup') continue
      if (e.slot !== undefined) held.delete(e.slot)
      const where = e.type === 'capture' ? (home.get(id) ?? at) : at
      if (where) put(id, { tick: e.tick, heldBy: null, ...where, shown: true })
    }
  }
  return r
}

export function replayScoreAt(r: Replay, t: number): ViewScore {
  const st = exactAt(r, t)
  if (st) return { phase: st.phase, round: st.round, left: st.left, scores: st.scores, rounds: st.rounds }
  const s = r.steps[Math.max(0, lastAtOrBefore(r.steps.map((x) => x.tick), t))]
  const roundTicks = (r.game.settings.roundSeconds * 1000) / MATCH_TICK_MS
  const left = s.phase === 'playing' ? Math.max(0, roundTicks - (t - s.roundStart)) : s.phase === 'countdown' ? Math.max(0, s.roundStart - t) : 0
  return { phase: s.phase, round: s.round, left, scores: s.scores, rounds: s.rounds }
}

export function replayFrameAt(r: Replay, t: number): ViewFrame {
  const st = exactAt(r, t)
  if (st) {
    return {
      players: st.players.map((p) => ({ slot: p.slot, ...trackAt(r, p.slot, t), out: p.out || p.left, carrying: p.carrying })),
      items: st.items.filter((i) => i.active).map((i) => ({ id: i.id, kind: i.kind, team: i.team, x: i.x, y: i.y, z: i.z, heldBy: i.heldBy })),
      hill: st.hill,
    }
  }
  const s = r.steps[Math.max(0, lastAtOrBefore(r.steps.map((x) => x.tick), t))]
  const carrying = new Map<number, string>()
  const items: SnapItem[] = []
  for (const [id, it] of r.items) {
    const i = lastAtOrBefore(it.steps.map((x) => x.tick), t)
    if (i < 0) continue
    const st = it.steps[i]
    if (!st.shown) continue
    if (st.heldBy !== null) carrying.set(st.heldBy, id)
    items.push({ id, kind: it.kind, team: it.team, x: st.x, y: st.y, z: st.z, heldBy: st.heldBy })
  }
  const players = r.roster.map((slot) => ({ slot: slot.slot, ...trackAt(r, slot.slot, t), out: s.out.includes(slot.slot), carrying: carrying.get(slot.slot) ?? null }))
  return { players, items, hill: s.hill }
}

// ── The view store: the sheet, the lists, the replay being played, the ghost ──

export type WatchTab = 'live' | 'finished' | 'mine'

interface ViewState {
  sheet: boolean
  tab: WatchTab
  /** The world's finished matches (GET /api/match/world), and which world they are for. */
  finished: MatchSummary[] | null
  finishedFor: string | null
  /** This account's characters' replays (GET /api/player/replays). */
  mine: MatchSummary[] | null
  listError: string | null
  /** The game the watched match runs (its own version, from its record); the world's current game until that arrives. */
  watchGame: Game | null
  replay: Replay | null
  /** A replay being fetched (its id), and what went wrong with the last fetch. */
  loading: string | null
  replayError: string | null
  playing: boolean
  speed: 1 | 2 | 4
  /** The replay clock in whole ticks, for the screen (the drawing reads `replayClock.t`). */
  tick: number
  /** The ghost camera is flying (mirrors `ghostCam.active`), and the slot it follows. */
  ghost: boolean
  follow: number | null
}

export const useViewStore = create<ViewState>(() => ({
  sheet: false, tab: 'live', finished: null, finishedFor: null, mine: null, listError: null, watchGame: null,
  replay: null, loading: null, replayError: null, playing: false, speed: 1, tick: 0, ghost: false, follow: null,
}))

/** The replay's clock, in ticks (fractional). Advanced by `tickReplay`, read every frame by whatever draws. */
export const replayClock = { t: 0 }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${AUTH_URL}${path}`, { credentials: 'include' })
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null
  if (!res.ok || !data) throw new Error(data?.message ?? 'Could not load that. Try again in a moment.')
  return data
}

export const fetchRecord = (id: string) => getJson<{ record: MatchRecord }>(`/api/match/record?id=${encodeURIComponent(id)}`).then((d) => d.record)

/** Load the lists behind the Finished and Mine tabs. */
export function loadWatchLists(worldId: string | null): void {
  useViewStore.setState({ listError: null })
  if (worldId) {
    getJson<{ matches: MatchSummary[] }>(`/api/match/world?worldId=${encodeURIComponent(worldId)}`)
      .then((d) => useViewStore.setState({ finished: d.matches ?? [], finishedFor: worldId }))
      .catch((e: Error) => useViewStore.setState({ finished: [], finishedFor: worldId, listError: e.message }))
  }
  getJson<{ matches: MatchSummary[] }>(`/api/player/replays`)
    .then((d) => useViewStore.setState({ mine: d.matches ?? [] }))
    .catch((e: Error) => useViewStore.setState({ mine: [], listError: e.message }))
}

/**
 * Tune into a running match. The snapshots don't carry names or teams, so the roster
 * (and the exact game version) come from the match's record, which the server serves
 * for running matches too. Until it arrives the bodies are drawn unnamed.
 */
export function tuneIn(worldId: string, matchId: string): void {
  closeReplay()
  watchMatch(worldId, matchId)
  useMatchStore.setState({ watchRoster: null })
  useViewStore.setState({ watchGame: null })
  const load = (triesLeft: number) => {
    fetchRecord(matchId)
      .then((record) => {
        if (useMatchStore.getState().watching !== matchId) return
        useMatchStore.setState({ watchRoster: record.setup.slots })
        useViewStore.setState({ watchGame: record.setup.game })
      })
      .catch(() => {
        if (triesLeft > 0 && useMatchStore.getState().watching === matchId) setTimeout(() => load(triesLeft - 1), 2000)
      })
  }
  load(2)
}

export function tuneOut(worldId: string | null): void {
  const m = useMatchStore.getState()
  if (worldId && m.watching) watchMatch(worldId, null)
  // The result of a match that was only watched is ours to dismiss (a player's own results belong to the play layer)
  useMatchStore.setState({ watching: null, watchRoster: null, ...(m.ended && !m.ended.you ? { ended: null } : {}) })
  useViewStore.setState({ watchGame: null })
  if (!useViewStore.getState().replay) stopGhost()
}

/** Fetch a record and start playing it from the beginning. Stops watching: one view at a time. */
export async function openReplay(id: string, worldId: string | null, team?: TeamNamer): Promise<void> {
  if (useViewStore.getState().loading === id) return
  useViewStore.setState({ loading: id, replayError: null })
  try {
    const record = await fetchRecord(id)
    if (useViewStore.getState().loading !== id) return
    if (!record?.setup?.game || !Array.isArray(record.frames)) throw new Error('That replay could not be read.')
    if (useMatchStore.getState().watching || useMatchStore.getState().ended) tuneOut(worldId)
    stopGhost()
    replayClock.t = 0
    useViewStore.setState({ replay: buildReplay(record, team), loading: null, playing: true, speed: 1, tick: 0, sheet: false })
  } catch (e) {
    useViewStore.setState({ loading: null, replayError: e instanceof Error ? e.message : 'That replay could not be loaded.' })
  }
}

export function closeReplay(): void {
  if (!useViewStore.getState().replay && !useViewStore.getState().loading) return
  stopGhost()
  replayClock.t = 0
  useViewStore.setState({ replay: null, loading: null, playing: false, tick: 0 })
}

export function seekReplay(tick: number): void {
  const r = useViewStore.getState().replay
  if (!r) return
  replayClock.t = clamp(tick, 0, r.last)
  useViewStore.setState({ tick: Math.floor(replayClock.t) })
}

export function playReplay(on: boolean): void {
  const r = useViewStore.getState().replay
  if (!r) return
  // Play from the end starts over
  if (on && replayClock.t >= r.last) replayClock.t = 0
  useViewStore.setState({ playing: on, tick: Math.floor(replayClock.t) })
}

/** Advance the replay clock by a frame's time. Called once per animation frame while a replay is open. */
export function tickReplay(dtMs: number): void {
  const v = useViewStore.getState()
  if (!v.replay || !v.playing) return
  replayClock.t = Math.min(v.replay.last, replayClock.t + (Math.min(dtMs, 250) / MATCH_TICK_MS) * v.speed)
  const done = replayClock.t >= v.replay.last
  const whole = Math.floor(replayClock.t)
  // The screen follows at a few updates a second; the drawing reads the clock itself
  if (done || Math.abs(whole - v.tick) >= 2) useViewStore.setState({ tick: whole, ...(done ? { playing: false } : {}) })
}

/** Ghost off (the camera module watches this flag; see GhostCamera.ts). */
export function stopGhost(): void {
  if (useViewStore.getState().ghost) useViewStore.setState({ ghost: false, follow: null })
}

// ── What to draw right now ─────────────────────────────────────────────

export interface CurrentView {
  mode: 'play' | 'watch' | 'replay'
  /** The world the match is (or was) in. */
  worldId: string | null
  matchId: string
  roster: readonly MatchSlot[] | null
  game: Game | null
  frame: () => ViewFrame | null
  score: () => ViewScore | null
}

let cached: { at: number; key: unknown; frame: ViewFrame | null } = { at: -1, key: null, frame: null }
/** Several things draw the same frame each animation frame (bodies, hologram, camera): work it out once. */
function once(key: unknown, make: () => ViewFrame | null): ViewFrame | null {
  const now = performance.now()
  if (cached.key === key && now - cached.at < 4) return cached.frame
  cached = { at: now, key, frame: make() }
  return cached.frame
}

const liveScore = (): ViewScore | null => {
  const s = useMatchStore.getState().snap
  return s ? { phase: s.phase, round: s.round, left: s.left, scores: s.scores, rounds: s.rounds } : null
}

/** The match on view: a replay if one is open, else the match being watched, else the one being played. */
export function currentView(worldGame: Game | null): CurrentView | null {
  const v = useViewStore.getState()
  if (v.replay) {
    const r = v.replay
    return { mode: 'replay', worldId: r.record.setup.worldId, matchId: r.id, roster: r.roster, game: r.game, frame: () => once(r, () => replayFrameAt(r, replayClock.t)), score: () => replayScoreAt(r, replayClock.t) }
  }
  const m = useMatchStore.getState()
  if (m.watching) return { mode: 'watch', worldId: m.worldId, matchId: m.watching, roster: m.watchRoster, game: v.watchGame ?? worldGame, frame: () => once(m.snap, () => liveFrame()), score: liveScore }
  if (m.playing) return { mode: 'play', worldId: m.worldId, matchId: m.playing.matchId, roster: m.playing.roster, game: worldGame, frame: () => once(m.snap, () => liveFrame()), score: liveScore }
  return null
}

// ── Small formatters shared by the sheet and the strip ─────────────────

/** Ticks → "m:ss". */
export function clockOf(ticks: number): string {
  const s = Math.max(0, Math.round((ticks * MATCH_TICK_MS) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "just now", "3 min ago", "2 h ago", then the date. */
export function agoOf(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

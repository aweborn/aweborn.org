import {
  NPC_NAMES, RULE_ANNOUNCEMENTS,
  type Game, type GameRule, type GameZone, type NpcBehavior, type RuleAction, type RuleActionType, type RuleCondition,
  type RuleEvent, type RuleOp, type RuleTarget, type RuleValue, type ZoneKind,
} from '@aweborn/shared/game'

/**
 * Plain words for everything the Game tab shows (Phase 10): team names, zone names, and
 * the labels and sentences of the When ▸ If ▸ Do cards. Pure, so the sentence a creator
 * reads is the same wherever a card is shown.
 */

const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Gold', 'Violet', 'Teal', 'Orange', 'Pink']
export const teamName = (n: number) => TEAM_NAMES[n - 1] ?? `Team ${n}`

export const ZONE_LABEL: Record<ZoneKind, string> = { spawn: 'Spawn', 'keep-out': 'Keep-out', goal: 'Goal' }

/** A zone's name in lists and sentences: "Red spawn", "Goal", "Goal 2" (numbered when there are several alike). */
export function zoneName(g: Game, z: GameZone): string {
  if (z.kind === 'spawn') return g.settings.teams > 1 ? `${teamName(z.team ?? 1)} spawn` : 'Spawn'
  const alike = g.zones.filter((x) => x.kind === z.kind)
  const base = z.kind === 'goal' && z.team ? `${teamName(z.team)} goal` : ZONE_LABEL[z.kind]
  return alike.length > 1 ? `${base} ${alike.indexOf(z) + 1}` : base
}

// ── NPCs ───────────────────────────────────────────────────────────────

export const NPC_BEHAVIOR_LABEL: Record<NpcBehavior, string> = { auto: 'Auto', chase: 'Chase', guard: 'Guard', fetch: 'Fetch', follow: 'Follow' }
export const NPC_BEHAVIOR_BLURB: Record<NpcBehavior, string> = {
  auto: 'Plays the way that suits this kind of game.',
  chase: 'Runs after the nearest player on another team.',
  guard: 'Stays close to its own base or goal.',
  fetch: 'Goes for flags and things to collect.',
  follow: 'Sticks with a teammate.',
}
export const NPC_LEVEL_LABEL = ['', 'Gentle', 'Easy', 'Steady', 'Quick', 'Sharp']

/** The first name on the list no NPC on the roster has yet. */
export const freeNpcName = (g: Game): string | undefined => NPC_NAMES.find((n) => !g.npcRoster.some((x) => x.name === n))

// ── Cards ──────────────────────────────────────────────────────────────

export const EVENT_LABEL: Record<RuleEvent, string> = {
  'match-start': 'The match starts',
  'round-start': 'A round starts',
  'every-seconds': 'Every few seconds',
  'seconds-left': 'Time is nearly up',
  'enter-zone': 'A player enters a zone',
  'leave-zone': 'A player leaves a zone',
  'score': 'A team scores',
  'out-of-bounds': 'A player leaves the arena',
  'pickup': 'A player picks something up',
  'capture': 'A flag is captured',
}
export const VALUE_LABEL: Record<RuleValue, string> = {
  'score': 'their score',
  'other-score': 'the other side’s score',
  'seconds-left': 'seconds left',
  'round': 'the round',
  'players': 'players',
  'var-a': 'counter A',
  'var-b': 'counter B',
  'var-c': 'counter C',
}
export const OP_LABEL: Record<RuleOp, string> = { '<': '<', '<=': '≤', '=': '=', '>=': '≥', '>': '>' }
export const ACTION_LABEL: Record<RuleActionType, string> = {
  'add-score': 'Add points',
  'add-seconds': 'Add time',
  'return-to-spawn': 'Send back to spawn',
  'end-round': 'End the round',
  'set-var': 'Set a counter',
  'add-var': 'Add to a counter',
  'announce': 'Announce',
}
export const TARGET_LABEL: Record<RuleTarget, string> = { actor: 'Their team', others: 'Other teams', all: 'Everyone' }
export const VAR_LABEL = { 'var-a': 'A', 'var-b': 'B', 'var-c': 'C' } as const

/** Which actions are about someone (the rest are about the whole match). */
export const actionHasTarget = (t: RuleActionType) => t === 'add-score' || t === 'return-to-spawn'
export const actionHasAmount = (t: RuleActionType) => t === 'add-score' || t === 'add-seconds' || t === 'set-var' || t === 'add-var'
export const eventHasZone = (e: RuleEvent) => e === 'enter-zone' || e === 'leave-zone'
export const eventHasSeconds = (e: RuleEvent) => e === 'every-seconds' || e === 'seconds-left'

const plural = (n: number, one: string) => `${Math.abs(n)} ${one}${Math.abs(n) === 1 ? '' : 's'}`

export function whenText(g: Game, w: GameRule['when']): string {
  const zone = w.zone ? g.zones.find((z) => z.id === w.zone) : undefined
  const where = zone ? zoneName(g, zone) : 'any zone'
  switch (w.event) {
    case 'match-start': return 'the match starts'
    case 'round-start': return 'a round starts'
    case 'every-seconds': return (w.seconds ?? 30) === 1 ? 'every second passes' : `every ${w.seconds ?? 30} seconds pass`
    case 'seconds-left': return `${plural(w.seconds ?? 30, 'second')} ${(w.seconds ?? 30) === 1 ? 'is' : 'are'} left`
    case 'enter-zone': return `a player enters ${where}`
    case 'leave-zone': return `a player leaves ${where}`
    case 'score': return 'a team scores'
    case 'out-of-bounds': return 'a player leaves the arena'
    case 'pickup': return 'a player picks something up'
    case 'capture': return 'a flag is captured'
  }
}

export const ifText = (c: RuleCondition): string => `${VALUE_LABEL[c.left]} ${OP_LABEL[c.op]} ${c.right}`

export function doText(a: RuleAction): string {
  const v = a.value ?? 0
  const who = a.target ?? 'actor'
  switch (a.type) {
    case 'add-score': {
      const whom = who === 'actor' ? 'their team' : who === 'others' ? 'the other teams' : 'everyone'
      return v < 0 ? `take ${plural(v, 'point')} from ${whom}` : `add ${plural(v, 'point')} to ${whom}`
    }
    case 'add-seconds': return v < 0 ? `take ${plural(v, 'second')} off the clock` : `add ${plural(v, 'second')} to the clock`
    case 'return-to-spawn': return `send ${who === 'actor' ? 'their team' : who === 'others' ? 'the other teams' : 'everyone'} back to spawn`
    case 'end-round': return 'end the round'
    case 'set-var': return `set counter ${VAR_LABEL[a.name ?? 'var-a']} to ${v}`
    case 'add-var': return v < 0 ? `take ${Math.abs(v)} from counter ${VAR_LABEL[a.name ?? 'var-a']}` : `add ${v} to counter ${VAR_LABEL[a.name ?? 'var-a']}`
    case 'announce': return `announce “${RULE_ANNOUNCEMENTS[v] ?? RULE_ANNOUNCEMENTS[0]}”`
  }
}

/** The card as its three parts ("When …", "if …", "…"), for a line that reads When ▸ If ▸ Do. */
export function ruleParts(g: Game, r: GameRule): { when: string; if: string | null; do: string } {
  return {
    when: `When ${whenText(g, r.when)}`,
    if: r.if.length ? `if ${r.if.map(ifText).join(' and ')}` : null,
    do: r.do.map(doText).join(', then '),
  }
}

export const ruleSentence = (g: Game, r: GameRule): string => {
  const p = ruleParts(g, r)
  return [p.when, p.if, p.do].filter(Boolean).join(' ▸ ')
}

import { useEffect, useState } from 'react'
import {
  GAME_LIMITS, RULE_ACTIONS, RULE_ANNOUNCEMENTS, RULE_EVENTS, RULE_OPS, RULE_TARGETS, RULE_VALUES,
  type Game, type GameRule, type RuleAction, type RuleActionType, type RuleCondition, type RuleEvent,
} from '@aweborn/shared/game'
import { useGameDraftStore } from '../../lib/game'
import { NumberStepper, Picker, Section, Segmented } from './controls'
import {
  ACTION_LABEL, EVENT_LABEL, OP_LABEL, TARGET_LABEL, VALUE_LABEL, VAR_LABEL,
  actionHasAmount, actionHasTarget, eventHasSeconds, eventHasZone, ruleParts, zoneName,
} from './labels'

/**
 * Game ▸ Cards (slice 7): When ▸ If ▸ Do rules on top of the template. Each card reads
 * as a sentence; opening one shows its pickers and steppers. Nothing is typed, and every
 * edit goes through the draft store (so through `parseGame`): what shows is what saves.
 */

const ANY_ZONE = ''
const VARS = ['var-a', 'var-b', 'var-c'] as const
const AMOUNT: Record<string, { label: string; min: number; max: number; unit?: string }> = {
  'add-score': { label: 'Points', min: -999, max: 999 },
  'add-seconds': { label: 'Seconds', min: -600, max: 600, unit: ' s' },
  'set-var': { label: 'To', min: -999, max: 999 },
  'add-var': { label: 'By', min: -999, max: 999 },
}

export function GameCards({ g }: { g: Game }) {
  const edit = useGameDraftStore.getState().edit
  const [openId, setOpenId] = useState<string | null>(null)
  const L = GAME_LIMITS
  const full = g.rules.length >= L.rules

  // The card being changed starts at the top of what's visible (the sheet is short on a phone)
  useEffect(() => {
    if (openId) document.getElementById(`game-card-${openId}`)?.scrollIntoView?.({ block: 'start' })
  }, [openId])

  const setRule = (id: string, fn: (r: GameRule) => GameRule) => edit((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? fn(r) : r)) }))
  const add = () => {
    if (full) return
    const before = new Set(g.rules.map((r) => r.id))
    // No id: parseGame names it. Starts as the commonest card: step into a zone, score a point.
    const goal = g.zones.find((z) => z.kind === 'goal')
    const fresh = { when: { event: 'enter-zone', ...(goal ? { zone: goal.id } : {}) }, if: [], do: [{ type: 'add-score', target: 'actor', value: 1 }] } as unknown as GameRule
    edit((d) => ({ ...d, rules: [...d.rules, fresh] }))
    const made = useGameDraftStore.getState().draft?.rules.find((r) => !before.has(r.id))
    if (made) setOpenId(made.id)
  }
  const move = (i: number, by: -1 | 1) =>
    edit((d) => {
      const j = i + by
      if (j < 0 || j >= d.rules.length) return d
      const rules = [...d.rules]
      ;[rules[i], rules[j]] = [rules[j], rules[i]]
      return { ...d, rules }
    })

  return (
    <Section title={`Cards · ${g.rules.length} of ${L.rules}`} hint="Extra rules on top of the game: when something happens, if a check passes, do something. They run top to bottom.">
      {g.rules.length > 0 && (
        <ol className="game-cards" aria-label="Rule cards">
          {g.rules.map((r, i) => {
            const p = ruleParts(g, r)
            const open = openId === r.id
            return (
              <li key={r.id} id={`game-card-${r.id}`} className={`game-card game-card--rule${open ? ' is-open' : ''}`}>
                <p className="game-card-sentence">
                  <span className="game-card-when">{p.when}</span>
                  {p.if && <><span className="game-card-sep" aria-hidden="true"> ▸ </span><span className="game-card-if">{p.if}</span></>}
                  <span className="game-card-sep" aria-hidden="true"> ▸ </span><span className="game-card-do">{p.do}</span>
                </p>
                <div className="game-card-line">
                  <button id={`game-card-up-${r.id}`} type="button" className="game-step" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move card up">↑</button>
                  <button id={`game-card-down-${r.id}`} type="button" className="game-step" disabled={i === g.rules.length - 1} onClick={() => move(i, 1)} aria-label="Move card down">↓</button>
                  <span className="game-card-gap" />
                  <button id={`game-card-edit-${r.id}`} type="button" className={`game-btn${open ? ' game-btn--primary' : ''}`} aria-expanded={open} onClick={() => setOpenId(open ? null : r.id)}>{open ? 'Done' : 'Change'}</button>
                  <button id={`game-card-remove-${r.id}`} type="button" className="game-step game-step--remove" onClick={() => edit((d) => ({ ...d, rules: d.rules.filter((x) => x.id !== r.id) }))} aria-label="Remove card">×</button>
                </div>
                {open && <CardEditor g={g} rule={r} onChange={(fn) => setRule(r.id, fn)} />}
              </li>
            )
          })}
        </ol>
      )}
      <div className="game-adds">
        <button id="game-card-add" type="button" className="game-btn game-btn--primary" disabled={full} onClick={add}>＋ Add a card</button>
        {full && <span className="game-hint">That’s every card a game can hold.</span>}
      </div>
    </Section>
  )
}

function CardEditor({ g, rule: r, onChange }: { g: Game; rule: GameRule; onChange: (fn: (r: GameRule) => GameRule) => void }) {
  const L = GAME_LIMITS
  const id = `game-card-${r.id}`
  const setWhen = (patch: Partial<GameRule['when']>) => onChange((x) => ({ ...x, when: { ...x.when, ...patch } }))
  const setEvent = (event: RuleEvent) =>
    onChange((x) => ({ ...x, when: { event, ...(eventHasZone(event) && x.when.zone ? { zone: x.when.zone } : {}), ...(eventHasSeconds(event) ? { seconds: x.when.seconds ?? 30 } : {}) } }))
  const setIf = (i: number, patch: Partial<RuleCondition>) => onChange((x) => ({ ...x, if: x.if.map((c, k) => (k === i ? { ...c, ...patch } : c)) }))
  const setDo = (i: number, patch: Partial<RuleAction>) => onChange((x) => ({ ...x, do: x.do.map((a, k) => (k === i ? { ...a, ...patch } : a)) }))
  // A new kind of action starts from that kind's own defaults (parseGame fills them in)
  const setDoType = (i: number, type: RuleActionType) => onChange((x) => ({ ...x, do: x.do.map((a, k) => (k === i ? { type, ...(a.target ? { target: a.target } : {}) } : a)) }))

  return (
    <div className="game-card-editor">
      <fieldset className="game-part game-part--when">
        <legend>When</legend>
        <Picker bare id={`${id}-event`} label="When" value={r.when.event} options={RULE_EVENTS.map((e) => [e, EVENT_LABEL[e]] as const)} onChange={setEvent} />
        {eventHasZone(r.when.event) && (
          <Picker id={`${id}-zone`} label="Which zone" value={r.when.zone ?? ANY_ZONE} options={[[ANY_ZONE, 'Any zone'] as const, ...g.zones.map((z) => [z.id, zoneName(g, z)] as const)]} onChange={(zone) => onChange((x) => ({ ...x, when: { event: x.when.event, ...(zone ? { zone } : {}) } }))} />
        )}
        {eventHasZone(r.when.event) && g.zones.length === 0 && <p className="game-hint">Add zones under Places to pick one here.</p>}
        {eventHasSeconds(r.when.event) && (
          <NumberStepper id={`${id}-seconds`} label={r.when.event === 'every-seconds' ? 'Every' : 'Seconds left'} value={r.when.seconds ?? 30} text={`${r.when.seconds ?? 30} s`} min={1} max={L.roundSeconds[1]} onChange={(seconds) => setWhen({ seconds })} />
        )}
      </fieldset>

      <fieldset className="game-part game-part--if">
        <legend>If</legend>
        {r.if.length === 0 && <p className="game-hint">No check: it always happens.</p>}
        {r.if.map((c, i) => (
          <div key={i} className="game-clause">
            <div className="game-card-line">
              <Picker bare id={`${id}-if-${i}-left`} label="What to check" value={c.left} options={RULE_VALUES.map((v) => [v, VALUE_LABEL[v]] as const)} onChange={(left) => setIf(i, { left })} />
              <Picker bare id={`${id}-if-${i}-op`} label="Compared how" value={c.op} options={RULE_OPS.map((o) => [o, OP_LABEL[o]] as const)} onChange={(op) => setIf(i, { op })} />
              <button id={`${id}-if-${i}-remove`} type="button" className="game-step game-step--remove" onClick={() => onChange((x) => ({ ...x, if: x.if.filter((_, k) => k !== i) }))} aria-label="Remove this check">×</button>
            </div>
            <NumberStepper id={`${id}-if-${i}-right`} label="Number" value={c.right} min={-9999} max={9999} onChange={(right) => setIf(i, { right })} />
          </div>
        ))}
        <div className="game-adds">
          <button id={`${id}-if-add`} type="button" className="game-btn" disabled={r.if.length >= L.ruleConditions} onClick={() => onChange((x) => ({ ...x, if: [...x.if, { left: 'score', op: '>=', right: 1 }] }))}>＋ Add a check</button>
        </div>
      </fieldset>

      <fieldset className="game-part game-part--do">
        <legend>Do</legend>
        {r.do.map((a, i) => {
          const amt = AMOUNT[a.type]
          return (
            <div key={i} className="game-clause">
              <div className="game-card-line">
                <Picker bare id={`${id}-do-${i}-type`} label="What happens" value={a.type} options={RULE_ACTIONS.map((t) => [t, ACTION_LABEL[t]] as const)} onChange={(type) => setDoType(i, type)} />
                <button id={`${id}-do-${i}-remove`} type="button" className="game-step game-step--remove" disabled={r.do.length <= 1} onClick={() => onChange((x) => ({ ...x, do: x.do.filter((_, k) => k !== i) }))} aria-label="Remove this action">×</button>
              </div>
              {actionHasTarget(a.type) && (
                <Segmented id={`${id}-do-${i}-target`} label="Who" value={a.target ?? 'actor'} options={RULE_TARGETS.map((t) => [t, TARGET_LABEL[t]] as const)} onChange={(target) => setDo(i, { target })} />
              )}
              {(a.type === 'set-var' || a.type === 'add-var') && (
                <Segmented id={`${id}-do-${i}-name`} label="Counter" value={a.name ?? 'var-a'} options={VARS.map((v) => [v, VAR_LABEL[v]] as const)} onChange={(name) => setDo(i, { name })} />
              )}
              {actionHasAmount(a.type) && amt && (
                <NumberStepper id={`${id}-do-${i}-value`} label={amt.label} value={a.value ?? 0} text={`${a.value ?? 0}${amt.unit ?? ''}`} min={amt.min} max={amt.max} onChange={(value) => setDo(i, { value })} />
              )}
              {a.type === 'announce' && (
                <Picker id={`${id}-do-${i}-say`} label="Say" value={String(a.value ?? 0)} options={RULE_ANNOUNCEMENTS.map((t, k) => [String(k), t] as const)} onChange={(v) => setDo(i, { value: Number(v) })} />
              )}
            </div>
          )
        })}
        <div className="game-adds">
          <button id={`${id}-do-add`} type="button" className="game-btn" disabled={r.do.length >= L.ruleActions} onClick={() => onChange((x) => ({ ...x, do: [...x.do, { type: 'announce', value: 0 }] }))}>＋ Then also</button>
        </div>
      </fieldset>
    </div>
  )
}

import { GAME_LIMITS, NPC_BEHAVIORS, NPC_NAMES, type Game, type NpcEntry, type NpcPolicy } from '@aweborn/shared/game'
import { useGameDraftStore } from '../../lib/game'
import { Picker, Section, Stepper, Toggle } from './controls'
import { NPC_BEHAVIOR_BLURB, NPC_BEHAVIOR_LABEL, NPC_LEVEL_LABEL, freeNpcName } from './labels'

/**
 * Game ▸ NPCs (slice 6): what the creators let NPCs do, and the roster players pick
 * from. Names come from a fixed list (everyone sees them), behaviours are fixed and
 * deterministic, and a level range says how gentle or sharp each may play.
 */
export function GameNpcs({ g }: { g: Game }) {
  const edit = useGameDraftStore.getState().edit
  const setPolicy = (patch: Partial<NpcPolicy>) => edit((d) => ({ ...d, npc: { ...d.npc, ...patch } }))
  const setNpc = (id: string, patch: Partial<NpcEntry>) => edit((d) => ({ ...d, npcRoster: d.npcRoster.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
  const [lo, hi] = GAME_LIMITS.npcLevel
  const free = freeNpcName(g)
  const full = g.npcRoster.length >= GAME_LIMITS.npcs
  const add = () => {
    if (!free || full) return
    // No id: parseGame names it (npc-1, npc-2, …)
    edit((d) => ({ ...d, npcRoster: [...d.npcRoster, { name: free, behavior: 'auto', levels: { min: lo, max: hi } } as NpcEntry] }))
  }
  return (
    <>
      <Section title="What NPCs may do" hint="NPCs are always labelled as AI, and the rules decide the score, never an AI.">
        <Toggle id="game-npc-fill" label="Players may fill empty slots with NPCs" checked={g.npc.fill} onChange={(fill) => setPolicy({ fill })} />
        <Toggle id="game-npc-hold" label="An NPC holds a dropped player’s slot" checked={g.npc.hold} onChange={(hold) => setPolicy({ hold })} />
        <Toggle id="game-npc-host" label="A host NPC announces matches in chat" checked={g.npc.host} onChange={(host) => setPolicy({ host })} />
      </Section>

      <Section title={`The roster · ${g.npcRoster.length} of ${GAME_LIMITS.npcs}`} hint="The NPCs players can bring into a match, and how hard each may play.">
        {g.npcRoster.length > 0 && (
          <ul className="game-cards" aria-label="NPC roster">
            {g.npcRoster.map((n) => {
              const names = NPC_NAMES.filter((name) => name === n.name || !g.npcRoster.some((x) => x.name === name))
              return (
                <li key={n.id} id={`game-npc-${n.id}`} className="game-card game-card--npc">
                  <div className="game-card-line">
                    <span className="game-npc-badge" aria-hidden="true">AI</span>
                    <Picker bare id={`game-npc-name-${n.id}`} label="Name" value={n.name} options={names.map((x) => [x, x] as const)} onChange={(name) => setNpc(n.id, { name })} />
                    <Picker bare id={`game-npc-behavior-${n.id}`} label="How it plays" value={n.behavior} options={NPC_BEHAVIORS.map((b) => [b, NPC_BEHAVIOR_LABEL[b]] as const)} onChange={(behavior) => setNpc(n.id, { behavior })} />
                    <button id={`game-npc-remove-${n.id}`} type="button" className="game-step game-step--remove" onClick={() => edit((d) => ({ ...d, npcRoster: d.npcRoster.filter((x) => x.id !== n.id) }))} aria-label={`Remove ${n.name}`}>×</button>
                  </div>
                  <p className="game-hint">{NPC_BEHAVIOR_BLURB[n.behavior]}</p>
                  <Stepper id={`game-npc-min-${n.id}`} label="Easiest level" value={n.levels.min} text={`${n.levels.min} · ${NPC_LEVEL_LABEL[n.levels.min]}`} min={lo} max={n.levels.max} onChange={(min) => setNpc(n.id, { levels: { ...n.levels, min } })} />
                  <Stepper id={`game-npc-max-${n.id}`} label="Hardest level" value={n.levels.max} text={`${n.levels.max} · ${NPC_LEVEL_LABEL[n.levels.max]}`} min={n.levels.min} max={hi} onChange={(max) => setNpc(n.id, { levels: { ...n.levels, max } })} />
                </li>
              )
            })}
          </ul>
        )}
        <div className="game-adds">
          <button id="game-npc-add" type="button" className="game-btn game-btn--primary" disabled={full || !free} onClick={add}>＋ Add an NPC</button>
          {full && <span className="game-hint">The roster is full.</span>}
        </div>
      </Section>
    </>
  )
}

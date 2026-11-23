/**
 * NPC players (Phase 10, slice 6): fixed, deterministic behaviours. The server moves
 * each NPC with `stepNpc` and samples it like any player, so the record holds NPC play
 * the same way it holds human play. A rule decides scores, never a language model.
 *
 * How an NPC plays (rough draft, 2026-11-23):
 * - Every `wait` ticks it picks a **goal** (a spot on the floor and a reason) from its
 *   behaviour and the referee's state, then walks toward it in a straight line.
 * - It walks only, and keeps the height it spawned at: arena floors are assumed flat
 *   enough for a rough draft. A goal zone or an item on a raised platform is walked
 *   under, not climbed to. (Real floor following needs the world's geometry here.)
 * - It never steps outside the arena (0.5 m margin) and walks around keep-out zones by
 *   heading for the nearest corner it can see when the straight line is blocked.
 * - `level` 1..5 sets speed (60% → 100% of a human's walk), reaction time (ticks
 *   between decisions) and how often it slips (a random spot, or the second-best target).
 * - Randomness is `mind.rng` only (`rand` from match.ts), seeded from the match seed and
 *   the slot, so the same setup and states always give the same moves.
 */
import { boundsOf, type GameBox, type GameZone } from "./game.js";
import { MATCH_TICK_MS, q, rand, spawnPoint, type MatchItem, type MatchSetup, type MatchState, type PlayerState } from "./match.js";

/** Bump when behaviours change; recorded on every NPC slot. */
export const NPC_VERSION = 1;

/** What an NPC remembers between ticks (plain data; the server keeps one per NPC slot). */
export interface NpcMind {
  x: number; y: number; z: number;
  /** Where it is heading, and why. */
  goal: { x: number; z: number; why: string } | null;
  /** Ticks until it may pick a new goal (reaction time: slower at low levels). */
  wait: number;
  rng: number;
}

/** A human's walk speed, metres per second: WALK_SPEED in shared/sim/interior.ts (not exported there). */
export const NPC_WALK_SPEED = 4;
/** Per level 1..5: share of the human walk speed, ticks between decisions, chance of a slip per decision. */
export const NPC_LEVELS = {
  speed: [0.6, 0.7, 0.8, 0.9, 1],
  wait: [12, 9, 6, 4, 2],
  slip: [0.3, 0.18, 0.08, 0.03, 0],
} as const;
/** "Touch" for the referee is 1.5 m; stay clear of that so standing next to something counts. */
const ARENA_MARGIN = 0.5;
/** How far from a keep-out's wall an NPC stays, and how far out it rounds the corners. */
const KEEP_CLEAR = 0.3;
const CORNER_CLEAR = 0.6;
/** The referee moved us (a return to spawn) when its position is farther than this from ours. */
const SNAP_DISTANCE = 3;
const FOLLOW_DISTANCE = 2;

const levelOf = (level: number | undefined): number => Math.min(5, Math.max(1, Math.round(Number.isFinite(level) ? (level as number) : 3)));

/** Metres per second an NPC of this level walks (the game's speed trait applies to it like to anyone). */
export function npcSpeed(level: number, speedMul = 1): number {
  return NPC_WALK_SPEED * NPC_LEVELS.speed[levelOf(level) - 1] * speedMul;
}

export function initNpc(setup: MatchSetup, slot: number): NpcMind {
  const [x, y, z] = spawnPoint(setup, slot);
  // One stream per slot, so two NPCs in the same match don't slip in step
  const rng = (setup.seed ^ Math.imul(slot + 1, 0x9e3779b1)) | 0;
  return { x: q(x), y: q(y), z: q(z), goal: null, wait: 0, rng };
}

// ── Geometry on the floor ──────────────────────────────────────────────

interface Pt { x: number; z: number }
type Target = Pt & { why: string };
interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);
const rectOf = (b: GameBox): Rect => { const r = boundsOf(b); return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }; };
const grow = (r: Rect, m: number): Rect => ({ minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m });
/** Strictly inside (standing on the line is outside). */
const inside = (r: Rect, p: Pt): boolean => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
const within = (r: Rect, p: Pt): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const clampTo = (r: Rect, p: Pt): Pt => ({ x: Math.min(r.maxX, Math.max(r.minX, p.x)), z: Math.min(r.maxZ, Math.max(r.minZ, p.z)) });

/** Where along a→b (0..1) the segment first goes through the rectangle's inside; null when it doesn't. */
function segmentEnters(a: Pt, b: Pt, r: Rect): number | null {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  const edges: [number, number][] = [[-dx, a.x - r.minX], [dx, r.maxX - a.x], [-dz, a.z - r.minZ], [dz, r.maxZ - a.z]];
  for (const [p, d] of edges) {
    if (p === 0) { if (d <= 0) return null; continue; }
    const t = d / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  return t1 - t0 > 1e-9 ? t0 : null;
}

// ── What an NPC sees ───────────────────────────────────────────────────

interface View {
  setup: MatchSetup;
  state: MatchState;
  slot: number;
  team: number;
  level: number;
  behavior: string;
  me: PlayerState;
  at: Pt;
  /** Where it may walk (the arena less the margin); null when the game has no arena. */
  field: Rect | null;
  /** Keep-out footprints that matter at its height. */
  keepOuts: Rect[];
  middle: Pt;
}

function viewOf(setup: MatchSetup, state: MatchState, slot: number, mind: NpcMind, me: PlayerState): View {
  const s = setup.slots.find((x) => x.slot === slot);
  const arena = setup.game.arena;
  let field: Rect | null = null;
  if (arena) {
    const r = rectOf(arena);
    const mx = Math.min(ARENA_MARGIN, arena.size[0] / 2), mz = Math.min(ARENA_MARGIN, arena.size[2] / 2);
    field = { minX: r.minX + mx, maxX: r.maxX - mx, minZ: r.minZ + mz, maxZ: r.maxZ - mz };
  }
  // A keep-out well above or below the floor it walks on can't be walked into
  const keepOuts = setup.game.zones
    .filter((z) => z.kind === "keep-out" && mind.y >= z.at[1] - 2 && mind.y <= z.at[1] + z.size[1])
    .map(rectOf);
  const sp = spawnPoint(setup, slot);
  return {
    setup, state, slot, me, field, keepOuts,
    team: s?.team ?? 1,
    level: levelOf(s?.npc?.level),
    behavior: s?.npc?.behavior ?? "auto",
    at: { x: mind.x, z: mind.z },
    middle: arena ? { x: arena.at[0], z: arena.at[2] } : { x: sp[0], z: sp[2] },
  };
}

/** A spot it could stand on: on the field and clear of every keep-out. */
const safe = (v: View, p: Pt): boolean => (!v.field || within(v.field, p)) && !v.keepOuts.some((k) => inside(grow(k, KEEP_CLEAR), p));

const centre = (z: GameZone): Pt => ({ x: z.at[0], z: z.at[2] });
const nearestFirst = (v: View, list: Target[]): Target[] => list.map((t, i) => ({ t, i, d: dist(v.at, t) })).sort((a, b) => a.d - b.d || a.i - b.i).map((e) => e.t);
const teamOf = (v: View, slot: number): number => v.setup.slots.find((s) => s.slot === slot)?.team ?? 1;
const goalZones = (v: View, mineOnly: boolean): GameZone[] => v.setup.game.zones.filter((z) => z.kind === "goal" && (!mineOnly || z.team === undefined || z.team === v.team));
const carried = (v: View): MatchItem | undefined => v.state.items.find((i) => i.heldBy === v.slot || (v.me.carrying !== null && i.id === v.me.carrying));

/** Where flags are brought and guards stand: the team's goal zone, else its spawn zone, else its spawn point. */
function base(v: View): Pt {
  const zones = v.setup.game.zones;
  const z = zones.find((x) => x.kind === "goal" && x.team === v.team) ?? zones.find((x) => x.kind === "spawn" && x.team === v.team);
  if (z) return centre(z);
  const sp = spawnPoint(v.setup, v.slot);
  return { x: sp[0], z: sp[2] };
}

interface Dice { s: number }
function roll(d: Dice): number {
  const [s, r] = rand(d.s);
  d.s = s;
  return r;
}

/** Drift around a spot: keep the current drift goal until it is reached, then pick another within `radius`. */
function roam(v: View, mind: NpcMind, dice: Dice, around: Pt, radius: number, why: string): Target[] {
  const g = mind.goal;
  if (g && g.why === why && dist(v.at, g) > 0.3 && dist(around, g) <= radius + 0.5) return [g];
  for (let i = 0; i < 8; i++) {
    const a = roll(dice) * Math.PI * 2, r = Math.sqrt(roll(dice)) * radius;
    const p = { x: q(around.x + Math.cos(a) * r), z: q(around.z + Math.sin(a) * r) };
    if (safe(v, p)) return [{ ...p, why }];
  }
  return [{ ...(safe(v, around) ? around : v.at), why }];
}

function wander(v: View, mind: NpcMind, dice: Dice): Target[] {
  const a = v.setup.game.arena;
  const radius = a ? Math.max(1, Math.min(6, a.size[0] / 4, a.size[2] / 4)) : 3;
  return roam(v, mind, dice, v.middle, radius, "wander");
}

/** What scores in this template, best first. */
function objective(v: View, mind: NpcMind, dice: Dice): Target[] {
  const items = v.state.items.filter((i) => i.active && safe(v, i));
  const mine = carried(v);
  switch (v.setup.game.template) {
    case "race": {
      const goals = goalZones(v, true).map((z) => ({ ...centre(z), why: "goal" }));
      return goals.length ? nearestFirst(v, goals) : [{ ...v.middle, why: "goal" }];
    }
    case "collect": {
      const pickups = items.filter((i) => i.kind === "pickup").map((i) => ({ x: i.x, z: i.z, why: "pickup" }));
      return pickups.length ? nearestFirst(v, pickups) : wander(v, mind, dice);
    }
    case "capture-the-flag": {
      if (mine) return [{ ...base(v), why: "carry" }];
      const flags = items.filter((i) => i.kind === "flag" && i.heldBy === null);
      const want: Target[] = [];
      for (const f of flags) {
        if (f.team !== v.team) want.push({ x: f.x, z: f.z, why: "flag" });
        // Our own flag lying away from home: touching it sends it back
        else if (Math.hypot(f.x - f.home[0], f.z - f.home[2]) > 0.5) want.push({ x: f.x, z: f.z, why: "return" });
      }
      // Every enemy flag is already in a teammate's hands: go home with them
      return want.length ? nearestFirst(v, want) : [{ ...base(v), why: "escort" }];
    }
    case "king-of-the-hill": {
      const hills = goalZones(v, false).map((z) => ({ ...centre(z), why: "hill" }));
      return hills.length ? nearestFirst(v, hills) : [{ ...v.middle, why: "hill" }];
    }
    case "survive":
      return wander(v, mind, dice);
    case "build-together": {
      const goals = goalZones(v, true);
      if (mine) return goals.length ? nearestFirst(v, goals.map((z) => ({ ...centre(z), why: "deliver" }))) : [{ ...v.middle, why: "deliver" }];
      // Pieces already where they score are left alone
      const placed = (p: Pt): boolean => (goals.length ? goals.some((z) => within(rectOf(z), p)) : dist(p, v.middle) <= 3);
      const pieces = items.filter((i) => i.kind === "piece" && i.heldBy === null && !placed(i)).map((i) => ({ x: i.x, z: i.z, why: "piece" }));
      return pieces.length ? nearestFirst(v, pieces) : wander(v, mind, dice);
    }
  }
}

function guard(v: View, mind: NpcMind, dice: Dice): Target[] {
  const t = v.setup.game.template;
  if (t === "king-of-the-hill") {
    const hill = goalZones(v, false).map((z) => ({ z, d: dist(v.at, centre(z)) })).sort((a, b) => a.d - b.d)[0]?.z;
    // Patrol inside the hill, so guarding it also holds it
    if (hill) return roam(v, mind, dice, centre(hill), Math.max(0, Math.min(2, hill.size[0] / 2 - 0.3, hill.size[2] / 2 - 0.3)), "guard");
  }
  const home = base(v);
  if (t === "capture-the-flag") {
    const loose = v.state.items.find((i) => i.kind === "flag" && i.team === v.team && i.active && i.heldBy === null
      && Math.hypot(i.x - i.home[0], i.z - i.home[2]) > 0.5 && dist(home, i) <= 8 && safe(v, i));
    if (loose) return [{ x: loose.x, z: loose.z, why: "return" }];
  }
  return roam(v, mind, dice, home, 2, "guard");
}

function auto(v: View, mind: NpcMind, dice: Dice): Target[] {
  if (v.setup.game.template === "capture-the-flag" && !carried(v)) {
    // Roughly every other NPC on a team stays home
    const mates = v.setup.slots.filter((s) => s.kind === "npc" && s.team === v.team).map((s) => s.slot).sort((a, b) => a - b);
    if (mates.indexOf(v.slot) % 2 === 1) return guard(v, mind, dice);
  }
  return objective(v, mind, dice);
}

function plan(v: View, mind: NpcMind, dice: Dice): Target[] {
  const others = v.state.players.filter((p) => p.slot !== v.slot && !p.out && !p.left);
  switch (v.behavior) {
    case "fetch":
      return objective(v, mind, dice);
    case "guard":
      return guard(v, mind, dice);
    case "chase": {
      // Something in hand is worth more than a chase
      if (carried(v)) return objective(v, mind, dice);
      const foes = others.filter((p) => teamOf(v, p.slot) !== v.team);
      const carriers = foes.filter((p) => p.carrying !== null);
      const prey = (carriers.length ? carriers : foes).map((p) => ({ x: p.x, z: p.z, why: "chase" }));
      return prey.length ? nearestFirst(v, prey) : objective(v, mind, dice);
    }
    case "follow": {
      const humans = others.filter((p) => teamOf(v, p.slot) === v.team && v.setup.slots.find((s) => s.slot === p.slot)?.kind === "human");
      const lead = nearestFirst(v, humans.map((p) => ({ x: p.x, z: p.z, why: "follow" })))[0];
      if (!lead) return auto(v, mind, dice);
      // "Behind" without knowing which way they face: stop a couple of metres short, on our side of them
      const d = dist(v.at, lead);
      if (d <= FOLLOW_DISTANCE + 0.5) return [{ ...v.at, why: "follow" }];
      return [{ x: lead.x + ((v.at.x - lead.x) / d) * FOLLOW_DISTANCE, z: lead.z + ((v.at.z - lead.z) / d) * FOLLOW_DISTANCE, why: "follow" }];
    }
    default:
      return auto(v, mind, dice);
  }
}

/** Pick the goal for the next while: the best target, or (at low levels, sometimes) a worse one. */
function decide(v: View, mind: NpcMind): { goal: Target | null; rng: number } {
  const dice: Dice = { s: mind.rng };
  const options = plan(v, mind, dice);
  let goal: Target | null = options[0] ?? null;
  if (roll(dice) < NPC_LEVELS.slip[v.level - 1]) {
    if (options.length > 1 && roll(dice) < 0.5) goal = options[1];
    else if (v.field) {
      for (let i = 0; i < 8; i++) {
        const p = { x: q(v.field.minX + roll(dice) * (v.field.maxX - v.field.minX)), z: q(v.field.minZ + roll(dice) * (v.field.maxZ - v.field.minZ)) };
        if (safe(v, p)) { goal = { ...p, why: "slip" }; break; }
      }
    }
  }
  return { goal: goal ? { x: q(goal.x), z: q(goal.z), why: goal.why } : null, rng: dice.s };
}

// ── Walking ────────────────────────────────────────────────────────────

/** The next spot on the way to `goal`: one step, around keep-outs, inside the arena. Returns `v.at` when there is no way. */
function walk(v: View, goal: Pt): Pt {
  const step = npcSpeed(v.level, v.setup.game.settings.traits.speedMul) * (MATCH_TICK_MS / 1000);
  const cur = v.at;
  let target = v.field ? clampTo(v.field, goal) : goal;

  // Too close to a keep-out (spawned beside one, or put there): step straight out first
  const tight = v.keepOuts.find((k) => inside(grow(k, KEEP_CLEAR), cur));
  if (tight) {
    const out = grow(tight, KEEP_CLEAR + 0.05);
    const exits: Pt[] = [{ x: out.minX, z: cur.z }, { x: out.maxX, z: cur.z }, { x: cur.x, z: out.minZ }, { x: cur.x, z: out.maxZ }];
    const open = exits.filter((p) => !v.field || within(v.field, p)).sort((a, b) => dist(cur, a) - dist(cur, b))[0];
    if (!open) return cur;
    target = open;
  } else {
    // A goal hugging a keep-out's wall: aim for the nearest spot we may stand on
    for (const k of v.keepOuts) {
      const a = grow(k, KEEP_CLEAR);
      if (!inside(a, target)) continue;
      const o = grow(k, KEEP_CLEAR + 0.05);
      const sides: Pt[] = [{ x: o.minX, z: target.z }, { x: o.maxX, z: target.z }, { x: target.x, z: o.minZ }, { x: target.x, z: o.maxZ }];
      const t0 = target;
      target = sides.sort((p, r) => dist(t0, p) - dist(t0, r))[0];
    }
    // Straight line blocked: head for the corner that makes the shortest way round
    for (let i = 0; i < 4; i++) {
      let hit: Rect | null = null, first = Infinity;
      for (const k of v.keepOuts) {
        const t = segmentEnters(cur, target, grow(k, KEEP_CLEAR - 1e-6));
        if (t !== null && t < first) { first = t; hit = k; }
      }
      if (!hit) break;
      const c = grow(hit, CORNER_CLEAR), wall = grow(hit, KEEP_CLEAR - 1e-6), to = target;
      const corners: Pt[] = [{ x: c.minX, z: c.minZ }, { x: c.minX, z: c.maxZ }, { x: c.maxX, z: c.minZ }, { x: c.maxX, z: c.maxZ }];
      const best = corners
        .filter((p) => (!v.field || within(v.field, p)) && dist(cur, p) > 0.02 && segmentEnters(cur, p, wall) === null)
        .sort((a, b) => dist(cur, a) + dist(a, to) - (dist(cur, b) + dist(b, to)))[0];
      if (!best) return cur;
      target = best;
    }
  }

  const d = dist(cur, target);
  if (d < 1e-9) return cur;
  const f = Math.min(1, step / d);
  let next: Pt = { x: cur.x + (target.x - cur.x) * f, z: cur.z + (target.z - cur.z) * f };
  if (v.field) next = clampTo(v.field, next);
  next = { x: q(next.x), z: q(next.z) };
  // Last word: never step into a keep-out's clearance from outside it (two zones close together can leave no way: stand still)
  if (v.keepOuts.some((k) => { const a = grow(k, KEEP_CLEAR); return inside(a, next) && !inside(a, cur); })) return cur;
  return next;
}

/**
 * One tick of one NPC: where it moves to. Pure and deterministic. Walks only (stays on
 * the floor height of where it is; y follows the arena floor / its spawn height), never
 * leaves the arena on purpose, avoids keep-out zones. `level` 1..5 sets speed, reaction
 * time and how often it picks a poor goal.
 */
export function stepNpc(setup: MatchSetup, state: MatchState, slot: number, mind: NpcMind): NpcMind {
  const m: NpcMind = { x: mind.x, y: mind.y, z: mind.z, goal: mind.goal ? { ...mind.goal } : null, wait: mind.wait, rng: mind.rng };
  const me = state.players.find((p) => p.slot === slot);
  // The referee sent us somewhere (back to spawn): we are where it says, and what we were doing is over
  if (me && Math.hypot(me.x - m.x, me.y - m.y, me.z - m.z) > SNAP_DISTANCE) {
    m.x = q(me.x); m.y = q(me.y); m.z = q(me.z);
    m.goal = null;
    m.wait = 0;
  }
  if (!me || state.phase !== "playing" || me.out || me.left) return m;

  const v = viewOf(setup, state, slot, m, me);
  if (m.wait <= 0 || !m.goal) {
    const d = decide(v, m);
    m.goal = d.goal;
    m.rng = d.rng;
    m.wait = NPC_LEVELS.wait[v.level - 1];
  } else {
    m.wait -= 1;
  }
  if (m.goal) {
    const next = walk(v, m.goal);
    m.x = next.x;
    m.z = next.z;
  }
  return m;
}

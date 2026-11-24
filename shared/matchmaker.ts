/**
 * The matchmaker (Phase 10, slice 3): who plays, and on which team. Pure: the same
 * pool, settings and seed always give the same roster, and the seed is logged in the
 * match record (`formed`), so research can tell what was chance and what wasn't.
 *
 * Policy "random-balanced" (Q6): pick at random, balance teams by headcount (7 → 4 v 3).
 * What is not chance is logged too: `with` links and "play again together" teams stay on
 * one team, `against` pairs go to different teams.
 */
import type { Game, GameSettings } from "./game.js";
import { GAME_LIMITS } from "./game.js";
import { rand, type MatchSetup, type MatchSlot } from "./match.js";
import { NPC_VERSION } from "./npc.js";

export interface PoolPlayer { id: string; name: string }

/** One entry of the pool: a player, or players who must stay on one team. */
export interface PoolUnit {
  players: PoolPlayer[];
  /** A team that said "play again together" (logged in `formed.together`). */
  together?: boolean;
}

export interface PoolLink { a: string; b: string; kind: "with" | "against" }

export interface FormOpts {
  /** Links between players in the pool: `with` merges their units, `against` splits them across teams. */
  links?: readonly PoolLink[];
  policy?: MatchSetup["formed"]["policy"];
  /** Fewest players to accept, instead of `settings.players.min` (a host starting early, a lone player with NPCs). */
  min?: number;
  /** Accept a roster that leaves a team with nobody (NPCs will fill it, or a host insists). Otherwise that is no match. */
  allowEmptyTeams?: boolean;
}

export interface Formed { slots: MatchSlot[]; formed: MatchSetup["formed"] }

function shuffle<T>(list: readonly T[], seed: number): [T[], number] {
  const out = [...list];
  let s = seed | 0;
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [s, r] = rand(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

/** Units joined by `with` links become one unit (a chain a–b, b–c is one group of three). */
function mergeUnits(pool: readonly PoolUnit[], links: readonly PoolLink[]): PoolUnit[] {
  const units = pool.filter((u) => u.players.length > 0).map((u) => ({ players: [...u.players], together: u.together === true }));
  const unitOf = new Map<string, number>();
  units.forEach((u, i) => u.players.forEach((p) => unitOf.set(p.id, i)));
  const parent = units.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const l of links) {
    if (l.kind !== "with") continue;
    const a = unitOf.get(l.a), b = unitOf.get(l.b);
    if (a === undefined || b === undefined) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const merged = new Map<number, PoolUnit[]>();
  units.forEach((u, i) => {
    const r = find(i);
    merged.set(r, [...(merged.get(r) ?? []), u]);
  });
  return [...merged.values()].map((group) => ({ players: group.flatMap((u) => u.players), together: group.some((u) => u.together) }));
}

/**
 * Form one match from the pool, or null when there are too few players. Whole units
 * only, at most `settings.players.max` players. Slots are numbered 0..n-1, team by team.
 */
export function formMatch(pool: readonly PoolUnit[], settings: GameSettings, seed: number, opts: FormOpts = {}): Formed | null {
  const links = opts.links ?? [];
  const max = settings.players.max;
  const min = Math.max(1, opts.min ?? settings.players.min);
  const teams = Math.max(1, settings.teams);
  const [order, s1] = shuffle(mergeUnits(pool, links).filter((u) => u.players.length <= max), seed);

  // Who plays: in shuffled order, every unit that still fits
  const picked: PoolUnit[] = [];
  let count = 0;
  for (const u of order) {
    if (count + u.players.length > max) continue;
    picked.push(u);
    count += u.players.length;
    if (count === max) break;
  }
  if (count < min || count === 0) return null;

  // Teams: biggest units first, each to the smallest team that holds none of its rivals
  const ids = new Set(picked.flatMap((u) => u.players.map((p) => p.id)));
  const rivals = new Map<string, string[]>();
  for (const l of links) {
    if (l.kind !== "against" || !ids.has(l.a) || !ids.has(l.b)) continue;
    rivals.set(l.a, [...(rivals.get(l.a) ?? []), l.b]);
    rivals.set(l.b, [...(rivals.get(l.b) ?? []), l.a]);
  }
  const teamOf = new Map<string, number>();
  const heads = new Array<number>(teams).fill(0);
  let s = s1;
  const bySize = picked.map((u, i) => ({ u, i })).sort((a, b) => b.u.players.length - a.u.players.length || a.i - b.i);
  for (const { u } of bySize) {
    const blocked = new Set<number>();
    if (teams > 1) for (const p of u.players) for (const r of rivals.get(p.id) ?? []) if (teamOf.has(r)) blocked.add(teamOf.get(r)!);
    let open = heads.map((_, t) => t).filter((t) => !blocked.has(t));
    if (open.length === 0) open = heads.map((_, t) => t);
    const least = Math.min(...open.map((t) => heads[t]));
    const best = open.filter((t) => heads[t] === least);
    let r: number;
    [s, r] = rand(s);
    const t = best[Math.floor(r * best.length)];
    for (const p of u.players) teamOf.set(p.id, t);
    heads[t] += u.players.length;
  }

  // Units stay whole, so a few big ones can leave a team with nobody: that is no match yet
  if (!opts.allowEmptyTeams && heads.some((h) => h === 0)) return null;

  const players = picked.flatMap((u) => u.players);
  const slots: MatchSlot[] = [];
  for (let t = 0; t < teams; t++) {
    for (const p of players) if (teamOf.get(p.id) === t) slots.push({ slot: slots.length, team: t + 1, kind: "human", id: p.id, name: p.name });
  }
  return {
    slots,
    formed: {
      policy: opts.policy ?? "random-balanced",
      seed,
      links: links.filter((l) => ids.has(l.a) && ids.has(l.b)).map((l) => ({ a: l.a, b: l.b, kind: l.kind })),
      together: picked.filter((u) => u.together && u.players.length > 1).map((u) => u.players.map((p) => p.id)),
    },
  };
}

/**
 * Fill empty slots with NPCs from the game's roster (cycling through it evenly from a
 * seeded start; a roster NPC used more than once is numbered: "Bolt", "Bolt 2"), each to
 * the smallest team. `to: "max"` fills the match; `to: "min"` adds only
 * what a match needs: up to `players.min`, and one for every team that has nobody.
 * Returns a new list; a game with no roster gets none.
 */
export function fillWithNpcs(slots: readonly MatchSlot[], game: Game, level: number, seed: number, to: "max" | "min" = "max"): MatchSlot[] {
  const out = slots.map((s) => ({ ...s }));
  const roster = game.npcRoster;
  if (roster.length === 0) return out;
  const { teams, players } = game.settings;
  const heads = new Array<number>(Math.max(1, teams)).fill(0);
  for (const s of out) if (s.team >= 1 && s.team <= heads.length) heads[s.team - 1]++;
  const target = to === "max" ? players.max : Math.min(players.max, Math.max(players.min, out.length + heads.filter((h) => h === 0).length));
  const lv = Number.isFinite(level) ? Math.round(level) : 3;
  let next = out.reduce((m, s) => Math.max(m, s.slot + 1), 0);
  let at = Math.floor(rand(seed | 0)[1] * roster.length);
  // How often each roster NPC already plays, and the highest NPC number in use
  const used = new Map<string, number>();
  let n = 1;
  for (const s of out) {
    if (!s.npc) continue;
    used.set(s.npc.rosterId, (used.get(s.npc.rosterId) ?? 0) + 1);
    n = Math.max(n, (Number(s.id.split(":").pop()) || 0) + 1);
  }
  while (out.length < target) {
    const entry = roster[at++ % roster.length];
    const nth = (used.get(entry.id) ?? 0) + 1;
    used.set(entry.id, nth);
    const team = heads.indexOf(Math.min(...heads));
    heads[team]++;
    const clamped = Math.min(entry.levels.max, Math.max(entry.levels.min, Math.min(GAME_LIMITS.npcLevel[1], Math.max(GAME_LIMITS.npcLevel[0], lv))));
    out.push({
      slot: next++, team: team + 1, kind: "npc", id: `npc:${entry.id}:${n++}`, name: nth > 1 ? `${entry.name} ${nth}` : entry.name,
      npc: { rosterId: entry.id, behavior: entry.behavior, level: clamped, version: NPC_VERSION },
    });
  }
  return out;
}

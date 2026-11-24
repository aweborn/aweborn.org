/**
 * The match referee (Phase 10, slices 2 and 5): one deterministic rule step, shared by
 * the server (which runs every match) and anything that replays one.
 *
 * How a match is run and recorded in this rough draft (2026-11-23):
 * - Players move themselves (the interior sim on their own device, as everywhere in a
 *   world today) and the server samples where each one is, ten times a second. NPCs are
 *   moved by the server (shared/npc.ts) and sampled the same way.
 * - `stepMatch` is the referee: from the previous state and this tick's samples it works
 *   out zones, the edge, scores, the clock and the result. It never reads a clock or a
 *   random source: time is ticks, randomness is `state.rng` (seeded from `setup.seed`).
 * - The record is the setup plus every tick's samples and control inputs. Feeding them
 *   back through `stepMatch` reproduces every event and the result (`verifyRecord`), and
 *   playing the samples back shows the match. That is the hard rule: every match is fully
 *   traceable by replaying its telemetry.
 * - When Phase 09 puts interior movement under server authority, samples become inputs
 *   and nothing else here has to change.
 *
 * Positions are metres in world coordinates, quantized to centimetres in the record
 * (the server quantizes before stepping, so a replay sees exactly what the referee saw).
 */
import type { Game, Vec3 } from "./game.js";
import type { ArenaCopy } from "./arena.js";

/** Referee ticks per second = 1000 / this (the presence tick). */
export const MATCH_TICK_MS = 100;
/** Bump when `stepMatch` changes what it does with the same inputs; records keep the version they ran. */
export const MATCH_SIM_VERSION = 1;
/** Countdown before each round, and the pause after one. */
export const ROUND_COUNTDOWN_MS = 5000;
export const ROUND_BREAK_MS = 6000;

export interface MatchSlot {
  slot: number;
  /** 1..teams */
  team: number;
  kind: "human" | "npc";
  /** A human's playerId, or `npc:<roster id>:<n>`. After erasure a human becomes `stand-in:<n>`. */
  id: string;
  name: string;
  /** NPC slots: what plays it (always recorded, so research can tell human play from NPC play). */
  npc?: { rosterId: string; behavior: string; level: number; version: number };
}

/** Everything a match starts from. Stored whole in the record. */
export interface MatchSetup {
  matchId: string;
  worldId: string;
  /** The game exactly as it was (its `version` says which). */
  game: Game;
  seed: number;
  simVersion: number;
  slots: MatchSlot[];
  /** How the roster was formed, for research: the matchmaker's policy and seed, and what wasn't its own choice. */
  formed: { policy: "random-balanced" | "play-now" | "host-start"; seed: number; links: { a: string; b: string; kind: "with" | "against" }[]; together: string[][] };
  /**
   * The match's own copy of the arena (shared/arena.ts): the objects that stood on the stage
   * when it started. Its players see and collide with these, not the live stage, and a replay
   * shows them. Absent in records made before 2026-11-24 (those matches saw the live stage).
   * The referee never reads it.
   */
  arena?: ArenaCopy;
}

export type MatchPhase = "countdown" | "playing" | "break" | "finished";

export interface PlayerState {
  slot: number;
  x: number; y: number; z: number;
  /** A sample arrived this tick (a human who lost signal has none; they stand still for the referee). */
  fresh: boolean;
  /** Out for this round (survive), or gone from the match for good (`left`). */
  out: boolean;
  left: boolean;
  /** Ticks spent outside the arena / inside a keep-out zone in a row (the soft countdown). */
  outsideTicks: number;
  keepOutTicks: number;
  /** The item this player carries (a flag or a piece), or null. */
  carrying: string | null;
  score: number;
  /** Times sent back to spawn. */
  returns: number;
  /** Zone ids the player is in (for enter/leave events). */
  zones: string[];
  /** Referee bookkeeping (always set by the referee; optional so hand-built states stay valid).
   *  Ticks left of "just sent to spawn": samples far from the spawn are ignored until the client has moved there. */
  grace?: number;
  /** Times sent back this round (survive counts these). */
  roundReturns?: number;
}

export interface MatchItem {
  id: string;
  kind: "pickup" | "flag" | "piece";
  /** Flags: the team it belongs to. */
  team?: number;
  x: number; y: number; z: number;
  home: Vec3;
  /** Slot carrying it, or null. */
  heldBy: number | null;
  /** Pickups disappear when taken. */
  active: boolean;
  /** Referee bookkeeping: ticks until an inactive item reappears (0 = it stays gone). */
  respawn?: number;
}

export interface MatchState {
  tick: number;
  phase: MatchPhase;
  /** 1-based. */
  round: number;
  /** Ticks left in this phase. */
  left: number;
  /** Index = team - 1. Round score while playing. */
  scores: number[];
  /** Rounds won per team. */
  rounds: number[];
  players: PlayerState[];
  items: MatchItem[];
  /** King of the hill: the team holding it (0 = nobody / contested). */
  hill: number;
  /** The three rule variables. */
  vars: [number, number, number];
  rng: number;
  /** Set when phase is `finished`: winning team, 0 = a draw. */
  winner: number | null;
  /** Referee bookkeeping (always set by the referee; optional so hand-built states stay valid).
   *  Ticks played this round (every-seconds rules), ticks the hill's holder has held it in a row,
   *  and the seconds-left rules that already fired this round. */
  played?: number;
  hillTicks?: number;
  fired?: string[];
  /** Set when phase is `finished`: why the match ended ("time" | "score" | "all-out" | "rule" | "host" | "empty"). */
  why?: string;
}

export interface Sample { slot: number; x: number; y: number; z: number }

/** Things that are not movement but change the match, recorded with the tick they took effect. */
export type ControlInput =
  | { type: "leave"; slot: number }
  /** An NPC takes over a human's slot (they dropped), or the human takes it back. */
  | { type: "swap"; slot: number; to: "npc" | "human" }
  /**
   * The host refused a human's position sample (shared/match-sanity.ts): too far too fast
   * ("speed") or outside a walled arena ("wall"). `at` is the refused position in metres.
   * The referee ignores it (that slot simply has no sample this tick); it is in the record
   * so research and disputes can see every refusal.
   */
  | { type: "reject"; slot: number; why: "speed" | "wall"; at: Vec3 }
  | { type: "host-end" };

export type MatchEventType =
  | "round-start" | "round-end" | "match-end"
  | "enter-zone" | "leave-zone" | "goal" | "score"
  | "out-of-bounds" | "keep-out" | "return" | "out"
  | "pickup" | "drop" | "capture" | "hill" | "piece"
  | "rule" | "announce" | "swap" | "leave";

export interface MatchEvent {
  tick: number;
  type: MatchEventType;
  slot?: number;
  team?: number;
  zone?: string;
  item?: string;
  value?: number;
  /** `return`: where the player is put (the server moves them there). */
  to?: Vec3;
  /** `rule`: the rule's id. `round-end` / `match-end`: "time" | "score" | "all-out" | "host" | "empty". */
  why?: string;
}

export interface MatchResult {
  /** Winning team; 0 = a draw. */
  winner: number;
  rounds: number[];
  /** Final round's scores. */
  scores: number[];
  players: { slot: number; score: number; returns: number; left: boolean }[];
  ticks: number;
  why: string;
}

/** One recorded tick: samples as [slot, x_cm, y_cm, z_cm, …] and any control inputs. Ticks with neither are skipped. */
export interface MatchFrame { t: number; s: number[]; c?: ControlInput[] }

export interface MatchRecord {
  v: 1;
  setup: MatchSetup;
  frames: MatchFrame[];
  events: MatchEvent[];
  result: MatchResult | null;
  startedAt: number;
  endedAt: number | null;
}

/** Centimetre quantization used for everything the referee and the record see. */
export const q = (v: number): number => Math.round(v * 100) / 100;
export const packSamples = (samples: readonly Sample[]): number[] => samples.flatMap((s) => [s.slot, Math.round(s.x * 100), Math.round(s.y * 100), Math.round(s.z * 100)]);
export function unpackSamples(s: readonly number[]): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i + 3 < s.length; i += 4) out.push({ slot: s[i], x: s[i + 1] / 100, y: s[i + 2] / 100, z: s[i + 3] / 100 });
  return out;
}

/** Deterministic PRNG step (mulberry32): returns [next state, value in 0..1). */
export function rand(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [a, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** Where a slot's team spawns (the middle of its spawn zone's floor; the arena's middle if the game has none). */
export function spawnPoint(setup: MatchSetup, slot: number): Vec3 {
  const s = setup.slots.find((x) => x.slot === slot);
  const zone = setup.game.zones.find((z) => z.kind === "spawn" && z.team === (s?.team ?? 1)) ?? setup.game.zones.find((z) => z.kind === "spawn");
  const at = zone?.at ?? setup.game.arena?.at ?? [0, 0, 0];
  // Spread a team along x so players don't stand inside each other
  const mates = setup.slots.filter((x) => x.team === (s?.team ?? 1)).map((x) => x.slot);
  const i = Math.max(0, mates.indexOf(slot));
  const w = zone ? Math.max(0, zone.size[0] - 1) : 2;
  const dx = mates.length > 1 ? (i / (mates.length - 1) - 0.5) * Math.min(w, mates.length * 1.2) : 0;
  return [q(at[0] + dx), q(at[1] + (zone ? 0 : 1)), q(at[2])];
}

// ── The referee: implemented in match-referee.ts (kept apart so this file stays the contract) ──
export { initMatch, stepMatch, resultOf, replayRecord, verifyRecord } from "./match-referee.js";

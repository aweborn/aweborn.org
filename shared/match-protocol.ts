/**
 * What the client and the server say to each other about a world's lobby and matches
 * (Phase 10, slices 2 to 6). One socket message type, `match` (0x13), JSON both ways,
 * always sent with the world's id in the envelope. Every message has a `t`.
 *
 * The server decides everything: who is in the pool, who plays together, where they
 * stand at the start, the score, the end. The client asks, and draws what it is told.
 */
import type { Game, Vec3 } from "./game.js";
import type { ArenaObject } from "./arena.js";
import type { MatchEvent, MatchPhase, MatchResult, MatchSlot } from "./match.js";

/** How long a matched group has to step out before the roster locks. */
export const READY_MS = 15_000;
/** After a player's connection drops, how long before an NPC takes their slot (if the game allows). */
export const DROP_GRACE_MS = 8_000;
/** A match with no humans left in it is discarded after this. */
export const EMPTY_MATCH_MS = 15_000;
/** Finished matches stay in the lobby's list this long ("finished x ago"). */
export const FINISHED_LIST_MS = 30 * 60_000;
/** Longest a match may run, whatever its settings (so an instance can't live forever). */
export const MAX_MATCH_MS = 2 * 60 * 60_000;

/** With enough players in the ring, the matchmaker waits this long for more before it forms a match (at once when full). */
export const POOL_WAIT_MS = 3_000;
/** After a match: how long the results stay up for "play again together" answers before everyone goes back to the lobby. */
export const AGAIN_MS = 20_000;
/** Awe for finishing a match (a quarter, rounded up, when no other human played), and the most a character earns from matches in 24 h. */
export const AWE_PER_MATCH = 30;
export const AWE_MATCH_DAILY_MAX = 10 * AWE_PER_MATCH;
/** The chat sender of the host NPC's fixed announcements in a world's chat (an `npc:` sender with no object: show it as "Host"). */
export const GAME_HOST_SENDER = "npc:game-host";

// ── Client → server ────────────────────────────────────────────────────
export type MatchIntent =
  /** "I'm in this world: send me the lobby." Sent on entering a world that has a game, and after reconnecting. */
  | { t: "hello" }
  /** Standing in the ring (true) or stepping out of it (false). Stepping out during a ready check declines it. */
  | { t: "queue"; on: boolean }
  /** Alone in the pool: start now with NPCs in the other slots (the game must allow NPC fill). */
  | { t: "play-now"; level: number }
  /** During a ready check: propose NPCs for the empty slots (level each), or vote on a proposal. Everyone must agree. */
  | { t: "npc-propose"; level: number }
  | { t: "npc-vote"; yes: boolean }
  /** After a match: "play again together". If the whole team says yes, it re-enters the pool as a unit. */
  | { t: "again"; yes: boolean }
  /** Links between two characters in the lobby: play with (same team) or against (other team). The other must accept. */
  | { t: "link"; to: string; kind: "with" | "against" }
  | { t: "link-answer"; from: string; yes: boolean }
  | { t: "unlink"; with: string }
  /** Tune into a running match (or null to stop). One at a time. */
  | { t: "watch"; matchId: string | null }
  /** Leave the match you are playing: back to the lobby. */
  | { t: "leave" }
  /** Take your slot back in a match that is still running. */
  | { t: "rejoin"; matchId: string }
  /** Creator and builders, present in the lobby: start with whoever is in the pool, hold the queue, release it, or end a match. */
  | { t: "host"; cmd: "start" | "hold" | "release" }
  | { t: "host-end"; matchId: string };

// ── Server → client ────────────────────────────────────────────────────
export interface LobbyMatchRow {
  id: string;
  phase: MatchPhase;
  round: number;
  scores: number[];
  players: number;
  watching: number;
  startedAt: number;
  /** Set once it has ended: the row then opens the replay. */
  endedAt?: number;
  winner?: number;
}

export interface LobbyState {
  t: "lobby";
  /** The game version the lobby is running (a new save applies to the next match). */
  gameVersion: number;
  /** False while the game is missing something (gameMissing): nobody can queue. */
  ready: boolean;
  pool: number;
  queued: boolean;
  held: boolean;
  matches: LobbyMatchRow[];
  /** Your links, and asks waiting for your answer. */
  links: { with: string; name: string; kind: "with" | "against" }[];
  asks: { from: string; name: string; kind: "with" | "against" }[];
  /** A match of yours is still running and your slot is open to you. */
  rejoin: string | null;
}

export interface SnapPlayer { slot: number; x: number; y: number; z: number; out?: boolean; carrying?: string | null; outside?: number; score?: number }
export interface SnapItem { id: string; kind: "pickup" | "flag" | "piece"; team?: number; x: number; y: number; z: number; heldBy: number | null }

export type MatchMessage =
  | LobbyState
  /** You were matched: a ready check. Step out of the ring to decline. */
  | { t: "found"; matchId: string; you: { slot: number; team: number }; roster: MatchSlot[]; readyMs: number; npc: { level: number; by: string; votes: number; needed: number } | null }
  /** The ready check fell through (someone declined and nobody could fill in). You are still in the pool. */
  | { t: "cancel"; matchId: string }
  /**
   * Sent just before `start` (and again with every repeated `start`): the match's own copy of
   * the arena (shared/arena.ts). While you play, the stage is drawn and collided from these
   * objects, not from the live world. Its own message so `start` stays small.
   */
  | { t: "arena"; matchId: string; objects: ArenaObject[] }
  /** The roster is locked: you are being placed. `game` is the match's own game (the version it started with): its traits, wall and zones are the ones that count, whatever the world's game is now. */
  | { t: "start"; matchId: string; you: { slot: number; team: number }; roster: MatchSlot[]; gameVersion: number; spawn: Vec3; face: Vec3; game?: Game }
  /** Ten times a second while you play or watch a match. `events` are the ones since the last snap. */
  | { t: "snap"; matchId: string; tick: number; phase: MatchPhase; round: number; left: number; scores: number[]; rounds: number[]; hill: number; players: SnapPlayer[]; items: SnapItem[]; watching: number; events: MatchEvent[] }
  /** The referee moved you (back to spawn, or to a round's start), or the host did: "check" = your position was not believed (shared/match-sanity.ts), go back to the last one that was. */
  | { t: "move"; matchId: string; to: Vec3; face?: Vec3; why: "return" | "round" | "rejoin" | "check" }
  /** The match is over. `awe` is what you earned (0 for watchers). Answer with `again`. */
  | { t: "end"; matchId: string; result: MatchResult; roster: MatchSlot[]; awe: number; again: boolean }
  /** Back to the lobby (after the results, or when you leave). */
  | { t: "back"; to: Vec3 }
  /** Something you asked for was refused. */
  | { t: "error"; message: string };

/** Summary of a finished match, for lists (a character's replays, a world's recent matches). */
export interface MatchSummary {
  id: string;
  worldId: string;
  worldName: string;
  template: string;
  gameVersion: number;
  startedAt: number;
  endedAt: number | null;
  winner: number | null;
  scores: number[];
  roster: { slot: number; team: number; kind: "human" | "npc"; name: string; you?: boolean }[];
}

/**
 * The match host (Phase 10, slices 2 to 6): every world's lobby pool, the matchmaker's
 * ready checks, and every running match. The server decides everything; clients ask
 * with `MatchIntent`s and draw the `MatchMessage`s they are sent (shared/match-protocol.ts).
 *
 * How a match runs here (the rough draft, see shared/match.ts):
 * - Players move themselves; `tick()` (every MATCH_TICK_MS) samples where each one is from
 *   presence, moves the NPCs (`stepNpc`), and runs the referee (`stepMatch`) on those samples.
 * - A match is an **instance by partition**: its players are put in presence group
 *   `<worldId>#<matchId>`, so the lobby and the live world don't see them.
 * - Every tick's samples and control inputs are recorded (match-store.ts), flushed about
 *   every 5 s. A frame's `t` is the referee's tick **after** that step (the first is 1), which
 *   is what `replayRecord` feeds back.
 * - Forced ends (nobody left, the time cap, a host ending it) all go through the
 *   referee as a `host-end` control input, so the record still replays to the same result.
 *
 * No sockets and no timers in here: everything it needs is injected (`MatchHostDeps`),
 * `index.ts` wires it to rooms.ts and calls `tick()`. Nothing a player types reaches
 * another player through this file: announcements are fixed lines.
 */
import { randomUUID } from "node:crypto";
import { gameMissing, teamName, type Game, type Vec3 } from "../../../shared/game.js";
import {
  MATCH_SIM_VERSION, packSamples, q, spawnPoint,
  type ControlInput, type MatchEvent, type MatchFrame, type MatchRecord, type MatchResult, type MatchSetup, type MatchSlot, type MatchState, type Sample,
} from "../../../shared/match.js";
import { initMatch, stepMatch, resultOf, verifyRecord } from "../../../shared/match-referee.js";
import { initNpc, stepNpc, type NpcMind } from "../../../shared/npc.js";
import { formMatch, fillWithNpcs, type PoolLink, type PoolUnit } from "../../../shared/matchmaker.js";
import {
  AGAIN_MS, AWE_PER_MATCH, DROP_GRACE_MS, EMPTY_MATCH_MS, FINISHED_LIST_MS, MAX_MATCH_MS, POOL_WAIT_MS, READY_MS,
  type LobbyMatchRow, type LobbyState, type MatchMessage, type SnapItem, type SnapPlayer,
} from "../../../shared/match-protocol.js";

export interface Referee {
  initMatch(setup: MatchSetup): MatchState;
  stepMatch(setup: MatchSetup, state: MatchState, samples: readonly Sample[], controls?: readonly ControlInput[]): { state: MatchState; events: MatchEvent[] };
  resultOf(setup: MatchSetup, state: MatchState, why?: string): MatchResult | null;
}
export interface NpcDriver {
  initNpc(setup: MatchSetup, slot: number): NpcMind;
  stepNpc(setup: MatchSetup, state: MatchState, slot: number, mind: NpcMind): NpcMind;
}
export interface MatchRecorder {
  begin(setup: MatchSetup, startedAt: number, researchIds?: Readonly<Record<string, string | undefined>>, candidates?: ReadonlySet<string>): void;
  appendFrames(matchId: string, frames: readonly MatchFrame[]): void;
  finish(matchId: string, events: readonly MatchEvent[], result: MatchResult | null, endedAt: number): void;
  record(matchId: string): MatchRecord | null;
}
type Pos = { x: number; y: number; z: number };

export interface MatchHostDeps {
  /** The world's current stored game, or null. Read when a lobby opens and after `gameChanged`. */
  game(worldId: string): Game | null;
  isOwner(worldId: string, playerId: string): boolean;
  /** Where the player stands in that world (from presence), or null if not known yet. */
  position(worldId: string, playerId: string): Pos | null;
  /** Does the player have a live connection in that world? */
  online(worldId: string, playerId: string): boolean;
  send(playerId: string, worldId: string, msg: MatchMessage): void;
  /** Put the player in an instance's presence group, or back in the world (null). */
  setGroup(playerId: string, group: string | null): void;
  name(playerId: string): string;
  researchId(playerId: string): string | undefined;
  /** Is this player behind the 18+ door, and so a research candidate (Q10b)? Asked once, as the match starts. Absent = nobody is. */
  researchCandidate?(playerId: string): boolean;
  /** Grant awe for a finished match (`ref` = the match id, so a retry can't pay twice). Returns what was granted after the daily cap. */
  awe(playerId: string, amount: number, ref: string): number;
  /** A fixed host line in the world's chat. */
  chat(worldId: string, line: string): void;
  store: MatchRecorder;
  /** Defaults to the real referee and NPC movement (shared/). */
  referee?: Referee;
  npc?: NpcDriver;
  /** Checks a finished record replays to the same result. Defaults to `verifyRecord` with the real referee, off with an injected one. */
  verify?: ((record: MatchRecord) => boolean) | null;
  now(): number;
  seed(): number;
}

/** Slack around the ring: presence is a little behind, and the edge shouldn't flicker. */
const RING_SLACK = 1.5;
const RING_HEIGHT_SLACK = 4;
/** Someone just put in the pool (or sent back to the ring) isn't checked against the ring until their presence catches up. */
const RING_GRACE_MS = 5_000;
const LOBBY_SEND_MS = 1_000;
const FLUSH_MS = 5_000;
/**
 * After the server moves a player (start, return to spawn, rejoin) their presence still
 * shows the old spot for a moment. Until it arrives near the target (or this runs out)
 * the referee is given the target, so a stale sample can't score or count as outside.
 */
const PIN_MS = 1_500;
const START_PIN_MS = 6_000;
const PIN_NEAR = 3;
const MAX_LINKS = 8;
/** A ready check with an NPC proposal runs at least this long from the (first) proposal. */
const NPC_VOTE_MS = 8_000;
const DEFAULT_NPC_LEVEL = 3;

const HOST_LINES = {
  found: "A match is forming. Step out of the ring if you can't play.",
  started: (heads: number[]) => (heads.length > 1 ? `Match started: ${heads.join(" v ")}. Good luck!` : `Match started with ${heads[0]} ${heads[0] === 1 ? "player" : "players"}. Good luck!`),
  over: (winner: number | null, teams: number) => (winner === null ? "Match over." : winner === 0 ? "Match over. It's a draw!" : teams > 1 ? `Match over. ${teamName(winner)} wins!` : "Match over. Well played!"),
} as const;

interface Seat {
  playerId: string;
  slot: number;
  team: number;
  /** in = playing; held = an NPC keeps the slot; dropped = nobody does; left = gone for good. */
  state: "in" | "held" | "dropped" | "left";
  offSince: number | null;
  last: Pos | null;
  pin: { to: Vec3; until: number } | null;
  /** Index into the match's events: what this player has been sent. */
  sent: number;
  again: boolean | null;
}

interface Running {
  id: string;
  worldId: string;
  setup: MatchSetup;
  state: MatchState;
  startedAt: number;
  frames: MatchFrame[];
  lastFlush: number;
  events: MatchEvent[];
  seats: Map<string, Seat>;
  seatBySlot: Map<number, Seat>;
  minds: Map<number, NpcMind>;
  controls: ControlInput[];
  /** Watchers and how many events each has been sent. */
  watchers: Map<string, number>;
  emptySince: number | null;
  forced: string | null;
  ended: { at: number } | null;
}

interface Check {
  matchId: string;
  game: Game;
  slots: MatchSlot[];
  formed: MatchSetup["formed"];
  deadline: number;
  npc: { level: number; by: string; yes: Set<string> } | null;
  /** The one extension for an NPC proposal has been used. */
  extended?: boolean;
}

interface Lobby {
  worldId: string;
  game: Game | null;
  subs: Set<string>;
  /** Player → when they entered the pool. */
  pool: Map<string, number>;
  /** "Play again together" teams waiting in the pool. */
  teams: string[][];
  held: boolean;
  waitSince: number | null;
  check: Check | null;
  links: PoolLink[];
  asks: { from: string; to: string; kind: "with" | "against" }[];
  dirty: boolean;
  lastSent: number;
  lastSecond: number;
  matches: Set<string>;
  finished: LobbyMatchRow[];
}

interface PlayerAt { worldId: string; match: string | null; watching: string | null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const level = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : DEFAULT_NPC_LEVEL);

export class MatchHost {
  private readonly lobbies = new Map<string, Lobby>();
  private readonly matches = new Map<string, Running>();
  private readonly players = new Map<string, PlayerAt>();
  /** Players whose slot in a running match is open to them (they dropped): player → match. */
  private readonly away = new Map<string, string>();
  private readonly referee: Referee;
  private readonly npc: NpcDriver;
  private readonly verify: ((record: MatchRecord) => boolean) | null;

  constructor(private readonly deps: MatchHostDeps) {
    this.referee = deps.referee ?? { initMatch, stepMatch, resultOf };
    this.npc = deps.npc ?? { initNpc, stepNpc };
    this.verify = deps.verify !== undefined ? deps.verify : deps.referee ? null : verifyRecord;
  }

  // ── In ───────────────────────────────────────────────────────────

  /** A client's intent. Never throws; anything malformed is ignored. */
  intent(worldId: string, playerId: string, raw: unknown): void {
    if (!isObj(raw) || typeof raw.t !== "string") return;
    if (!this.deps.online(worldId, playerId)) return;
    try {
      this.handle(worldId, playerId, raw);
    } catch (err) {
      console.error(`[match] intent ${String(raw.t).slice(0, 20)} failed:`, err);
    }
  }

  /** The player's last connection in this world closed, or they left it. (A match of theirs notices on its own tick.) */
  left(worldId: string, playerId: string): void {
    const lobby = this.lobbies.get(worldId);
    const p = this.players.get(playerId);
    if (lobby) {
      lobby.subs.delete(playerId);
      this.unqueue(lobby, playerId);
      const links = lobby.links.length + lobby.asks.length;
      lobby.links = lobby.links.filter((l) => l.a !== playerId && l.b !== playerId);
      lobby.asks = lobby.asks.filter((a) => a.from !== playerId && a.to !== playerId);
      if (links !== lobby.links.length + lobby.asks.length) lobby.dirty = true;
    }
    if (p && p.worldId === worldId) {
      this.stopWatching(playerId, p);
      if (!p.match) this.players.delete(playerId);
    }
  }

  /** The world's game was saved or removed: the lobby runs the new version from the next match on. */
  gameChanged(worldId: string): void {
    const lobby = this.lobbies.get(worldId);
    if (!lobby) return;
    lobby.game = this.deps.game(worldId);
    lobby.waitSince = null;
    lobby.dirty = true;
    if (!this.ready(lobby)) {
      if (lobby.check) this.cancelCheck(lobby);
      lobby.pool.clear();
      lobby.teams = [];
    }
  }

  /** One referee tick for every running match, and the lobbies' housekeeping. Call every MATCH_TICK_MS. */
  tick(): void {
    const now = this.deps.now();
    for (const m of [...this.matches.values()]) {
      try {
        if (m.ended) this.tickEnded(m, now);
        else this.tickMatch(m, now);
      } catch (err) {
        console.error(`[match] ${m.id} tick failed:`, err);
        if (!m.ended) this.end(m, "error");
      }
    }
    for (const lobby of [...this.lobbies.values()]) {
      try {
        this.tickLobby(lobby, now);
      } catch (err) {
        console.error(`[match] lobby ${lobby.worldId} tick failed:`, err);
      }
    }
  }

  /**
   * A match's record, also while it runs: the stored record plus the ticks not flushed yet
   * and the events so far (result null). Watchers read the roster from it. Null if unknown.
   */
  record(matchId: string): MatchRecord | null {
    const stored = this.deps.store.record(matchId);
    const m = this.matches.get(matchId);
    if (!stored || !m || m.ended) return stored;
    return { ...stored, frames: [...stored.frames, ...m.frames], events: m.events };
  }

  stats(): { lobbies: number; matches: number; pooled: number } {
    let pooled = 0;
    for (const l of this.lobbies.values()) pooled += l.pool.size;
    return { lobbies: this.lobbies.size, matches: this.matches.size, pooled };
  }

  // ── Intents ──────────────────────────────────────────────────────

  private handle(worldId: string, playerId: string, it: Record<string, unknown>): void {
    const lobby = this.subscribe(worldId, playerId);
    const p = this.players.get(playerId)!;
    const refuse = (message: string) => this.deps.send(playerId, worldId, { t: "error", message });
    switch (it.t) {
      case "hello": {
        this.sendLobby(lobby, playerId);
        // Back after a short gap (a reload): they are still in their match, so tell the client again
        const m = p.match ? this.matches.get(p.match) : undefined;
        const seat = m?.seats.get(playerId);
        if (m && seat && seat.state === "in" && !m.ended) this.sendStart(m, seat, null);
        return;
      }
      case "queue": {
        if (it.on === true) {
          const no = this.cannotQueue(lobby, playerId, p);
          if (no) return refuse(no);
          this.enqueue(lobby, playerId);
        } else if (it.on === false) {
          this.unqueue(lobby, playerId);
        }
        return;
      }
      case "play-now": {
        const game = lobby.game;
        if (!game || !this.ready(lobby)) return refuse("This game isn't ready to play yet.");
        if (!game.npc.fill || game.npcRoster.length === 0) return refuse("This game has no NPC players to play with.");
        if (!lobby.pool.has(playerId)) {
          const no = this.cannotQueue(lobby, playerId, p);
          if (no) return refuse(no);
          this.enqueue(lobby, playerId);
        }
        if (lobby.pool.size !== 1 || lobby.check) return refuse("Others are waiting to play. You'll be matched with them.");
        const seed = this.deps.seed();
        const f = formMatch([{ players: [{ id: playerId, name: this.deps.name(playerId) }] }], game.settings, seed, { policy: "play-now", min: 1, allowEmptyTeams: true });
        if (!f) return refuse("Couldn't start a match.");
        this.start(lobby, game, randomUUID(), fillWithNpcs(f.slots, game, level(it.level), seed), f.formed);
        return;
      }
      case "npc-propose": {
        const c = lobby.check;
        if (!c || !c.slots.some((s) => s.id === playerId)) return;
        if (!c.game.npc.fill || c.game.npcRoster.length === 0) return refuse("This game has no NPC players to play with.");
        if (c.slots.length >= c.game.settings.players.max) return refuse("The match is already full.");
        c.npc = { level: level(it.level), by: playerId, yes: new Set([playerId]) };
        // Everyone has to see the question and answer it: the first proposal buys the ready check a little time (once)
        if (!c.extended) {
          c.extended = true;
          c.deadline = Math.max(c.deadline, this.deps.now() + NPC_VOTE_MS);
        }
        this.sendFound(lobby);
        return;
      }
      case "npc-vote": {
        const c = lobby.check;
        if (!c || !c.npc || !c.slots.some((s) => s.id === playerId) || typeof it.yes !== "boolean") return;
        if (it.yes) c.npc.yes.add(playerId);
        else c.npc = null; // everyone must agree: one no ends the proposal
        this.sendFound(lobby);
        return;
      }
      case "again": {
        const m = p.match ? this.matches.get(p.match) : undefined;
        const seat = m?.seats.get(playerId);
        if (m?.ended && seat && seat.state === "in" && typeof it.yes === "boolean") seat.again = it.yes;
        return;
      }
      case "link": {
        const to = typeof it.to === "string" ? it.to : "";
        const kind = it.kind === "with" || it.kind === "against" ? it.kind : null;
        if (!kind || to === playerId || !lobby.subs.has(to)) return refuse("They aren't in this lobby.");
        const mine = lobby.links.filter((l) => l.a === playerId || l.b === playerId).length + lobby.asks.filter((a) => a.from === playerId).length;
        if (mine >= MAX_LINKS) return refuse("That's enough links for now.");
        if (lobby.asks.some((a) => a.from === playerId && a.to === to)) return;
        lobby.asks.push({ from: playerId, to, kind });
        lobby.dirty = true;
        return;
      }
      case "link-answer": {
        const from = typeof it.from === "string" ? it.from : "";
        const i = lobby.asks.findIndex((a) => a.from === from && a.to === playerId);
        if (i < 0 || typeof it.yes !== "boolean") return;
        const [ask] = lobby.asks.splice(i, 1);
        if (it.yes) {
          lobby.links = lobby.links.filter((l) => !((l.a === from && l.b === playerId) || (l.a === playerId && l.b === from)));
          lobby.links.push({ a: from, b: playerId, kind: ask.kind });
        }
        lobby.dirty = true;
        return;
      }
      case "unlink": {
        const other = typeof it.with === "string" ? it.with : "";
        const n = lobby.links.length;
        lobby.links = lobby.links.filter((l) => !((l.a === other && l.b === playerId) || (l.a === playerId && l.b === other)));
        if (n !== lobby.links.length) lobby.dirty = true;
        return;
      }
      case "watch": {
        this.stopWatching(playerId, p);
        if (typeof it.matchId !== "string") return;
        const m = this.matches.get(it.matchId);
        if (!m || m.worldId !== worldId || m.ended) return refuse("That match is over.");
        if (p.match === m.id) return;
        m.watchers.set(playerId, m.events.length);
        p.watching = m.id;
        lobby.dirty = true;
        return;
      }
      case "leave": {
        const m = p.match ? this.matches.get(p.match) : undefined;
        const seat = m?.seats.get(playerId);
        if (!m || !seat || seat.state !== "in") return;
        if (!m.ended) m.controls.push({ type: "leave", slot: seat.slot });
        seat.state = "left";
        seat.again = false;
        this.release(m, seat, this.arrival(m));
        return;
      }
      case "rejoin": {
        const m = typeof it.matchId === "string" ? this.matches.get(it.matchId) : undefined;
        const seat = m?.seats.get(playerId);
        if (!m || m.worldId !== worldId || m.ended || !seat || (seat.state !== "held" && seat.state !== "dropped")) return refuse("That match is over.");
        this.rejoin(lobby, m, seat, p);
        return;
      }
      case "host": {
        if (!this.deps.isOwner(worldId, playerId)) return refuse("Only this world's creator and builders can do that.");
        if (it.cmd === "hold" || it.cmd === "release") {
          lobby.held = it.cmd === "hold";
          lobby.waitSince = null;
          lobby.dirty = true;
          return;
        }
        if (it.cmd !== "start") return;
        if (lobby.check) {
          lobby.check.deadline = this.deps.now(); // start early: the roster locks on the next tick
          return;
        }
        const game = lobby.game;
        if (!game || !this.ready(lobby)) return refuse("This game isn't ready to play yet.");
        const seed = this.deps.seed();
        const f = formMatch(this.units(lobby), game.settings, seed, { links: lobby.links, policy: "host-start", min: 1, allowEmptyTeams: true });
        if (!f) return refuse("Nobody is in the ring yet.");
        let slots = f.slots;
        if (slots.length < game.settings.players.min && game.npc.fill && game.npcRoster.length > 0) slots = fillWithNpcs(slots, game, DEFAULT_NPC_LEVEL, seed, "min");
        this.start(lobby, game, randomUUID(), slots, f.formed);
        return;
      }
      case "host-end": {
        if (!this.deps.isOwner(worldId, playerId)) return refuse("Only this world's creator and builders can do that.");
        const m = typeof it.matchId === "string" ? this.matches.get(it.matchId) : undefined;
        if (!m || m.worldId !== worldId || m.ended) return;
        if (!m.forced) {
          m.forced = "host";
          m.controls.push({ type: "host-end" });
        }
        return;
      }
    }
  }

  // ── Lobby ────────────────────────────────────────────────────────

  private lobby(worldId: string): Lobby {
    let l = this.lobbies.get(worldId);
    if (!l) {
      const now = this.deps.now();
      l = {
        worldId, game: this.deps.game(worldId), subs: new Set(), pool: new Map(), teams: [], held: false, waitSince: null, check: null,
        links: [], asks: [], dirty: false, lastSent: 0, lastSecond: now, matches: new Set(), finished: [],
      };
      this.lobbies.set(worldId, l);
    }
    return l;
  }

  /** Every intent counts as being in this world's lobby (a player is in one lobby at a time). */
  private subscribe(worldId: string, playerId: string): Lobby {
    const p = this.players.get(playerId);
    if (p && p.worldId !== worldId) {
      this.left(p.worldId, playerId);
      if (this.players.has(playerId)) p.worldId = worldId;
    }
    if (!this.players.has(playerId)) this.players.set(playerId, { worldId, match: null, watching: null });
    const lobby = this.lobby(worldId);
    lobby.subs.add(playerId);
    return lobby;
  }

  private ready(lobby: Lobby): boolean {
    return lobby.game !== null && gameMissing(lobby.game).length === 0;
  }

  private inRing(lobby: Lobby, pos: Pos): boolean {
    const ring = lobby.game?.lobby?.ring;
    if (!ring) return false;
    const r = ring.radius + RING_SLACK;
    return (pos.x - ring.at[0]) ** 2 + (pos.z - ring.at[2]) ** 2 <= r * r && Math.abs(pos.y - ring.at[1]) <= RING_HEIGHT_SLACK;
  }

  private cannotQueue(lobby: Lobby, playerId: string, p: PlayerAt): string | null {
    if (!this.ready(lobby)) return "This game isn't ready to play yet.";
    if (p.match) return "You're already in a match.";
    const pos = this.deps.position(lobby.worldId, playerId);
    if (pos && !this.inRing(lobby, pos)) return "Stand in the ring to play.";
    return null;
  }

  private enqueue(lobby: Lobby, playerId: string): void {
    if (lobby.pool.has(playerId)) return;
    lobby.pool.set(playerId, this.deps.now());
    const p = this.players.get(playerId);
    if (p) this.stopWatching(playerId, p);
    lobby.dirty = true;
  }

  /** Out of the pool (stepping out, leaving, joining a match). During a ready check that declines it. */
  private unqueue(lobby: Lobby, playerId: string): void {
    if (!lobby.pool.delete(playerId)) return;
    lobby.teams = lobby.teams.map((t) => t.filter((id) => id !== playerId)).filter((t) => t.length > 1);
    lobby.dirty = true;
    if (lobby.pool.size < (lobby.game?.settings.players.min ?? 1)) lobby.waitSince = null;
    if (lobby.check?.slots.some((s) => s.id === playerId)) this.decline(lobby, lobby.check, playerId);
  }

  /** The pool as matchmaker units, leaving out anyone already in the ready check. */
  private units(lobby: Lobby): PoolUnit[] {
    const busy = new Set(lobby.check?.slots.map((s) => s.id) ?? []);
    const inTeam = new Set<string>();
    const units: PoolUnit[] = [];
    for (const team of lobby.teams) {
      const here = team.filter((id) => lobby.pool.has(id) && !busy.has(id));
      if (here.length < 2) continue;
      here.forEach((id) => inTeam.add(id));
      units.push({ players: here.map((id) => ({ id, name: this.deps.name(id) })), together: true });
    }
    for (const id of lobby.pool.keys()) if (!busy.has(id) && !inTeam.has(id)) units.push({ players: [{ id, name: this.deps.name(id) }] });
    return units;
  }

  private tickLobby(lobby: Lobby, now: number): void {
    // Once a second: who walked out of the ring or went offline, old rows, empty lobbies
    if (now - lobby.lastSecond >= 1000) {
      lobby.lastSecond = now;
      for (const [id, since] of [...lobby.pool]) {
        if (!this.deps.online(lobby.worldId, id)) { this.unqueue(lobby, id); continue; }
        if (now - since < RING_GRACE_MS) continue;
        const pos = this.deps.position(lobby.worldId, id);
        if (pos && !this.inRing(lobby, pos)) this.unqueue(lobby, id);
      }
      const n = lobby.finished.length;
      lobby.finished = lobby.finished.filter((r) => now - (r.endedAt ?? now) < FINISHED_LIST_MS);
      if (n !== lobby.finished.length) lobby.dirty = true;
      // Scores and rounds of running matches move: refresh the list while someone is looking
      if (lobby.matches.size > 0 && lobby.subs.size > 0) lobby.dirty = true;
      if (lobby.subs.size === 0 && lobby.matches.size === 0 && !lobby.check) {
        this.lobbies.delete(lobby.worldId);
        return;
      }
    }

    const game = lobby.game;
    if (lobby.check) {
      if (now >= lobby.check.deadline) this.lock(lobby, lobby.check);
    } else if (game && !lobby.held && this.ready(lobby) && lobby.pool.size >= game.settings.players.min) {
      if (lobby.waitSince === null) lobby.waitSince = now;
      if (lobby.pool.size >= game.settings.players.max || now - lobby.waitSince >= POOL_WAIT_MS) {
        lobby.waitSince = null;
        const f = formMatch(this.units(lobby), game.settings, this.deps.seed(), { links: lobby.links });
        if (f) {
          lobby.check = { matchId: randomUUID(), game, slots: f.slots, formed: f.formed, deadline: now + READY_MS, npc: null };
          this.sendFound(lobby);
          if (game.npc.host) this.deps.chat(lobby.worldId, HOST_LINES.found);
        }
      }
    } else {
      lobby.waitSince = null;
    }

    if (lobby.dirty && now - lobby.lastSent >= LOBBY_SEND_MS) {
      lobby.dirty = false;
      lobby.lastSent = now;
      const rows = this.rows(lobby);
      for (const id of lobby.subs) {
        // Players inside a match get the lobby again when they come back
        if (!this.players.get(id)?.match) this.deps.send(id, lobby.worldId, this.lobbyState(lobby, id, rows));
      }
    }
  }

  private rows(lobby: Lobby): LobbyMatchRow[] {
    const rows: LobbyMatchRow[] = [];
    for (const id of lobby.matches) {
      const m = this.matches.get(id);
      if (!m || m.ended) continue;
      rows.push({ id, phase: m.state.phase, round: m.state.round, scores: m.state.scores, players: m.setup.slots.length, watching: m.watchers.size, startedAt: m.startedAt });
    }
    return [...rows, ...lobby.finished];
  }

  private lobbyState(lobby: Lobby, playerId: string, rows: LobbyMatchRow[]): LobbyState {
    const awayIn = this.away.get(playerId);
    const awayMatch = awayIn ? this.matches.get(awayIn) : undefined;
    return {
      t: "lobby",
      gameVersion: lobby.game?.version ?? 0,
      ready: this.ready(lobby),
      pool: lobby.pool.size,
      queued: lobby.pool.has(playerId),
      held: lobby.held,
      matches: rows,
      links: lobby.links.filter((l) => l.a === playerId || l.b === playerId).map((l) => {
        const other = l.a === playerId ? l.b : l.a;
        return { with: other, name: this.deps.name(other), kind: l.kind };
      }),
      asks: lobby.asks.filter((a) => a.to === playerId).map((a) => ({ from: a.from, name: this.deps.name(a.from), kind: a.kind })),
      rejoin: awayMatch && !awayMatch.ended && awayMatch.worldId === lobby.worldId ? awayMatch.id : null,
    };
  }

  private sendLobby(lobby: Lobby, playerId: string): void {
    this.deps.send(playerId, lobby.worldId, this.lobbyState(lobby, playerId, this.rows(lobby)));
  }

  // ── Ready check ──────────────────────────────────────────────────

  private sendFound(lobby: Lobby): void {
    const c = lobby.check;
    if (!c) return;
    const humans = c.slots.filter((s) => s.kind === "human");
    const readyMs = Math.max(0, c.deadline - this.deps.now());
    const npc = c.npc ? { level: c.npc.level, by: c.npc.by, votes: humans.filter((s) => c.npc!.yes.has(s.id)).length, needed: humans.length } : null;
    for (const s of humans) this.deps.send(s.id, lobby.worldId, { t: "found", matchId: c.matchId, you: { slot: s.slot, team: s.team }, roster: c.slots, readyMs, npc });
  }

  private cancelCheck(lobby: Lobby): void {
    const c = lobby.check;
    if (!c) return;
    lobby.check = null;
    lobby.waitSince = null;
    for (const s of c.slots) this.deps.send(s.id, lobby.worldId, { t: "cancel", matchId: c.matchId });
  }

  /** Someone stepped out during the ready check: fill their slot from the pool, go on without them, or call it off. */
  private decline(lobby: Lobby, c: Check, playerId: string): void {
    const gone = c.slots.find((s) => s.id === playerId);
    if (!gone) return;
    this.deps.send(playerId, lobby.worldId, { t: "cancel", matchId: c.matchId });
    c.npc?.yes.delete(playerId);
    if (c.npc?.by === playerId) c.npc = null;
    // A single player from the rest of the pool takes the slot (same team)
    const singles = this.units(lobby).filter((u) => u.players.length === 1 && !lobby.links.some((l) => l.kind === "with" && (l.a === u.players[0].id || l.b === u.players[0].id)));
    if (singles.length > 0) {
      const pick = singles[Math.floor(((this.deps.seed() >>> 0) / 4294967296) * singles.length)].players[0];
      c.slots = c.slots.map((s) => (s === gone ? { ...s, id: pick.id, name: pick.name } : s));
    } else {
      c.slots = c.slots.filter((s) => s !== gone);
      const teams = c.game.settings.teams;
      const emptyTeam = teams > 1 && Array.from({ length: teams }, (_, t) => t + 1).some((t) => !c.slots.some((s) => s.team === t));
      if (c.slots.length < c.game.settings.players.min || emptyTeam) return this.cancelCheck(lobby);
    }
    const ids = new Set(c.slots.map((s) => s.id));
    c.formed = {
      ...c.formed,
      links: lobby.links.filter((l) => ids.has(l.a) && ids.has(l.b)).map((l) => ({ ...l })),
      together: c.formed.together.map((g) => g.filter((id) => ids.has(id))).filter((g) => g.length > 1),
    };
    this.sendFound(lobby);
  }

  /** The ready check ran out: whoever is still in it plays. */
  private lock(lobby: Lobby, c: Check): void {
    lobby.check = null;
    let slots = [...c.slots].sort((a, b) => a.team - b.team || a.slot - b.slot).map((s, i) => ({ ...s, slot: i }));
    const humans = slots.length;
    if (humans === 0) return;
    if (c.npc && slots.every((s) => c.npc!.yes.has(s.id))) slots = fillWithNpcs(slots, c.game, c.npc.level, c.formed.seed);
    this.start(lobby, c.game, c.matchId, slots, c.formed);
  }

  // ── A match ──────────────────────────────────────────────────────

  private start(lobby: Lobby, game: Game, matchId: string, slots: MatchSlot[], formed: MatchSetup["formed"]): void {
    const now = this.deps.now();
    const worldId = lobby.worldId;
    const setup: MatchSetup = { matchId, worldId, game, seed: this.deps.seed(), simVersion: MATCH_SIM_VERSION, slots, formed };
    const humans = slots.filter((s) => s.kind === "human");
    let state: MatchState;
    const minds = new Map<number, NpcMind>();
    try {
      state = this.referee.initMatch(setup);
      for (const s of slots) if (s.kind === "npc") minds.set(s.slot, this.npc.initNpc(setup, s.slot));
      const researchIds: Record<string, string | undefined> = {};
      for (const s of humans) researchIds[s.id] = this.deps.researchId(s.id);
      // No match runs unrecorded: if the record can't be opened, the match doesn't start
      const candidates = new Set(humans.filter((s) => this.deps.researchCandidate?.(s.id)).map((s) => s.id));
      this.deps.store.begin(setup, now, researchIds, candidates);
    } catch (err) {
      console.error(`[match] ${matchId} could not start:`, err);
      for (const s of humans) this.deps.send(s.id, worldId, { t: "error", message: "The match couldn't start. Try again in a moment." });
      for (const s of humans) this.deps.send(s.id, worldId, { t: "cancel", matchId });
      // Out of the pool, so a broken game doesn't form the same failing match every few seconds
      for (const s of humans) lobby.pool.delete(s.id);
      lobby.dirty = true;
      return;
    }
    const m: Running = {
      id: matchId, worldId, setup, state, startedAt: now, frames: [], lastFlush: now, events: [],
      seats: new Map(), seatBySlot: new Map(), minds, controls: [], watchers: new Map(), emptySince: null, forced: null, ended: null,
    };
    this.matches.set(matchId, m);
    lobby.matches.add(matchId);
    for (const s of humans) {
      const seat: Seat = { playerId: s.id, slot: s.slot, team: s.team, state: "in", offSince: null, last: null, pin: null, sent: 0, again: null };
      m.seats.set(s.id, seat);
      m.seatBySlot.set(s.slot, seat);
      lobby.pool.delete(s.id);
      const p = this.players.get(s.id) ?? { worldId, match: null, watching: null };
      this.players.set(s.id, p);
      this.stopWatching(s.id, p);
      p.match = matchId;
      this.away.delete(s.id);
      this.deps.setGroup(s.id, `${worldId}#${matchId}`);
      this.sendStart(m, seat, now + START_PIN_MS);
    }
    lobby.teams = lobby.teams.map((t) => t.filter((id) => lobby.pool.has(id))).filter((t) => t.length > 1);
    lobby.waitSince = null;
    lobby.dirty = true;
    if (game.npc.host) {
      const heads = Array.from({ length: Math.max(1, game.settings.teams) }, (_, t) => slots.filter((s) => s.team === t + 1).length);
      this.deps.chat(worldId, HOST_LINES.started(heads));
    }
    console.log(`[match] ${matchId} started in ${worldId}: ${humans.length} human(s), ${slots.length - humans.length} NPC(s), game v${game.version}, ${formed.policy}`);
  }

  private face(m: Running): Vec3 {
    const a = m.setup.game.arena;
    return a ? [a.at[0], q(a.at[1] + 1), a.at[2]] : [0, 0, 0];
  }

  /** Tell a player they are in the match, at their spawn. `pinUntil` holds their samples there until presence catches up. */
  private sendStart(m: Running, seat: Seat, pinUntil: number | null): void {
    const spawn = spawnPoint(m.setup, seat.slot);
    if (pinUntil !== null) seat.pin = { to: spawn, until: pinUntil };
    this.deps.send(seat.playerId, m.worldId, { t: "start", matchId: m.id, you: { slot: seat.slot, team: seat.team }, roster: m.setup.slots, gameVersion: m.setup.game.version, spawn, face: this.face(m) });
  }

  private move(m: Running, seat: Seat, to: Vec3, why: "return" | "round" | "rejoin", now: number): void {
    seat.pin = { to, until: now + PIN_MS };
    this.deps.send(seat.playerId, m.worldId, { t: "move", matchId: m.id, to, face: this.face(m), why });
  }

  private tickMatch(m: Running, now: number): void {
    const samples: Sample[] = [];
    let humansOn = 0;
    for (const seat of m.seats.values()) {
      if (seat.state !== "in") continue;
      if (!this.deps.online(m.worldId, seat.playerId)) {
        if (seat.offSince === null) seat.offSince = now;
        if (now - seat.offSince >= DROP_GRACE_MS) this.drop(m, seat);
        continue;
      }
      seat.offSince = null;
      humansOn++;
      const pos = this.deps.position(m.worldId, seat.playerId);
      let at: Pos | null = pos ? { x: q(pos.x), y: q(pos.y), z: q(pos.z) } : null;
      if (seat.pin) {
        const [px, py, pz] = seat.pin.to;
        const near = at !== null && (at.x - px) ** 2 + (at.y - py) ** 2 + (at.z - pz) ** 2 <= PIN_NEAR * PIN_NEAR;
        if (near || now >= seat.pin.until) seat.pin = null;
        else at = { x: q(px), y: q(py), z: q(pz) };
      }
      if (!at) continue;
      seat.last = at;
      samples.push({ slot: seat.slot, x: at.x, y: at.y, z: at.z });
    }
    for (const [slot, mind] of m.minds) {
      let next = mind;
      try {
        next = this.npc.stepNpc(m.setup, m.state, slot, mind);
      } catch (err) {
        if (m.state.tick % 600 === 0) console.error(`[match] ${m.id} NPC ${slot} failed:`, err);
      }
      m.minds.set(slot, next);
      samples.push({ slot, x: q(next.x), y: q(next.y), z: q(next.z) });
    }
    samples.sort((a, b) => a.slot - b.slot);

    // Nobody here, or it has run too long: ended through the referee, like a host ending it
    if (humansOn === 0) {
      if (m.emptySince === null) m.emptySince = now;
    } else {
      m.emptySince = null;
    }
    if (!m.forced) {
      const why = m.emptySince !== null && now - m.emptySince >= EMPTY_MATCH_MS ? "empty" : now - m.startedAt >= MAX_MATCH_MS ? "time" : null;
      if (why) {
        m.forced = why;
        m.controls.push({ type: "host-end" });
      }
    }

    const controls = m.controls;
    m.controls = [];
    const step = this.referee.stepMatch(m.setup, m.state, samples, controls);
    if (samples.length > 0 || controls.length > 0) m.frames.push({ t: step.state.tick, s: packSamples(samples), ...(controls.length > 0 ? { c: controls } : {}) });
    m.state = step.state;
    for (const e of step.events) m.events.push(e);
    if (now - m.lastFlush >= FLUSH_MS) this.flush(m, now);

    // The referee sent someone back: move the human, or put the NPC there
    for (const e of step.events) {
      if (e.type !== "return" || !e.to || e.slot === undefined) continue;
      const mind = m.minds.get(e.slot);
      const seat = m.seatBySlot.get(e.slot);
      if (mind) m.minds.set(e.slot, { ...mind, x: e.to[0], y: e.to[1], z: e.to[2], goal: null });
      else if (seat && seat.state === "in") this.move(m, seat, e.to, e.why === "round" ? "round" : "return", now);
    }

    this.sendSnaps(m);
    if (m.state.phase === "finished" || (m.forced && controls.some((c) => c.type === "host-end"))) this.end(m, m.forced ?? undefined);
  }

  private sendSnaps(m: Running): void {
    const s = m.state;
    const players: SnapPlayer[] = s.players.map((p) => ({
      slot: p.slot, x: p.x, y: p.y, z: p.z,
      ...(p.out || p.left ? { out: true } : {}),
      ...(p.carrying ? { carrying: p.carrying } : {}),
      ...(p.outsideTicks > 0 || p.keepOutTicks > 0 ? { outside: Math.max(p.outsideTicks, p.keepOutTicks) } : {}),
      ...(p.score ? { score: p.score } : {}),
    }));
    const items: SnapItem[] = s.items.filter((i) => i.active).map((i) => ({ id: i.id, kind: i.kind, ...(i.team !== undefined ? { team: i.team } : {}), x: i.x, y: i.y, z: i.z, heldBy: i.heldBy }));
    const total = m.events.length;
    const none: MatchEvent[] = [];
    const snap = (from: number): MatchMessage => ({
      t: "snap", matchId: m.id, tick: s.tick, phase: s.phase, round: s.round, left: s.left, scores: s.scores, rounds: s.rounds, hill: s.hill,
      players, items, watching: m.watchers.size, events: from >= total ? none : m.events.slice(from),
    });
    for (const seat of m.seats.values()) {
      if (seat.state !== "in") continue;
      this.deps.send(seat.playerId, m.worldId, snap(seat.sent));
      seat.sent = total;
    }
    for (const [id, from] of m.watchers) {
      this.deps.send(id, m.worldId, snap(from));
      m.watchers.set(id, total);
    }
  }

  private flush(m: Running, now: number): void {
    m.lastFlush = now;
    if (m.frames.length === 0) return;
    const frames = m.frames;
    m.frames = [];
    try {
      this.deps.store.appendFrames(m.id, frames);
    } catch (err) {
      console.error(`[match] ${m.id} LOST ${frames.length} recorded frames:`, err);
    }
  }

  /** A player has been gone past the grace period: an NPC keeps the slot (if the game allows), and they may come back. */
  private drop(m: Running, seat: Seat): void {
    const game = m.setup.game;
    seat.state = "dropped";
    seat.pin = null;
    if (game.npc.hold && game.npcRoster.length > 0) {
      seat.state = "held";
        try {
        const mind = this.npc.initNpc(m.setup, seat.slot);
        m.minds.set(seat.slot, seat.last ? { ...mind, x: seat.last.x, y: seat.last.y, z: seat.last.z } : mind);
        m.controls.push({ type: "swap", slot: seat.slot, to: "npc" });
      } catch (err) {
        console.error(`[match] ${m.id} no NPC for slot ${seat.slot}:`, err);
        seat.state = "dropped";
          }
    }
    this.away.set(seat.playerId, m.id);
    this.deps.setGroup(seat.playerId, null);
    const p = this.players.get(seat.playerId);
    if (p && p.match === m.id) {
      p.match = null;
      if (!this.lobbies.get(p.worldId)?.subs.has(seat.playerId)) this.players.delete(seat.playerId);
    }
    const lobby = this.lobbies.get(m.worldId);
    if (lobby) lobby.dirty = true;
  }

  private rejoin(lobby: Lobby, m: Running, seat: Seat, p: PlayerAt): void {
    const now = this.deps.now();
    this.unqueue(lobby, seat.playerId);
    this.stopWatching(seat.playerId, p);
    const mind = m.minds.get(seat.slot);
    const at: Vec3 = mind ? [q(mind.x), q(mind.y), q(mind.z)] : seat.last ? [seat.last.x, seat.last.y, seat.last.z] : spawnPoint(m.setup, seat.slot);
    if (seat.state === "held") {
      m.minds.delete(seat.slot);
      m.controls.push({ type: "swap", slot: seat.slot, to: "human" });
    }
    seat.state = "in";
    seat.offSince = null;
    seat.sent = m.events.length;
    this.away.delete(seat.playerId);
    p.match = m.id;
    this.deps.setGroup(seat.playerId, `${m.worldId}#${m.id}`);
    this.sendStart(m, seat, null);
    this.move(m, seat, at, "rejoin", now);
    lobby.dirty = true;
  }

  private arrival(m: Running): Vec3 {
    return this.lobbies.get(m.worldId)?.game?.lobby?.arrival ?? m.setup.game.lobby?.arrival ?? [0, 0, 0];
  }

  /** Out of the instance and back in the lobby at `to`. */
  private release(m: Running, seat: Seat, to: Vec3): void {
    this.deps.setGroup(seat.playerId, null);
    const p = this.players.get(seat.playerId);
    if (p && p.match === m.id) p.match = null;
    this.deps.send(seat.playerId, m.worldId, { t: "back", to });
    const lobby = this.lobbies.get(m.worldId);
    if (lobby?.subs.has(seat.playerId)) this.sendLobby(lobby, seat.playerId);
  }

  private stopWatching(playerId: string, p: PlayerAt): void {
    if (!p.watching) return;
    const m = this.matches.get(p.watching);
    p.watching = null;
    if (m?.watchers.delete(playerId)) {
      const lobby = this.lobbies.get(m.worldId);
      if (lobby) lobby.dirty = true;
    }
  }

  // ── The end ──────────────────────────────────────────────────────

  private end(m: Running, why?: string): void {
    const now = this.deps.now();
    m.ended = { at: now };
    this.flush(m, now);
    let result: MatchResult | null = null;
    try {
      // Never with a `why` of our own: the result must be what replaying the record gives
      result = this.referee.resultOf(m.setup, m.state);
    } catch (err) {
      console.error(`[match] ${m.id} has no result:`, err);
    }
    try {
      this.deps.store.finish(m.id, m.events, result, now);
    } catch (err) {
      console.error(`[match] ${m.id} RECORD NOT FINISHED:`, err);
    }
    if (this.verify && result) {
      // The hard rule: replaying the record must give the same events and result
      try {
        const record = this.deps.store.record(m.id);
        if (!record || !this.verify(record)) console.error(`[match] ${m.id} RECORD DOES NOT VERIFY: replaying it does not reproduce its events and result`);
      } catch (err) {
        console.error(`[match] ${m.id} RECORD COULD NOT BE VERIFIED:`, err);
      }
    }

    // Awe for finishing (Q11): everyone still in it, winners and losers alike; a quarter when no other human played
    const humans = m.setup.slots.filter((s) => s.kind === "human").length;
    const amount = humans > 1 ? AWE_PER_MATCH : Math.ceil(AWE_PER_MATCH / 4);
    const roster = m.setup.slots;
    for (const seat of m.seats.values()) {
      if (seat.state !== "in") continue;
      let awe = 0;
      if (result) {
        try {
          awe = this.deps.awe(seat.playerId, amount, m.id);
        } catch (err) {
          console.error(`[match] ${m.id} awe failed:`, err);
        }
      }
      if (result) this.deps.send(seat.playerId, m.worldId, { t: "end", matchId: m.id, result, roster, awe, again: true });
    }
    for (const id of [...m.watchers.keys()]) {
      if (result) this.deps.send(id, m.worldId, { t: "end", matchId: m.id, result, roster, awe: 0, again: false });
      const p = this.players.get(id);
      if (p && p.watching === m.id) p.watching = null;
    }
    m.watchers.clear();
    for (const seat of m.seats.values()) if (seat.state !== "in") this.away.delete(seat.playerId);

    const lobby = this.lobbies.get(m.worldId);
    if (lobby) {
      lobby.finished.unshift({
        id: m.id, phase: "finished", round: m.state.round, scores: result ? (m.setup.game.settings.rounds > 1 ? result.rounds : result.scores) : m.state.scores,
        players: roster.length, watching: 0, startedAt: m.startedAt, endedAt: now, ...(result ? { winner: result.winner } : {}),
      });
      lobby.dirty = true;
    }
    if (m.setup.game.npc.host) this.deps.chat(m.worldId, HOST_LINES.over(result ? result.winner : null, m.setup.game.settings.teams));
    console.log(`[match] ${m.id} ended (${result?.why ?? why ?? "no result"}): winner ${result?.winner ?? "none"}, ${m.state.tick} ticks`);
    if (!result) this.wrapUp(m);
  }

  /** The results are up: wait for everyone's "play again together" answer, at most AGAIN_MS. */
  private tickEnded(m: Running, now: number): void {
    const waiting = [...m.seats.values()].some((s) => s.state === "in" && s.again === null && this.deps.online(m.worldId, s.playerId));
    if (waiting && now - m.ended!.at < AGAIN_MS) return;
    this.wrapUp(m);
  }

  /** Everyone back to the lobby. A team whose humans all said yes goes back into the pool as one unit, standing in the ring. */
  private wrapUp(m: Running): void {
    const now = this.deps.now();
    this.matches.delete(m.id);
    const lobby = this.lobbies.get(m.worldId);
    lobby?.matches.delete(m.id);
    const ring = lobby?.game?.lobby?.ring.at;
    const here = [...m.seats.values()].filter((s) => s.state === "in");
    const teams = new Map<number, Seat[]>();
    for (const s of here) teams.set(s.team, [...(teams.get(s.team) ?? []), s]);
    for (const seats of teams.values()) {
      const together = lobby !== undefined && ring !== undefined && this.ready(lobby)
        && seats.every((s) => s.again === true && lobby.subs.has(s.playerId) && this.deps.online(m.worldId, s.playerId));
      if (together && lobby && ring) {
        for (const s of seats) lobby.pool.set(s.playerId, now);
        if (seats.length > 1) lobby.teams.push(seats.map((s) => s.playerId));
        lobby.dirty = true;
      }
      for (const s of seats) this.release(m, s, together && ring ? ring : this.arrival(m));
    }
    for (const s of m.seats.values()) {
      this.away.delete(s.playerId);
      const p = this.players.get(s.playerId);
      if (p && !this.lobbies.get(p.worldId)?.subs.has(s.playerId) && !p.match) this.players.delete(s.playerId);
    }
    if (lobby) lobby.dirty = true;
  }
}

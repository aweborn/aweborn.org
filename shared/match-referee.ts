/**
 * The referee's rule step (see match.ts for the contract and the recording model).
 *
 * Everything here is a pure function of (setup, state, this tick's samples and controls):
 * no clock, no Math.random (randomness is `state.rng` through `rand`), arguments are
 * never mutated, and the state is plain JSON (no undefined fields, no classes), so a
 * state that went through JSON continues exactly as the original would have.
 *
 * Assumptions made for the rough draft (2026-11-23), all changeable:
 * - **Ticks.** A match starts at tick 0 (`initMatch`). `round-start` (value = round) and a
 *   `return` (why "round") per player are emitted on the first tick of a round's
 *   countdown: tick 1 for round 1, the tick the break ends for later rounds. The round's
 *   `round-end` is followed by `match-end` in the same tick when the match is decided:
 *   there is no break after the last round. A finished match no longer steps (the tick
 *   stays where it ended).
 * - **Early end.** With more than one team the match ends as soon as the leader can no
 *   longer be caught in the rounds that remain.
 * - **Being sent back.** After a `return` the player is held at `to` for RETURN_GRACE_TICKS
 *   ticks, or until a fresh sample lands within RETURN_NEAR_M of it (the client has
 *   moved), whichever comes first. Samples from the old place are ignored meanwhile, so
 *   nobody is returned twice or scores twice from where they no longer are. Edge and
 *   keep-out checks are skipped during that grace.
 * - **Countdown and break.** Positions and zones are tracked silently (no events, no
 *   scoring, no edge checks). Someone standing in a goal when play begins has not
 *   "entered" it.
 * - **`out-of-bounds`** is emitted for every edge kind (before the `return` for `instant`
 *   and `wall`), so rules can react to it. With `wall`, up to WALL_SLACK_M outside
 *   counts as inside (the client clamps).
 * - **Round winner.** With several teams: the highest round score, a draw (0) when the
 *   best is shared. With one team: team 1 wins only by reaching `scoreToWin` (survive:
 *   by anyone surviving). `build-together` on time is nobody's (0).
 * - **Scores** never go below 0; a `score` event always carries the change that was
 *   really applied, so summing `score` events per team per round gives the scoreboard.
 *   A player's own `score` counts what they did over the whole match (goals, pickups,
 *   captures, pieces, hill seconds stood, rounds survived); it is not reset per round.
 * - **Survive** has no running score: when the round ends every player still in scores
 *   1 for their team. `returns` counts every time a player was sent back as a penalty
 *   (edge, keep-out, rule), not round starts or the walk back after a race goal.
 * - **Items.** Touching = within TOUCH_M (horizontal) and TOUCH_Y_M (vertical). A
 *   carried item dropped outside the arena or inside a keep-out zone goes straight home
 *   (it could not be reached). A flag sent home emits `drop` with why "home" and no slot.
 *   Build pieces: min(scoreToWin, MAX_ITEMS) lie around; a delivered piece is gone, unless
 *   more deliveries are needed than there are pieces (several teams, or a big
 *   scoreToWin): then it reappears somewhere else after RESPAWN_TICKS.
 * - **King of the hill.** A point for every 10 ticks in a row the same team holds the
 *   hill: it has more players on it than any other team (equal numbers contest it).
 *   Losing or contesting it restarts that second. (It was "alone on it" at first: with
 *   NPCs on every team, who all walk to the hill, nobody ever scored.)
 * - **Rules.** `match-start` and `round-start` rules run on the first playing tick (round
 *   1's, every round's), so their actions land on a running clock. Without an actor,
 *   `score` is the best team's score, `other-score` the second best, and `others` means
 *   every team. Rule variables keep their values between rounds. Vars are whole numbers
 *   clamped to ±VAR_LIMIT. `end-round` stops the rest of that tick's rules (why "rule").
 */
import {
  GAME_LIMITS, boundsOf, inBounds, inBox,
  type Bounds, type Game, type GameBox, type GameRule, type GameZone, type RuleAction, type RuleCondition, type RuleEvent, type Vec3,
} from "./game.js";
import {
  MATCH_TICK_MS, ROUND_BREAK_MS, ROUND_COUNTDOWN_MS, q, rand, spawnPoint, unpackSamples,
  type ControlInput, type MatchEvent, type MatchItem, type MatchRecord, type MatchResult, type MatchSetup, type MatchState, type PlayerState, type Sample,
} from "./match.js";

// match.ts re-exports this file, so the two import each other: nothing from match.ts may
// be read while this module loads. These stay literals, checked against it in the tests.
/** Referee ticks per second (1000 / MATCH_TICK_MS). */
export const TICKS_PER_SECOND = 10;
const countdownTicks = (): number => Math.round(ROUND_COUNTDOWN_MS / MATCH_TICK_MS);
const breakTicks = (): number => Math.round(ROUND_BREAK_MS / MATCH_TICK_MS);
/** How long a returned player is held at their spawn while their client catches up. */
export const RETURN_GRACE_TICKS = 10;
/** A fresh sample this close to the spawn ends the grace early. */
export const RETURN_NEAR_M = 3;
/** `wall` edge: farther outside than this means the clamp failed, so straight back. */
export const WALL_SLACK_M = 1.5;
/** Reach for taking a pickup, a flag or a piece. */
export const TOUCH_M = 1.5;
export const TOUCH_Y_M = 3;
/** A taken pickup reappears after this. */
export const RESPAWN_TICKS = 5 * TICKS_PER_SECOND;
/** Most pickups or pieces lying around at once. */
export const MAX_ITEMS = 24;
/** Without goal zones, the build site is this close to the arena's middle. */
export const SITE_RADIUS_M = 3;
const VAR_LIMIT = 9999;
const SCORE_LIMIT = 99999;
/** Only used to place items if a match is somehow started without an arena. */
const FALLBACK_ARENA: GameBox = { at: [0, 0, 0], size: [40, 20, 40] };

// ── Small helpers ──────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const teamCount = (game: Game): number => Math.max(1, game.settings.teams);
const isIn = (p: PlayerState): boolean => !p.left && !p.out;

function cloneState(s: MatchState): MatchState {
  return {
    ...s,
    scores: [...s.scores],
    rounds: [...s.rounds],
    vars: [s.vars[0], s.vars[1], s.vars[2]],
    players: s.players.map((p) => ({ ...p, zones: [...p.zones], grace: p.grace ?? 0, roundReturns: p.roundReturns ?? 0 })),
    items: s.items.map((i) => ({ ...i, home: [i.home[0], i.home[1], i.home[2]], respawn: i.respawn ?? 0 })),
    played: s.played ?? 0,
    hillTicks: s.hillTicks ?? 0,
    fired: [...(s.fired ?? [])],
  };
}

/** A rule trigger: what happened, who caused it, and how deep in a cascade it is. */
interface Trigger { event: RuleEvent; slot?: number; team?: number; zone?: string; depth: number }

/** One tick's working set (the state inside is this tick's own copy). */
interface Ctx {
  setup: MatchSetup;
  game: Game;
  s: MatchState;
  events: MatchEvent[];
  triggers: Trigger[];
  teams: number;
  arena: Bounds | null;
  teamBySlot: Map<number, number>;
  /** A rule asked for the round to end. */
  end: { winner: number; why: string } | null;
}

function makeCtx(setup: MatchSetup, s: MatchState): Ctx {
  const teams = teamCount(setup.game);
  return {
    setup, game: setup.game, s, events: [], triggers: [], teams,
    arena: setup.game.arena ? boundsOf(setup.game.arena) : null,
    teamBySlot: new Map(setup.slots.map((x) => [x.slot, clamp(Math.round(x.team) || 1, 1, teams)])),
    end: null,
  };
}

const teamOf = (c: Ctx, slot: number): number => c.teamBySlot.get(slot) ?? 1;

/** Add an event, leaving out fields that are not set (the record is JSON: no undefined). */
function emit(c: Ctx, type: MatchEvent["type"], f: Omit<MatchEvent, "tick" | "type"> = {}): void {
  const e: MatchEvent = { tick: c.s.tick, type };
  if (f.slot !== undefined) e.slot = f.slot;
  if (f.team !== undefined) e.team = f.team;
  if (f.zone !== undefined) e.zone = f.zone;
  if (f.item !== undefined) e.item = f.item;
  if (f.value !== undefined) e.value = f.value;
  if (f.to !== undefined) e.to = [f.to[0], f.to[1], f.to[2]];
  if (f.why !== undefined) e.why = f.why;
  c.events.push(e);
}

const keepOuts = (game: Game): GameZone[] => game.zones.filter((z) => z.kind === "keep-out");
const goals = (game: Game): GameZone[] => game.zones.filter((z) => z.kind === "goal");
const overXZ = (b: Bounds, x: number, z: number): boolean => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
const touches = (p: PlayerState, it: MatchItem): boolean =>
  Math.hypot(p.x - it.x, p.z - it.z) <= TOUCH_M && Math.abs(p.y - it.y) <= TOUCH_Y_M;

/** How far outside a box a point is (0 = inside). */
function outsideBy(b: Bounds, x: number, y: number, z: number): number {
  return Math.max(b.minX - x, x - b.maxX, b.minY - y, y - b.maxY, b.minZ - z, z - b.maxZ, 0);
}

/** Where the build site is: the goal zones, or around the arena's middle when there are none. */
function inSite(game: Game, x: number, y: number, z: number): boolean {
  const g = goals(game);
  if (g.length) return g.some((zone) => inBox(zone, x, y, z));
  const mid = (game.arena ?? FALLBACK_ARENA).at;
  return Math.hypot(x - mid[0], z - mid[2]) <= SITE_RADIUS_M;
}

/** A team's base in capture the flag: its goal zone, else its spawn zone. */
const baseOf = (game: Game, team: number): GameZone | undefined =>
  game.zones.find((z) => z.kind === "goal" && z.team === team) ?? game.zones.find((z) => z.kind === "spawn" && z.team === team);

function flagHome(game: Game, team: number): Vec3 {
  const at = baseOf(game, team)?.at ?? (game.arena ?? FALLBACK_ARENA).at;
  return [q(at[0]), q(at[1] + 1), q(at[2])];
}

function inBase(game: Game, team: number, p: PlayerState): boolean {
  const base = baseOf(game, team);
  if (base) return inBox(base, p.x, p.y, p.z);
  const h = flagHome(game, team);
  return Math.hypot(p.x - h[0], p.z - h[2]) <= SITE_RADIUS_M;
}

/**
 * A random spot on the arena floor (1.5 m up), away from keep-out zones and from `avoid`.
 * Draws from `state.rng`; gives up after a few tries and takes the last one, so a
 * badly crowded arena still gets its items.
 */
function randomSpot(game: Game, s: MatchState, avoid?: (x: number, z: number) => boolean): Vec3 {
  const box = game.arena ?? FALLBACK_ARENA;
  const b = boundsOf(box);
  const mx = Math.min(1, box.size[0] / 4), mz = Math.min(1, box.size[2] / 4);
  const blocked = keepOuts(game).map(boundsOf);
  let x = box.at[0], z = box.at[2];
  for (let i = 0; i < 24; i++) {
    let u: number, v: number;
    [s.rng, u] = rand(s.rng);
    [s.rng, v] = rand(s.rng);
    x = q(b.minX + mx + u * (box.size[0] - 2 * mx));
    z = q(b.minZ + mz + v * (box.size[2] - 2 * mz));
    if (!blocked.some((k) => overXZ(k, x, z)) && !avoid?.(x, z)) break;
  }
  return [x, q(box.at[1] + 1.5), z];
}

/** The round's items, placed afresh (uses and advances `s.rng`). */
function placeItems(setup: MatchSetup, s: MatchState): MatchItem[] {
  const game = setup.game;
  const items: MatchItem[] = [];
  const lying = (id: string, kind: MatchItem["kind"], at: Vec3): MatchItem =>
    ({ id, kind, x: at[0], y: at[1], z: at[2], home: [at[0], at[1], at[2]], heldBy: null, active: true, respawn: 0 });
  if (game.template === "collect") {
    const n = clamp(3 * setup.slots.length, 6, MAX_ITEMS);
    for (let i = 1; i <= n; i++) items.push(lying(`pickup-${i}`, "pickup", randomSpot(game, s)));
  } else if (game.template === "capture-the-flag") {
    const teams = teamCount(game);
    for (let t = 1; teams > 1 && t <= teams; t++) items.push({ ...lying(`flag-${t}`, "flag", flagHome(game, t)), team: t });
  } else if (game.template === "build-together") {
    const n = Math.min(game.settings.scoreToWin, MAX_ITEMS);
    const mid = (game.arena ?? FALLBACK_ARENA).at;
    const site = goals(game).map(boundsOf);
    const avoid = (x: number, z: number): boolean =>
      site.length ? site.some((b) => overXZ(b, x, z)) : Math.hypot(x - mid[0], z - mid[2]) <= SITE_RADIUS_M + TOUCH_M;
    for (let i = 1; i <= n; i++) items.push(lying(`piece-${i}`, "piece", randomSpot(game, s, avoid)));
  }
  return items;
}

// ── Start ──────────────────────────────────────────────────────────────

/** The state before the first tick: round 1's countdown, everyone at their spawn, items placed. */
export function initMatch(setup: MatchSetup): MatchState {
  const teams = teamCount(setup.game);
  const s: MatchState = {
    tick: 0,
    phase: "countdown",
    round: 1,
    left: countdownTicks(),
    scores: new Array<number>(teams).fill(0),
    rounds: new Array<number>(teams).fill(0),
    players: setup.slots.map((slot) => {
      const [x, y, z] = spawnPoint(setup, slot.slot);
      return { slot: slot.slot, x, y, z, fresh: false, out: false, left: false, outsideTicks: 0, keepOutTicks: 0, carrying: null, score: 0, returns: 0, zones: [], grace: 0, roundReturns: 0 };
    }),
    items: [],
    hill: 0,
    vars: [0, 0, 0],
    rng: setup.seed | 0,
    winner: null,
    played: 0,
    hillTicks: 0,
    fired: [],
  };
  s.items = placeItems(setup, s);
  return s;
}

/** Reset for a round and tell everyone to go to their spawn. */
function startRound(c: Ctx, round: number, fresh: boolean): void {
  const s = c.s;
  s.round = round;
  s.phase = "countdown";
  s.left = countdownTicks();
  s.played = 0;
  s.hill = 0;
  s.hillTicks = 0;
  s.fired = [];
  if (!fresh) {
    // Round 1 was already laid out by initMatch
    s.scores = s.scores.map(() => 0);
    s.items = placeItems(c.setup, s);
  }
  emit(c, "round-start", { value: round });
  for (const p of s.players) {
    p.out = false;
    p.carrying = null;
    p.outsideTicks = 0;
    p.keepOutTicks = 0;
    p.roundReturns = 0;
    if (p.left) continue;
    const to = spawnPoint(c.setup, p.slot);
    [p.x, p.y, p.z] = to;
    p.grace = RETURN_GRACE_TICKS;
    emit(c, "return", { slot: p.slot, team: teamOf(c, p.slot), to, why: "round" });
  }
}

// ── Things that happen to players ──────────────────────────────────────

/** Put down whatever the player carries, where they stand (or at its home if nobody could reach it there). */
function dropCarried(c: Ctx, p: PlayerState): void {
  if (!p.carrying) return;
  const it = c.s.items.find((i) => i.id === p.carrying);
  p.carrying = null;
  if (!it) return;
  it.heldBy = null;
  const lost = (c.arena !== null && !inBounds(c.arena, p.x, p.y, p.z)) || keepOuts(c.game).some((z) => inBox(z, p.x, p.y, p.z));
  [it.x, it.y, it.z] = lost ? it.home : [p.x, p.y, p.z];
  emit(c, "drop", { slot: p.slot, team: teamOf(c, p.slot), item: it.id, to: [it.x, it.y, it.z] });
}

/**
 * Send a player back to their spawn. `penalty` returns (edge, keep-out, rules) count
 * in `returns`, and in survive they can put the player out for the round.
 */
function sendBack(c: Ctx, p: PlayerState, why: string, penalty: boolean): void {
  dropCarried(c, p);
  const to = spawnPoint(c.setup, p.slot);
  emit(c, "return", { slot: p.slot, team: teamOf(c, p.slot), to, why });
  [p.x, p.y, p.z] = to;
  p.grace = RETURN_GRACE_TICKS;
  p.outsideTicks = 0;
  p.keepOutTicks = 0;
  if (!penalty) return;
  p.returns++;
  p.roundReturns = (p.roundReturns ?? 0) + 1;
  if (c.game.template === "survive" && !p.out && p.roundReturns > c.game.settings.scoreToWin - 1) {
    p.out = true;
    emit(c, "out", { slot: p.slot, team: teamOf(c, p.slot) });
  }
}

/** Change a team's round score; the event carries what really changed. */
function addScore(c: Ctx, team: number, amount: number, slot: number | undefined, depth: number): void {
  const i = team - 1;
  if (i < 0 || i >= c.s.scores.length) return;
  const next = clamp(c.s.scores[i] + Math.round(amount), 0, SCORE_LIMIT);
  const change = next - c.s.scores[i];
  if (change === 0) return;
  c.s.scores[i] = next;
  emit(c, "score", { slot, team, value: change });
  c.triggers.push({ event: "score", slot, team, depth });
}

/** A player did something worth a point for their team. */
function playerScores(c: Ctx, p: PlayerState): void {
  p.score++;
  addScore(c, teamOf(c, p.slot), 1, p.slot, 0);
}

// ── One tick ───────────────────────────────────────────────────────────

function applyControls(c: Ctx, controls: readonly ControlInput[]): boolean {
  let hostEnd = false;
  for (const ctl of controls) {
    if (ctl.type === "host-end") { hostEnd = true; continue; }
    const p = c.s.players.find((x) => x.slot === ctl.slot);
    if (!p) continue;
    if (ctl.type === "leave") {
      if (p.left) continue;
      dropCarried(c, p);
      p.left = true;
      emit(c, "leave", { slot: p.slot, team: teamOf(c, p.slot) });
    } else if (ctl.type === "swap") {
      emit(c, "swap", { slot: p.slot, value: ctl.to === "npc" ? 1 : 0 });
    }
  }
  return hostEnd;
}

function applySamples(c: Ctx, samples: readonly Sample[]): void {
  const bySlot = new Map<number, Sample>();
  for (const sm of samples) {
    if (Number.isFinite(sm.x) && Number.isFinite(sm.y) && Number.isFinite(sm.z)) bySlot.set(sm.slot, sm);
  }
  for (const p of c.s.players) {
    if ((p.grace ?? 0) > 0) p.grace = (p.grace ?? 0) - 1;
    const sm = p.left ? undefined : bySlot.get(p.slot);
    p.fresh = sm !== undefined;
    if (!sm) continue;
    const x = q(sm.x), y = q(sm.y), z = q(sm.z);
    if ((p.grace ?? 0) > 0) {
      // Just sent to spawn: believe the sample only once it shows them there
      if (Math.hypot(x - p.x, y - p.y, z - p.z) > RETURN_NEAR_M) continue;
      p.grace = 0;
    }
    p.x = x; p.y = y; p.z = z;
  }
  for (const it of c.s.items) {
    if (it.heldBy === null) continue;
    const holder = c.s.players.find((p) => p.slot === it.heldBy);
    if (holder) { it.x = holder.x; it.y = holder.y; it.z = holder.z; }
  }
}

/** Which zones each player stands in; with `loud`, the enter and leave events too. */
function trackZones(c: Ctx, loud: boolean): { p: PlayerState; zone: GameZone }[] {
  const entered: { p: PlayerState; zone: GameZone }[] = [];
  for (const p of c.s.players) {
    if (p.left) continue;
    const now = c.game.zones.filter((z) => inBox(z, p.x, p.y, p.z));
    if (loud && !p.out) {
      const team = teamOf(c, p.slot);
      for (const id of p.zones) {
        if (now.some((z) => z.id === id)) continue;
        emit(c, "leave-zone", { slot: p.slot, team, zone: id });
        c.triggers.push({ event: "leave-zone", slot: p.slot, team, zone: id, depth: 0 });
      }
      for (const z of now) {
        if (p.zones.includes(z.id)) continue;
        emit(c, "enter-zone", { slot: p.slot, team, zone: z.id });
        c.triggers.push({ event: "enter-zone", slot: p.slot, team, zone: z.id, depth: 0 });
        entered.push({ p, zone: z });
      }
    }
    p.zones = now.map((z) => z.id);
  }
  return entered;
}

/** The arena's edge and the keep-out zones. */
function checkEdges(c: Ctx): void {
  const { edge, edgeSeconds } = c.game.settings;
  const limit = edgeSeconds * TICKS_PER_SECOND;
  for (const p of c.s.players) {
    if (!isIn(p) || (p.grace ?? 0) > 0) continue;
    const team = teamOf(c, p.slot);
    const by = c.arena ? outsideBy(c.arena, p.x, p.y, p.z) : 0;
    const outside = edge === "wall" ? by > WALL_SLACK_M : by > 0;
    if (outside) {
      p.outsideTicks++;
      if (p.outsideTicks === 1) {
        emit(c, "out-of-bounds", { slot: p.slot, team, value: edge === "soft" ? edgeSeconds : 0 });
        c.triggers.push({ event: "out-of-bounds", slot: p.slot, team, depth: 0 });
      }
      if (edge !== "soft" || p.outsideTicks >= limit) { sendBack(c, p, "edge", true); continue; }
    } else {
      p.outsideTicks = 0;
    }
    const inside = keepOuts(c.game).filter((z) => inBox(z, p.x, p.y, p.z));
    if (inside.length) {
      p.keepOutTicks++;
      const instant = inside.some((z) => z.ret === "instant");
      if (p.keepOutTicks === 1) emit(c, "keep-out", { slot: p.slot, team, zone: inside[0].id, value: instant ? 0 : edgeSeconds });
      if (instant || p.keepOutTicks >= limit) sendBack(c, p, "keep-out", true);
    } else {
      p.keepOutTicks = 0;
    }
  }
}

function takeItem(c: Ctx, p: PlayerState, it: MatchItem): void {
  it.heldBy = p.slot;
  p.carrying = it.id;
  emit(c, "pickup", { slot: p.slot, team: teamOf(c, p.slot), item: it.id });
  c.triggers.push({ event: "pickup", slot: p.slot, team: teamOf(c, p.slot), depth: 0 });
}

/** Items that were taken come back somewhere else when their wait is over. */
function respawnItems(c: Ctx, avoid?: (x: number, z: number) => boolean): void {
  for (const it of c.s.items) {
    if (it.active || !it.respawn) continue;
    it.respawn--;
    if (it.respawn > 0) continue;
    const at = randomSpot(c.game, c.s, avoid);
    [it.x, it.y, it.z] = at;
    it.home = [at[0], at[1], at[2]];
    it.active = true;
  }
}

function stepTemplate(c: Ctx, entered: { p: PlayerState; zone: GameZone }[]): void {
  const { game, s } = c;
  const target = game.settings.scoreToWin;
  switch (game.template) {
    case "race": {
      for (const { p, zone } of entered) {
        const team = teamOf(c, p.slot);
        if (zone.kind !== "goal" || (zone.team !== undefined && zone.team !== team)) continue;
        // Sent back this very tick (a keep-out over the goal): they are not there any more
        if (!isIn(p) || !inBox(zone, p.x, p.y, p.z)) continue;
        emit(c, "goal", { slot: p.slot, team, zone: zone.id });
        playerScores(c, p);
        if (target > 1) sendBack(c, p, "goal", false);
      }
      break;
    }
    case "collect": {
      respawnItems(c);
      for (const p of s.players) {
        if (!isIn(p)) continue;
        for (const it of s.items) {
          if (!it.active || !touches(p, it)) continue;
          it.active = false;
          it.respawn = RESPAWN_TICKS;
          emit(c, "pickup", { slot: p.slot, team: teamOf(c, p.slot), item: it.id });
          c.triggers.push({ event: "pickup", slot: p.slot, team: teamOf(c, p.slot), depth: 0 });
          playerScores(c, p);
        }
      }
      break;
    }
    case "capture-the-flag": {
      for (const p of s.players) {
        if (!isIn(p)) continue;
        const team = teamOf(c, p.slot);
        if (p.carrying) {
          const flag = s.items.find((i) => i.id === p.carrying);
          if (!flag || !inBase(game, team, p)) continue;
          flag.heldBy = null;
          p.carrying = null;
          [flag.x, flag.y, flag.z] = flag.home;
          emit(c, "capture", { slot: p.slot, team, item: flag.id });
          c.triggers.push({ event: "capture", slot: p.slot, team, depth: 0 });
          playerScores(c, p);
          continue;
        }
        for (const flag of s.items) {
          if (flag.kind !== "flag" || flag.heldBy !== null || !touches(p, flag)) continue;
          if (flag.team !== team) { takeItem(c, p, flag); break; }
          if (flag.x !== flag.home[0] || flag.y !== flag.home[1] || flag.z !== flag.home[2]) {
            [flag.x, flag.y, flag.z] = flag.home;
            emit(c, "drop", { team: flag.team, item: flag.id, to: flag.home, why: "home" });
          }
        }
      }
      break;
    }
    case "king-of-the-hill": {
      const hill = goals(game);
      const on = s.players.filter((p) => isIn(p) && hill.some((z) => inBox(z, p.x, p.y, p.z)));
      // The team with the most players on the hill holds it; equal numbers contest it (nobody scores)
      const heads = new Map<number, number>();
      for (const p of on) heads.set(teamOf(c, p.slot), (heads.get(teamOf(c, p.slot)) ?? 0) + 1);
      let holder = 0, best = 0;
      for (const [team, n] of [...heads].sort((a, b) => a[0] - b[0])) {
        if (n > best) { best = n; holder = team; }
        else if (n === best) holder = 0;
      }
      if (holder !== s.hill) {
        s.hill = holder;
        s.hillTicks = 0;
        emit(c, "hill", { team: holder });
      }
      if (holder > 0) {
        s.hillTicks = (s.hillTicks ?? 0) + 1;
        if (s.hillTicks % TICKS_PER_SECOND === 0) {
          for (const p of on) if (teamOf(c, p.slot) === holder) p.score++;
          addScore(c, holder, 1, undefined, 0);
        }
      }
      break;
    }
    case "survive":
      break;
    case "build-together": {
      const mid = (game.arena ?? FALLBACK_ARENA).at;
      const site = goals(game).map(boundsOf);
      respawnItems(c, (x, z) => (site.length ? site.some((b) => overXZ(b, x, z)) : Math.hypot(x - mid[0], z - mid[2]) <= SITE_RADIUS_M + TOUCH_M));
      // Enough pieces for everyone's count only if delivered ones come back
      const comesBack = c.teams > 1 || target > s.items.length;
      for (const p of s.players) {
        if (!isIn(p)) continue;
        const team = teamOf(c, p.slot);
        if (p.carrying) {
          const piece = s.items.find((i) => i.id === p.carrying);
          if (!piece || !inSite(game, p.x, p.y, p.z)) continue;
          piece.heldBy = null;
          piece.active = false;
          piece.respawn = comesBack ? RESPAWN_TICKS : 0;
          p.carrying = null;
          emit(c, "piece", { slot: p.slot, team, item: piece.id });
          playerScores(c, p);
          continue;
        }
        const piece = s.items.find((i) => i.active && i.heldBy === null && touches(p, i));
        if (piece) takeItem(c, p, piece);
      }
      break;
    }
  }
}

// ── When ▸ If ▸ Do ─────────────────────────────────────────────────────

function ruleValue(c: Ctx, name: RuleCondition["left"], t: Trigger): number {
  const s = c.s;
  switch (name) {
    case "score":
      return t.team !== undefined ? s.scores[t.team - 1] ?? 0 : Math.max(0, ...s.scores);
    case "other-score": {
      if (t.team !== undefined) return Math.max(0, ...s.scores.filter((_, i) => i !== (t.team as number) - 1));
      return [...s.scores].sort((a, b) => b - a)[1] ?? 0;
    }
    case "seconds-left": return Math.ceil(s.left / TICKS_PER_SECOND);
    case "round": return s.round;
    case "players": return s.players.filter(isIn).length;
    case "var-a": return s.vars[0];
    case "var-b": return s.vars[1];
    case "var-c": return s.vars[2];
  }
}

function holds(c: Ctx, cond: RuleCondition, t: Trigger): boolean {
  const v = ruleValue(c, cond.left, t);
  switch (cond.op) {
    case "<": return v < cond.right;
    case "<=": return v <= cond.right;
    case "=": return v === cond.right;
    case ">=": return v >= cond.right;
    case ">": return v > cond.right;
  }
}

/** Does this rule answer this trigger? (Marks a seconds-left rule as spent when its moment comes.) */
function answers(c: Ctx, rule: GameRule, t: Trigger): boolean {
  if (rule.when.event !== t.event) return false;
  const s = c.s;
  if (t.event === "enter-zone" || t.event === "leave-zone") return rule.when.zone === undefined || rule.when.zone === t.zone;
  if (t.event === "every-seconds") {
    const every = Math.max(1, rule.when.seconds ?? 30) * TICKS_PER_SECOND;
    return (s.played ?? 0) % every === 0;
  }
  if (t.event === "seconds-left") {
    const fired = s.fired ?? (s.fired = []);
    if (s.left > (rule.when.seconds ?? 30) * TICKS_PER_SECOND || fired.includes(rule.id)) return false;
    fired.push(rule.id);
  }
  return true;
}

function runAction(c: Ctx, a: RuleAction, t: Trigger, depth: number): void {
  const s = c.s;
  const target = a.target ?? "actor";
  const value = Math.round(a.value ?? 0);
  switch (a.type) {
    case "add-score": {
      for (let team = 1; team <= c.teams; team++) {
        const mine = team === t.team;
        if (target === "actor" ? mine : target === "others" ? !mine : true) addScore(c, team, value, mine ? t.slot : undefined, depth);
      }
      break;
    }
    case "add-seconds":
      s.left = clamp(s.left + value * TICKS_PER_SECOND, TICKS_PER_SECOND, GAME_LIMITS.roundSeconds[1] * TICKS_PER_SECOND);
      break;
    case "return-to-spawn": {
      for (const p of s.players) {
        if (!isIn(p)) continue;
        const who = target === "actor" ? p.slot === t.slot : target === "others" ? teamOf(c, p.slot) !== t.team : true;
        if (who) sendBack(c, p, "rule", true);
      }
      break;
    }
    case "end-round":
      c.end = { winner: target === "actor" && t.team !== undefined ? t.team : 0, why: "rule" };
      break;
    case "set-var":
    case "add-var": {
      const i = a.name === "var-c" ? 2 : a.name === "var-b" ? 1 : 0;
      s.vars[i] = clamp((a.type === "add-var" ? s.vars[i] : 0) + value, -VAR_LIMIT, VAR_LIMIT);
      break;
    }
    case "announce":
      emit(c, "announce", { value });
      break;
  }
}

/** Run the game's rules over what happened this tick, within the Phase 07 budgets. */
function runRules(c: Ctx): void {
  const rules = c.game.rules;
  if (!rules.length) return;
  const queue: Trigger[] = [];
  if (c.s.played === 1) {
    if (c.s.round === 1) queue.push({ event: "match-start", depth: 0 });
    queue.push({ event: "round-start", depth: 0 });
  }
  queue.push(...c.triggers, { event: "every-seconds", depth: 0 }, { event: "seconds-left", depth: 0 });
  // Triggers made by actions from here on join the same queue
  c.triggers = queue;
  let budget: number = GAME_LIMITS.ruleActionsPerTick;
  for (let i = 0; i < queue.length && budget > 0 && !c.end; i++) {
    const t = queue[i];
    if (t.depth >= GAME_LIMITS.ruleDepth) continue;
    for (const rule of rules) {
      if (budget <= 0 || c.end) break;
      if (!answers(c, rule, t) || !rule.if.every((cond) => holds(c, cond, t))) continue;
      emit(c, "rule", { slot: t.slot, team: t.team, why: rule.id });
      for (const a of rule.do) {
        if (budget <= 0 || c.end) break;
        budget--;
        runAction(c, a, t, t.depth + 1);
      }
    }
  }
}

// ── Ends ───────────────────────────────────────────────────────────────

/** The team with the most; 0 when the most is shared. */
function soleBest(values: readonly number[]): number {
  const best = Math.max(...values);
  return values.filter((v) => v === best).length === 1 ? values.indexOf(best) + 1 : 0;
}

/** Has the round ended this tick, and whose is it? */
function roundOutcome(c: Ctx): { winner: number; why: string } | null {
  if (c.end) return c.end;
  const { game, s, teams } = c;
  const target = game.settings.scoreToWin;
  if (game.template === "survive") {
    const alive = new Array<number>(teams).fill(0);
    for (const p of s.players) if (isIn(p)) alive[teamOf(c, p.slot) - 1]++;
    const teamsIn = alive.filter((n) => n > 0).length;
    if (teamsIn === 0) return { winner: 0, why: "all-out" };
    if (teams > 1 && teamsIn === 1) return { winner: alive.findIndex((n) => n > 0) + 1, why: "all-out" };
    if (s.left <= 0) return { winner: teams > 1 ? soleBest(alive) : 1, why: "time" };
    return null;
  }
  if (s.scores.some((v) => v >= target)) return { winner: soleBest(s.scores), why: "score" };
  if (s.left > 0) return null;
  if (game.template === "build-together" || teams === 1) return { winner: 0, why: "time" };
  return { winner: Math.max(...s.scores) > 0 ? soleBest(s.scores) : 0, why: "time" };
}

function finish(c: Ctx, why: string): void {
  const s = c.s;
  s.phase = "finished";
  s.left = 0;
  s.winner = s.rounds.some((n) => n > 0) ? soleBest(s.rounds) : 0;
  s.why = why;
  emit(c, "match-end", { team: s.winner, why });
}

function endRound(c: Ctx, outcome: { winner: number; why: string }): void {
  const { s, game } = c;
  if (game.template === "survive") {
    // The scoreboard of a survive round: one point per player still in
    for (const p of s.players) {
      if (!isIn(p)) continue;
      p.score++;
      const team = teamOf(c, p.slot);
      s.scores[team - 1]++;
      emit(c, "score", { slot: p.slot, team, value: 1 });
    }
  }
  if (outcome.winner > 0) s.rounds[outcome.winner - 1]++;
  emit(c, "round-end", { team: outcome.winner, value: s.round, why: outcome.why });
  const remaining = game.settings.rounds - s.round;
  const sorted = [...s.rounds].sort((a, b) => b - a);
  const decided = c.teams > 1 && sorted[0] - (sorted[1] ?? 0) > remaining;
  if (remaining <= 0 || decided) { finish(c, outcome.why); return; }
  s.phase = "break";
  s.left = breakTicks();
}

/**
 * One tick. Pure: the same setup, state, samples and controls always give the same
 * state and events. Never mutates its arguments.
 *
 * Order within a tick: controls, samples, then by phase. While playing: zones (enter /
 * leave), the edge and keep-outs, the template, the clock, the rules, the round's end.
 */
export function stepMatch(setup: MatchSetup, state: MatchState, samples: readonly Sample[], controls: readonly ControlInput[] = []): { state: MatchState; events: MatchEvent[] } {
  const s = cloneState(state);
  if (s.phase === "finished") return { state: s, events: [] };
  s.tick++;
  const c = makeCtx(setup, s);

  const hostEnd = applyControls(c, controls);
  if (hostEnd) { finish(c, "host"); return { state: s, events: c.events }; }
  if (s.players.every((p) => p.left)) { finish(c, "empty"); return { state: s, events: c.events }; }

  if (s.tick === 1) startRound(c, 1, true);
  applySamples(c, samples);

  if (s.phase === "playing") {
    const entered = trackZones(c, true);
    checkEdges(c);
    stepTemplate(c, entered);
    s.played = (s.played ?? 0) + 1;
    s.left--;
    runRules(c);
    const outcome = roundOutcome(c);
    if (outcome) endRound(c, outcome);
  } else {
    trackZones(c, false);
    s.left--;
    if (s.left <= 0) {
      if (s.phase === "countdown") {
        s.phase = "playing";
        s.left = setup.game.settings.roundSeconds * TICKS_PER_SECOND;
      } else {
        startRound(c, s.round + 1, false);
      }
    }
  }
  return { state: s, events: c.events };
}

/** The result of a finished match (null while it runs). `why` defaults to what the referee recorded. */
export function resultOf(_setup: MatchSetup, state: MatchState, why?: string): MatchResult | null {
  if (state.phase !== "finished") return null;
  return {
    winner: state.winner ?? 0,
    rounds: [...state.rounds],
    scores: [...state.scores],
    players: state.players.map((p) => ({ slot: p.slot, score: p.score, returns: p.returns, left: p.left })),
    ticks: state.tick,
    why: why ?? state.why ?? "time",
  };
}

/**
 * Run a record's frames through the referee from the start: every state is not kept, only the last, plus all events.
 * Steps every tick from 1 (ticks without a frame get no samples and no controls) up to
 * the last tick the record speaks of (its result's, its last frame's or its last
 * event's), stopping as soon as the match is finished.
 */
export function replayRecord(record: MatchRecord): { state: MatchState; events: MatchEvent[]; result: MatchResult | null } {
  const { setup } = record;
  const frames = new Map(record.frames.map((f) => [f.t, f]));
  let last = record.result?.ticks ?? 0;
  for (const f of record.frames) last = Math.max(last, f.t);
  for (const e of record.events) last = Math.max(last, e.tick);
  let state = initMatch(setup);
  const events: MatchEvent[] = [];
  for (let t = 1; t <= last && state.phase !== "finished"; t++) {
    const f = frames.get(t);
    const step = stepMatch(setup, state, f ? unpackSamples(f.s) : [], f?.c ?? []);
    state = step.state;
    events.push(...step.events);
  }
  return { state, events, result: resultOf(setup, state) };
}

/** Deep equality of JSON data (key order does not matter; a key set to undefined counts as absent). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)].filter((k) => x[k] !== undefined || y[k] !== undefined));
  for (const k of keys) if (!same(x[k], y[k])) return false;
  return true;
}

/** Does replaying the record reproduce its stored events and result exactly? */
export function verifyRecord(record: MatchRecord): boolean {
  try {
    const replay = replayRecord(record);
    return same(replay.events, record.events) && same(replay.result, record.result ?? null);
  } catch {
    return false;
  }
}

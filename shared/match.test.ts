/** Phase 10, slices 2 and 5: the referee (flow, edge, the six templates, rules, records). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_SIM_VERSION, MATCH_TICK_MS, ROUND_BREAK_MS, ROUND_COUNTDOWN_MS,
  initMatch, packSamples, q, replayRecord, resultOf, spawnPoint, stepMatch, verifyRecord,
  type ControlInput, type MatchEvent, type MatchEventType, type MatchFrame, type MatchRecord, type MatchSetup, type MatchSlot, type MatchState, type Sample,
} from "./match.ts";
import { GAME_LIMITS, boundsOf, inBox, parseGame, type Game, type GameTemplate, type Vec3 } from "./game.ts";
import { RESPAWN_TICKS, RETURN_GRACE_TICKS, TICKS_PER_SECOND } from "./match-referee.ts";

// ── Helpers ────────────────────────────────────────────────────────────

const ARENA = { at: [0, 0, 0], size: [40, 20, 40] };
const LOBBY = { at: [0, 0, 60], size: [12, 6, 12], ring: { at: [0, 0, 62], radius: 2 }, arrival: [0, 0, 58] };
const RED = { id: "red", kind: "spawn", team: 1, at: [-15, 0, 0], size: [4, 3, 4] };
const BLUE = { id: "blue", kind: "spawn", team: 2, at: [15, 0, 0], size: [4, 3, 4] };
const GOAL = { id: "goal", kind: "goal", at: [0, 0, -15], size: [6, 3, 6] };
const PIT = { id: "pit", kind: "keep-out", at: [0, 0, 5], size: [3, 3, 3] };
const IN_GOAL: Vec3 = [0, 0, -15];
const COUNTDOWN = ROUND_COUNTDOWN_MS / MATCH_TICK_MS;
const BREAK = ROUND_BREAK_MS / MATCH_TICK_MS;

/** A parsed game: two teams, 60 s rounds, a 3 s soft edge, the four standard zones unless told otherwise. */
function game(template: GameTemplate, settings: Record<string, unknown> = {}, extra: { zones?: unknown[]; rules?: unknown[] } = {}): Game {
  const p = parseGame({
    version: 3,
    template,
    settings: { teams: 2, roundSeconds: 60, edgeSeconds: 3, ...settings },
    arena: ARENA,
    zones: extra.zones ?? [RED, BLUE, GOAL, PIT],
    lobby: LOBBY,
    rules: extra.rules ?? [],
  });
  assert.ok(p.ok, p.ok ? "" : p.errors.join("; "));
  return p.value;
}

/** A setup with `players` slots dealt round the teams (slot 0 → team 1, slot 1 → team 2, …). */
function setupOf(g: Game, players = 2, seed = 7): MatchSetup {
  return {
    matchId: "m1",
    worldId: "w1",
    game: g,
    seed,
    simVersion: MATCH_SIM_VERSION,
    slots: Array.from({ length: players }, (_, i) => ({ slot: i, team: (i % g.settings.teams) + 1, kind: "human" as const, id: `p${i}`, name: `P${i}` })),
    formed: { policy: "random-balanced", seed: 1, links: [], together: [] },
  };
}

/**
 * Drives a match by hand: put players somewhere (they keep sending that position), tick,
 * and look at what came out. Like a real client it obeys `return` events (moves to
 * `to`) unless `obey` is false. Keeps the frames, so a record can be made of the run.
 */
function drive(setup: MatchSetup, opts: { obey?: boolean } = {}) {
  let state = initMatch(setup);
  const events: MatchEvent[] = [];
  const frames: MatchFrame[] = [];
  const at = new Map<number, Vec3>();
  const obey = opts.obey ?? true;
  const m = {
    get state(): MatchState { return state; },
    events,
    frames,
    put(slot: number, p: readonly number[]) { at.set(slot, [q(p[0]), q(p[1]), q(p[2])]); return m; },
    silent(slot: number) { at.delete(slot); return m; },
    tick(n = 1, controls: ControlInput[] = []): MatchEvent[] {
      const got: MatchEvent[] = [];
      for (let i = 0; i < n && state.phase !== "finished"; i++) {
        const samples: Sample[] = [...at].map(([slot, [x, y, z]]) => ({ slot, x, y, z }));
        const c = i === 0 ? controls : [];
        const step = stepMatch(setup, state, samples, c);
        state = step.state;
        if (samples.length || c.length) frames.push({ t: state.tick, s: packSamples(samples), ...(c.length ? { c } : {}) });
        for (const e of step.events) {
          if (obey && e.type === "return" && e.to && e.slot !== undefined && at.has(e.slot)) at.set(e.slot, e.to);
        }
        events.push(...step.events);
        got.push(...step.events);
      }
      return got;
    },
    /** Walk in a straight line from where the player is to `to`, one step per tick. */
    walk(slot: number, to: readonly number[], ticks: number): MatchEvent[] {
      const p = m.player(slot);
      const from = at.get(slot) ?? [p.x, p.y, p.z];
      const got: MatchEvent[] = [];
      for (let k = 1; k <= ticks; k++) {
        m.put(slot, from.map((v, i) => v + ((to[i] - v) * k) / ticks));
        got.push(...m.tick());
      }
      return got;
    },
    /** Tick through the countdown: the next tick is the first one of play. */
    toPlay() { for (let i = 0; i < 1000 && state.phase !== "playing"; i++) m.tick(); assert.equal(state.phase, "playing"); return m; },
    until(done: (s: MatchState) => boolean, max = 20_000) { for (let i = 0; i < max && !done(state); i++) m.tick(); assert.ok(done(state), "never got there"); return m; },
    of(type: MatchEventType): MatchEvent[] { return events.filter((e) => e.type === type); },
    player(slot: number) { return state.players.find((p) => p.slot === slot)!; },
    item(id: string) { return state.items.find((i) => i.id === id)!; },
    record(): MatchRecord {
      return { v: 1, setup, frames, events, result: resultOf(setup, state), startedAt: 1000, endedAt: state.phase === "finished" ? 2000 : null };
    },
  };
  return m;
}

const types = (events: MatchEvent[]): string[] => events.map((e) => e.type);
const only = (events: MatchEvent[], type: MatchEventType): MatchEvent[] => events.filter((e) => e.type === type);
const under = (it: { x: number; z: number }): Vec3 => [it.x, 0, it.z];

/** The scoreboard a viewer would rebuild from events alone: `score` values per team since the last round-start. */
function scoreboard(events: MatchEvent[], teams: number): number[] {
  let board = new Array<number>(teams).fill(0);
  for (const e of events) {
    if (e.type === "round-start") board = new Array<number>(teams).fill(0);
    if (e.type === "score") board[e.team! - 1] += e.value!;
  }
  return board;
}

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.values(v)) deepFreeze(k);
  }
  return v;
}

/** Runs a script (a pure function of the tick) from a state, for replay and determinism checks. */
type Script = (tick: number) => { samples: Sample[]; controls?: ControlInput[] };
function runScript(setup: MatchSetup, script: Script, from: MatchState, ticks: number): { state: MatchState; events: MatchEvent[]; frames: MatchFrame[] } {
  let state = from;
  const events: MatchEvent[] = [];
  const frames: MatchFrame[] = [];
  for (let i = 0; i < ticks && state.phase !== "finished"; i++) {
    const { samples, controls = [] } = script(state.tick + 1);
    const step = stepMatch(setup, state, samples, controls);
    state = step.state;
    events.push(...step.events);
    if (samples.length || controls.length) frames.push({ t: state.tick, s: packSamples(samples), ...(controls.length ? { c: controls } : {}) });
  }
  return { state, events, frames };
}

/** Four players wandering a collect arena (and out of it), with a swap, a leave and a few rules. */
function busyMatch(): { setup: MatchSetup; script: Script } {
  const g = game("collect", { rounds: 2, scoreToWin: 40 }, {
    rules: [
      { id: "tick", when: { event: "every-seconds", seconds: 7 }, if: [], do: [{ type: "add-var", name: "var-a", value: 1 }] },
      { id: "oops", when: { event: "out-of-bounds" }, if: [{ left: "score", op: ">", right: 0 }], do: [{ type: "add-score", target: "actor", value: -1 }, { type: "announce", value: 5 }] },
      { id: "late", when: { event: "seconds-left", seconds: 10 }, if: [], do: [{ type: "add-seconds", value: 5 }] },
    ],
  });
  const setup = setupOf(g, 4, 12345);
  const script: Script = (t) => ({
    samples: [0, 1, 2, 3].filter((k) => !(k === 3 && t > 400)).map((k) => ({
      slot: k,
      x: q(24 * Math.sin(t * 0.05 + k)),
      y: 0,
      z: q(24 * Math.cos(t * 0.031 + 2 * k)),
    })),
    controls: t === 100 ? [{ type: "swap", slot: 1, to: "npc" }] : t === 400 ? [{ type: "leave", slot: 3 }] : [],
  });
  return { setup, script };
}

// ── Flow ───────────────────────────────────────────────────────────────

test("the referee's tick constants agree with the contract", () => {
  assert.equal(TICKS_PER_SECOND, 1000 / MATCH_TICK_MS);
  assert.equal(RESPAWN_TICKS, 50);
});

test("initMatch: round 1's countdown, everyone at their spawn, nothing scored, plain JSON", () => {
  const setup = setupOf(game("race"), 4);
  const s = initMatch(setup);
  assert.equal(s.tick, 0);
  assert.equal(s.phase, "countdown");
  assert.equal(s.round, 1);
  assert.equal(s.left, COUNTDOWN);
  assert.deepEqual(s.scores, [0, 0]);
  assert.deepEqual(s.rounds, [0, 0]);
  assert.equal(s.rng, 7);
  assert.equal(s.winner, null);
  for (const p of s.players) {
    assert.deepEqual([p.x, p.y, p.z], spawnPoint(setup, p.slot));
    assert.equal(p.out || p.left, false);
    assert.equal(p.carrying, null);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(resultOf(setup, s), null);
});

test("the first tick starts round 1 and sends everyone to their spawn; play begins after the countdown", () => {
  const setup = setupOf(game("race"));
  const m = drive(setup);
  const first = m.tick();
  assert.deepEqual(types(first), ["round-start", "return", "return"]);
  assert.equal(first[0].value, 1);
  assert.deepEqual(first[1], { tick: 1, type: "return", slot: 0, team: 1, to: [-15, 0, 0], why: "round" });
  assert.deepEqual(first[2].to, [15, 0, 0]);
  m.tick(COUNTDOWN - 2);
  assert.equal(m.state.phase, "countdown");
  m.tick();
  assert.equal(m.state.tick, COUNTDOWN);
  assert.equal(m.state.phase, "playing");
  assert.equal(m.state.left, 600);
  assert.equal(m.events.length, 3);
});

test("nothing scores during the countdown, and standing in the goal when play begins is not entering it", () => {
  const m = drive(setupOf(game("race")));
  m.tick();
  m.put(0, IN_GOAL).toPlay();
  assert.deepEqual([m.player(0).x, m.player(0).z], [0, -15]);
  m.tick(5);
  assert.deepEqual(m.of("goal"), []);
  assert.deepEqual(m.state.scores, [0, 0]);
  // Stepping out and back in does count
  m.put(0, [0, 0, -5]).tick();
  m.put(0, IN_GOAL).tick();
  assert.equal(m.of("goal").length, 1);
});

test("a player without a fresh sample stands still", () => {
  const m = drive(setupOf(game("race")));
  m.toPlay();
  m.put(0, [-10, 0, 3]).tick();
  assert.equal(m.player(0).fresh, true);
  assert.equal(m.player(1).fresh, false);
  m.silent(0).tick(3);
  assert.equal(m.player(0).fresh, false);
  assert.deepEqual([m.player(0).x, m.player(0).y, m.player(0).z], [-10, 0, 3]);
});

// ── Race ───────────────────────────────────────────────────────────────

test("race: the first player into the goal wins the round and the match", () => {
  const setup = setupOf(game("race"));
  const m = drive(setup).toPlay();
  const ev = m.walk(0, IN_GOAL, 20);
  assert.deepEqual(types(ev), ["leave-zone", "enter-zone", "goal", "score", "round-end", "match-end"]);
  const score = only(ev, "score")[0];
  assert.deepEqual([score.slot, score.team, score.value], [0, 1, 1]);
  assert.deepEqual([only(ev, "round-end")[0].team, only(ev, "round-end")[0].why], [1, "score"]);
  assert.equal(m.state.phase, "finished");
  assert.equal(m.state.winner, 1);
  assert.deepEqual(resultOf(setup, m.state), {
    winner: 1, rounds: [1, 0], scores: [1, 0], ticks: m.state.tick, why: "score",
    players: [{ slot: 0, score: 1, returns: 0, left: false }, { slot: 1, score: 0, returns: 0, left: false }],
  });
});

test("race to 2: a goal sends the scorer back to spawn (not a penalty) and the second goal wins", () => {
  const m = drive(setupOf(game("race", { scoreToWin: 2 }))).toPlay();
  const ev = m.put(0, IN_GOAL).tick();
  assert.deepEqual(types(ev), ["leave-zone", "enter-zone", "goal", "score", "return"]);
  assert.deepEqual([only(ev, "return")[0].why, only(ev, "return")[0].to], ["goal", [-15, 0, 0]]);
  assert.equal(m.player(0).returns, 0);
  assert.equal(m.state.phase, "playing");
  m.tick(3);
  assert.equal(m.of("goal").length, 1);
  m.put(0, IN_GOAL).tick();
  assert.equal(m.state.phase, "finished");
  assert.deepEqual(m.state.scores, [2, 0]);
  assert.equal(m.player(0).score, 2);
});

test("race: another team's goal does not count, your own does", () => {
  const zones = [RED, BLUE, { ...GOAL, id: "red-goal", team: 1 }, { id: "blue-goal", kind: "goal", team: 2, at: [0, 0, 15], size: [6, 3, 6] }];
  const m = drive(setupOf(game("race", {}, { zones }))).toPlay();
  m.put(1, IN_GOAL).tick(2);
  assert.deepEqual(m.of("goal"), []);
  assert.equal(m.of("enter-zone").filter((e) => e.zone === "red-goal").length, 1);
  m.put(1, [0, 0, 15]).tick();
  assert.equal(m.state.winner, 2);
});

test("race: nobody finishes, the round runs out as a draw", () => {
  const setup = setupOf(game("race"));
  const m = drive(setup).until((s) => s.phase === "finished");
  assert.equal(m.state.tick, COUNTDOWN + 600);
  assert.equal(m.state.winner, 0);
  assert.deepEqual([m.of("round-end")[0].team, m.of("round-end")[0].why], [0, "time"]);
  assert.equal(resultOf(setup, m.state)?.why, "time");
});

test("race: two teams in the goal on the same tick is a draw", () => {
  const m = drive(setupOf(game("race"))).toPlay();
  m.put(0, IN_GOAL).put(1, [1, 0, -15]).tick();
  assert.deepEqual(m.state.scores, [1, 1]);
  assert.equal(m.state.winner, 0);
});

// ── Collect ────────────────────────────────────────────────────────────

test("collect: 3 pickups per player (6 to 24), on the floor, inside the arena, out of keep-out zones", () => {
  const g = game("collect");
  for (const [players, n] of [[1, 6], [2, 6], [5, 15], [10, 24]]) {
    const s = initMatch(setupOf(g, players, 99 + players));
    assert.equal(s.items.length, n);
    const pit = boundsOf(g.zones.find((z) => z.id === "pit")!);
    for (const it of s.items) {
      assert.equal(it.kind, "pickup");
      assert.equal(it.y, 1.5);
      assert.ok(inBox(g.arena!, it.x, it.y, it.z));
      assert.ok(!(it.x >= pit.minX && it.x <= pit.maxX && it.z >= pit.minZ && it.z <= pit.maxZ));
      assert.deepEqual(it.home, [it.x, it.y, it.z]);
    }
  }
  assert.deepEqual(initMatch(setupOf(g, 4, 5)).items, initMatch(setupOf(g, 4, 5)).items);
  assert.notDeepEqual(initMatch(setupOf(g, 4, 5)).items, initMatch(setupOf(g, 4, 6)).items);
});

test("collect: taking a pickup scores, and it comes back somewhere else after 5 s", () => {
  const m = drive(setupOf(game("collect"))).toPlay();
  const before = { ...m.item("pickup-1") };
  const ev = m.put(0, under(before)).tick();
  const taken = only(ev, "pickup").map((e) => e.item);
  assert.ok(taken.includes("pickup-1"));
  assert.equal(only(ev, "score").length, taken.length);
  assert.equal(m.state.scores[0], taken.length);
  assert.equal(m.item("pickup-1").active, false);
  m.put(0, [-15, 0, 0]).tick(RESPAWN_TICKS - 1);
  assert.equal(m.item("pickup-1").active, false);
  m.tick();
  const after = m.item("pickup-1");
  assert.equal(after.active, true);
  assert.notDeepEqual([after.x, after.z], [before.x, before.z]);
  assert.ok(inBox(game("collect").arena!, after.x, after.y, after.z));
});

test("collect: out of reach is out of reach (1.5 m across, 3 m up)", () => {
  const m = drive(setupOf(game("collect"))).toPlay();
  const it = m.item("pickup-1");
  m.put(0, [it.x, it.y + 3.5, it.z]).tick();
  assert.equal(m.item("pickup-1").active, true);
  m.put(0, [it.x, it.y + 2.9, it.z]).tick();
  assert.equal(m.item("pickup-1").active, false);
});

test("collect: the round ends when a team reaches the score", () => {
  const m = drive(setupOf(game("collect", { scoreToWin: 3 }))).toPlay();
  for (let i = 0; i < 20 && m.state.phase === "playing"; i++) {
    m.put(1, under(m.state.items.find((it) => it.active)!)).tick();
  }
  assert.equal(m.state.phase, "finished");
  assert.equal(m.state.winner, 2);
  assert.ok(m.state.scores[1] >= 3);
  assert.equal(m.of("round-end")[0].why, "score");
  assert.deepEqual(scoreboard(m.events, 2), m.state.scores);
});

test("collect: on time the team with more wins", () => {
  const m = drive(setupOf(game("collect", { scoreToWin: 50 }))).toPlay();
  m.put(0, under(m.item("pickup-2"))).tick();
  m.put(0, [-15, 0, 0]).until((s) => s.phase === "finished");
  assert.equal(m.of("round-end")[0].why, "time");
  assert.equal(m.state.winner, m.state.scores[0] > m.state.scores[1] ? 1 : 0);
  assert.ok(m.state.scores[0] > 0);
});

// ── Capture the flag ───────────────────────────────────────────────────

test("capture the flag: take the other flag to your own base", () => {
  const m = drive(setupOf(game("capture-the-flag", { scoreToWin: 1 }))).toPlay();
  assert.deepEqual(m.state.items.map((i) => [i.id, i.team, i.x, i.y, i.z]), [["flag-1", 1, -15, 1, 0], ["flag-2", 2, 15, 1, 0]]);
  // Your own flag at home is not something to pick up
  m.tick(2);
  assert.deepEqual(m.of("pickup"), []);
  const take = m.put(0, [15, 0, 0]).tick();
  assert.deepEqual(only(take, "pickup")[0], { tick: m.state.tick, type: "pickup", slot: 0, team: 1, item: "flag-2" });
  assert.equal(m.player(0).carrying, "flag-2");
  m.put(0, [3, 0, 2]).tick();
  assert.deepEqual([m.item("flag-2").x, m.item("flag-2").z, m.item("flag-2").heldBy], [3, 2, 0]);
  const home = m.put(0, [-15, 0, 0]).tick();
  assert.deepEqual(types(home).filter((t) => t !== "enter-zone"), ["capture", "score", "round-end", "match-end"]);
  assert.equal(m.player(0).carrying, null);
  assert.deepEqual([m.item("flag-2").x, m.item("flag-2").heldBy], [15, null]);
  assert.equal(m.state.winner, 1);
});

test("capture the flag: a carrier who leaves drops the flag where they stood; its own team sends it home", () => {
  const m = drive(setupOf(game("capture-the-flag"), 4)).toPlay();
  m.put(0, under(m.item("flag-2"))).tick();
  m.put(0, [5, 0, -5]).tick();
  const ev = m.tick(1, [{ type: "leave", slot: 0 }]);
  assert.deepEqual(types(ev), ["drop", "leave"]);
  assert.deepEqual(ev[0].to, [5, 0, -5]);
  assert.deepEqual([m.item("flag-2").x, m.item("flag-2").z, m.item("flag-2").heldBy], [5, -5, null]);
  // A teammate of the carrier can pick it up where it lies…
  m.put(2, [5, 0, -5]).tick();
  assert.equal(m.player(2).carrying, "flag-2");
  m.tick(1, [{ type: "leave", slot: 2 }]);
  // …and the flag's own team touching it sends it home
  const back = m.put(1, [5.5, 0, -5]).tick();
  assert.deepEqual(only(back, "drop")[0], { tick: m.state.tick, type: "drop", team: 2, item: "flag-2", to: [15, 1, 0], why: "home" });
  assert.deepEqual([m.item("flag-2").x, m.item("flag-2").y, m.item("flag-2").z], [15, 1, 0]);
});

test("capture the flag: a carrier sent back from outside drops the flag, and it goes home", () => {
  const m = drive(setupOf(game("capture-the-flag", { edge: "instant" }))).toPlay();
  m.put(0, [15, 0, 0]).tick();
  const ev = m.put(0, [30, 0, 0]).tick();
  assert.deepEqual(types(ev).filter((t) => t !== "leave-zone"), ["out-of-bounds", "drop", "return"]);
  assert.deepEqual(only(ev, "drop")[0].to, [15, 1, 0]);
  assert.equal(m.player(0).carrying, null);
  assert.equal(m.item("flag-2").heldBy, null);
});

test("capture the flag with one team: nothing to capture, the round runs out as a draw", () => {
  const m = drive(setupOf(game("capture-the-flag", { teams: 1 }, { zones: [RED, GOAL] })));
  assert.deepEqual(m.state.items, []);
  m.until((s) => s.phase === "finished");
  assert.equal(m.state.winner, 0);
  assert.equal(m.of("match-end")[0].why, "time");
});

// ── King of the hill ───────────────────────────────────────────────────

test("king of the hill: a point a second while one team holds it alone", () => {
  const m = drive(setupOf(game("king-of-the-hill", { scoreToWin: 5 }))).toPlay();
  const ev = m.put(0, IN_GOAL).tick();
  assert.deepEqual(only(ev, "hill")[0], { tick: m.state.tick, type: "hill", team: 1 });
  assert.equal(m.state.hill, 1);
  m.tick(8);
  assert.deepEqual(m.state.scores, [0, 0]);
  m.tick();
  assert.deepEqual(m.state.scores, [1, 0]);
  // Contested: nobody holds it, nobody scores
  const contested = m.put(1, [1, 0, -14]).tick();
  assert.equal(only(contested, "hill")[0].team, 0);
  m.tick(30);
  assert.deepEqual(m.state.scores, [1, 0]);
  // Team 2 alone now
  m.put(0, [-15, 0, 0]).tick();
  assert.equal(m.state.hill, 2);
  m.until((s) => s.phase === "finished");
  assert.deepEqual(m.state.scores, [1, 5]);
  assert.equal(m.state.winner, 2);
  assert.equal(m.of("round-end")[0].why, "score");
  assert.deepEqual(scoreboard(m.events, 2), [1, 5]);
});

// ── Survive ────────────────────────────────────────────────────────────

test("survive: being sent back puts you out; when everyone is out the round ends", () => {
  const m = drive(setupOf(game("survive", { teams: 1, edge: "instant" }, { zones: [RED] }))).toPlay();
  const ev = m.put(0, [0, 0, 30]).tick();
  assert.deepEqual(types(ev).filter((t) => t !== "leave-zone"), ["out-of-bounds", "return", "out"]);
  assert.equal(m.player(0).out, true);
  assert.equal(m.state.phase, "playing");
  const last = m.put(1, [0, 0, 30]).tick();
  assert.deepEqual(types(last).slice(-3), ["out", "round-end", "match-end"]);
  assert.deepEqual([m.of("round-end")[0].team, m.of("round-end")[0].why], [0, "all-out"]);
  assert.equal(m.state.winner, 0);
});

test("survive: scoreToWin is how many returns you can take", () => {
  const m = drive(setupOf(game("survive", { teams: 1, edge: "instant", scoreToWin: 2 }, { zones: [RED] }))).toPlay();
  m.put(0, [0, 0, 30]).tick();
  assert.equal(m.player(0).out, false);
  m.tick(RETURN_GRACE_TICKS);
  m.put(0, [0, 0, 30]).tick();
  assert.equal(m.player(0).out, true);
  assert.equal(m.player(0).returns, 2);
  // Out players are left alone by the edge
  m.put(0, [0, 0, 30]).tick(RETURN_GRACE_TICKS + 5);
  assert.equal(m.player(0).returns, 2);
});

test("survive, one team: lasting until time is a win for team 1, a point per survivor", () => {
  const m = drive(setupOf(game("survive", { teams: 1, edge: "instant" }, { zones: [RED] }), 3)).toPlay();
  m.put(2, [0, 0, 30]).tick();
  m.until((s) => s.phase === "finished");
  assert.equal(m.state.winner, 1);
  assert.deepEqual(m.state.scores, [2]);
  assert.deepEqual(m.of("score").map((e) => [e.slot, e.team, e.value]), [[0, 1, 1], [1, 1, 1]]);
  assert.equal(m.of("round-end")[0].why, "time");
});

test("survive, two teams: the last team standing wins at once", () => {
  const m = drive(setupOf(game("survive", { edge: "instant" }), 4)).toPlay();
  m.put(0, [0, 0, 30]).tick();
  assert.equal(m.state.phase, "playing");
  m.put(2, [0, 0, 30]).tick();
  assert.equal(m.state.phase, "finished");
  assert.equal(m.state.winner, 2);
  assert.deepEqual(m.state.scores, [0, 2]);
  assert.equal(m.of("round-end")[0].why, "all-out");
});

// ── Build together ─────────────────────────────────────────────────────

test("build together: carry the pieces to the site, one at a time, before time runs out", () => {
  const m = drive(setupOf(game("build-together", { teams: 1, scoreToWin: 2 }, { zones: [RED] }))).toPlay();
  assert.deepEqual(m.state.items.map((i) => i.kind), ["piece", "piece"]);
  for (const it of m.state.items) assert.ok(Math.hypot(it.x, it.z) > 3, "pieces don't start on the site");
  const one = m.put(0, under(m.item("piece-1"))).tick();
  assert.equal(only(one, "pickup")[0].item, "piece-1");
  // Hands full: touching another piece does nothing
  m.put(0, under(m.item("piece-2"))).tick();
  assert.equal(m.player(0).carrying, "piece-1");
  assert.equal(m.item("piece-2").heldBy, null);
  const built = m.put(0, [1, 0, 1]).tick();
  assert.deepEqual(types(built), ["piece", "score"]);
  assert.equal(m.item("piece-1").active, false);
  m.put(1, under(m.item("piece-2"))).tick();
  m.put(1, [0, 0, 0]).tick();
  assert.equal(m.state.phase, "finished");
  assert.equal(m.state.winner, 1);
  assert.deepEqual(m.state.scores, [2]);
  assert.equal(m.of("round-end")[0].why, "score");
});

test("build together: the goal zones are the site when there are any, and time up is nobody's", () => {
  const m = drive(setupOf(game("build-together", { teams: 1, scoreToWin: 3 }, { zones: [RED, GOAL] }))).toPlay();
  m.put(0, under(m.item("piece-1"))).tick();
  m.put(0, [0, 0, 0]).tick(2);
  assert.deepEqual(m.of("piece"), []);
  m.put(0, IN_GOAL).tick();
  assert.equal(m.of("piece").length, 1);
  m.until((s) => s.phase === "finished");
  assert.equal(m.state.winner, 0);
  assert.deepEqual(m.state.scores, [1]);
  assert.equal(m.of("round-end")[0].why, "time");
});

test("build together with two teams: each has its own count and delivered pieces come back", () => {
  const m = drive(setupOf(game("build-together", { scoreToWin: 2 }, { zones: [RED, BLUE] }))).toPlay();
  m.put(0, under(m.item("piece-1"))).put(1, under(m.item("piece-2"))).tick();
  m.put(0, [0, 0, 0]).put(1, [0, 0, 1]).tick();
  assert.deepEqual(m.state.scores, [1, 1]);
  m.put(0, [-15, 0, 0]).put(1, [15, 0, 0]).tick(RESPAWN_TICKS);
  assert.equal(m.item("piece-1").active, true);
  m.put(1, under(m.item("piece-1"))).tick();
  m.put(1, [0, 0, 0]).tick();
  assert.equal(m.state.winner, 2);
});

// ── The edge and keep-out zones ────────────────────────────────────────

test("soft edge: a warning on the first tick outside, back to spawn when the countdown runs out", () => {
  const m = drive(setupOf(game("race"))).toPlay();
  const first = m.put(0, [25, 0, 0]).tick();
  assert.deepEqual(only(first, "out-of-bounds")[0], { tick: COUNTDOWN + 1, type: "out-of-bounds", slot: 0, team: 1, value: 3 });
  m.tick(28);
  assert.equal(m.player(0).outsideTicks, 29);
  assert.deepEqual(m.of("return").filter((e) => e.why === "edge"), []);
  const back = m.tick();
  assert.deepEqual(only(back, "return")[0], { tick: COUNTDOWN + 30, type: "return", slot: 0, team: 1, to: [-15, 0, 0], why: "edge" });
  assert.equal(m.player(0).returns, 1);
  assert.equal(m.player(0).outsideTicks, 0);
  assert.deepEqual([m.player(0).x, m.player(0).z], [-15, 0]);
  assert.equal(m.of("out-of-bounds").length, 1);
});

test("soft edge: coming back inside resets the countdown; above the ceiling is outside too", () => {
  const m = drive(setupOf(game("race"))).toPlay();
  m.put(0, [0, 0, 25]).tick(20);
  m.put(0, [0, 0, 19]).tick();
  assert.equal(m.player(0).outsideTicks, 0);
  m.put(0, [0, 21, 0]).tick(20);
  assert.equal(m.player(0).outsideTicks, 20);
  assert.equal(m.of("out-of-bounds").length, 2);
  assert.equal(m.player(0).returns, 0);
});

test("instant edge: straight back", () => {
  const m = drive(setupOf(game("race", { edge: "instant" }))).toPlay();
  const ev = m.put(1, [20.5, 0, 0]).tick();
  assert.deepEqual(types(ev).filter((t) => t !== "leave-zone"), ["out-of-bounds", "return"]);
  assert.deepEqual(only(ev, "return")[0].to, [15, 0, 0]);
  assert.equal(m.player(1).returns, 1);
});

test("wall edge: the client clamps; only a sample well outside is sent back", () => {
  const m = drive(setupOf(game("race", { edge: "wall" }))).toPlay();
  m.put(0, [-21.4, 0, 0]).tick(40);
  assert.deepEqual(m.of("out-of-bounds"), []);
  assert.equal(m.player(0).outsideTicks, 0);
  const ev = m.put(0, [-21.6, 0, 0]).tick();
  assert.deepEqual(types(ev), ["out-of-bounds", "return"]);
});

test("after a return the player is held at spawn until their samples catch up (no double return)", () => {
  const m = drive(setupOf(game("race", { edge: "instant" })), { obey: false }).toPlay();
  m.put(0, [25, 0, 0]).tick();
  assert.equal(m.of("return").filter((e) => e.why === "edge").length, 1);
  // The client keeps reporting the old place for a while
  m.tick(RETURN_GRACE_TICKS - 1);
  assert.equal(m.of("return").filter((e) => e.why === "edge").length, 1);
  assert.deepEqual([m.player(0).x, m.player(0).z], [-15, 0]);
  // Still there after the grace: now it counts again
  m.tick();
  assert.equal(m.of("return").filter((e) => e.why === "edge").length, 2);
  // A sample near the spawn ends the grace early
  m.put(0, [-14, 0, 1]).tick();
  assert.deepEqual([m.player(0).x, m.player(0).z, m.player(0).grace], [-14, 1, 0]);
});

test("keep-out zone, soft: a warning on entry, then back to spawn; leaving resets it", () => {
  const m = drive(setupOf(game("race"))).toPlay();
  const ev = m.put(0, [0, 0, 5]).tick();
  assert.deepEqual(types(ev), ["leave-zone", "enter-zone", "keep-out"]);
  assert.deepEqual([only(ev, "keep-out")[0].zone, only(ev, "keep-out")[0].value], ["pit", 3]);
  m.tick(10);
  m.put(0, [0, 0, 9]).tick();
  assert.equal(m.player(0).keepOutTicks, 0);
  m.put(0, [0, 0, 5]).tick(29);
  assert.equal(m.player(0).returns, 0);
  const back = m.tick();
  assert.equal(only(back, "return")[0].why, "keep-out");
  assert.equal(m.player(0).returns, 1);
});

test("keep-out zone, instant: straight back", () => {
  const zones = [RED, BLUE, GOAL, { ...PIT, ret: "instant" }];
  const m = drive(setupOf(game("race", {}, { zones }))).toPlay();
  const ev = m.put(1, [1, 1, 5]).tick();
  assert.deepEqual(types(ev), ["leave-zone", "enter-zone", "keep-out", "return"]);
  assert.equal(m.player(1).returns, 1);
});

test("enter-zone and leave-zone for every zone a player crosses", () => {
  const m = drive(setupOf(game("king-of-the-hill"))).toPlay();
  m.put(0, [-10, 0, 0]).tick();
  m.put(0, IN_GOAL).tick();
  m.put(0, [0, 0, -5]).tick();
  assert.deepEqual(m.events.filter((e) => e.slot === 0 && (e.type === "enter-zone" || e.type === "leave-zone")).map((e) => [e.type, e.zone]),
    [["leave-zone", "red"], ["enter-zone", "goal"], ["leave-zone", "goal"]]);
  assert.deepEqual(m.player(0).zones, []);
  assert.deepEqual(m.player(1).zones, ["blue"]);
});

// ── Rounds and the match's end ─────────────────────────────────────────

test("rounds: a break, then the next round starts clean; the match ends early once it is decided", () => {
  const setup = setupOf(game("race", { rounds: 3 }));
  const m = drive(setup).toPlay();
  const end1 = m.put(0, IN_GOAL).tick();
  assert.deepEqual(types(end1).slice(-1), ["round-end"]);
  assert.equal(m.state.phase, "break");
  assert.equal(m.state.left, BREAK);
  assert.deepEqual(m.state.rounds, [1, 0]);
  m.tick(BREAK - 1);
  assert.equal(m.state.phase, "break");
  assert.deepEqual(m.state.scores, [1, 0]);
  const start2 = m.tick();
  assert.deepEqual(types(start2), ["round-start", "return", "return"]);
  assert.equal(start2[0].value, 2);
  assert.deepEqual([m.state.phase, m.state.round, m.state.left], ["countdown", 2, COUNTDOWN]);
  assert.deepEqual(m.state.scores, [0, 0]);
  assert.deepEqual([m.player(0).x, m.player(0).z], [-15, 0]);
  m.toPlay();
  assert.equal(m.state.tick, COUNTDOWN + 1 + BREAK + COUNTDOWN);
  m.put(0, IN_GOAL).tick();
  // 2-0 with one round to go: team 2 can't catch up
  assert.equal(m.state.phase, "finished");
  assert.equal(m.state.round, 2);
  assert.deepEqual(resultOf(setup, m.state)?.rounds, [2, 0]);
  assert.equal(m.state.winner, 1);
  assert.equal(m.of("match-end").length, 1);
});

test("rounds: one each is a drawn match; all the rounds are played when it stays open", () => {
  const m = drive(setupOf(game("race", { rounds: 2 }))).toPlay();
  m.put(0, IN_GOAL).tick();
  m.until((s) => s.phase === "playing");
  m.put(1, IN_GOAL).tick();
  assert.equal(m.state.phase, "finished");
  assert.deepEqual(m.state.rounds, [1, 1]);
  assert.equal(m.state.winner, 0);
  assert.equal(m.of("match-end")[0].team, 0);
});

test("a round's items are placed afresh", () => {
  const m = drive(setupOf(game("collect", { rounds: 2, scoreToWin: 1 }))).toPlay();
  const first = m.state.items.map((i) => [i.x, i.z]);
  m.put(0, under(m.item("pickup-1"))).tick();
  m.until((s) => s.phase === "countdown");
  assert.equal(m.state.items.length, 6);
  assert.ok(m.state.items.every((i) => i.active));
  assert.notDeepEqual(m.state.items.map((i) => [i.x, i.z]), first);
});

test("a finished match no longer steps", () => {
  const setup = setupOf(game("race"));
  const m = drive(setup).toPlay();
  m.put(0, IN_GOAL).tick();
  const again = stepMatch(setup, m.state, [{ slot: 1, x: 0, y: 0, z: -15 }], [{ type: "host-end" }]);
  assert.deepEqual(again.events, []);
  assert.deepEqual(again.state, m.state);
});

// ── Controls ───────────────────────────────────────────────────────────

test("leave: the player is gone for good, the match goes on", () => {
  const setup = setupOf(game("race"), 4);
  const m = drive(setup).toPlay();
  const ev = m.tick(1, [{ type: "leave", slot: 2 }, { type: "leave", slot: 2 }, { type: "leave", slot: 99 }]);
  assert.deepEqual(ev, [{ tick: m.state.tick, type: "leave", slot: 2, team: 1 }]);
  assert.equal(m.player(2).left, true);
  // Their samples no longer count
  m.put(2, IN_GOAL).tick(2);
  assert.deepEqual(m.of("goal"), []);
  assert.equal(m.state.phase, "playing");
  m.put(1, IN_GOAL).tick();
  assert.equal(resultOf(setup, m.state)?.players[2].left, true);
});

test("when everyone has left the match ends as empty", () => {
  const setup = setupOf(game("race"));
  const m = drive(setup);
  m.tick(10, [{ type: "leave", slot: 0 }]);
  assert.equal(m.state.phase, "countdown");
  const ev = m.tick(1, [{ type: "leave", slot: 1 }]);
  assert.deepEqual(types(ev), ["leave", "match-end"]);
  assert.equal(ev[1].why, "empty");
  assert.deepEqual([resultOf(setup, m.state)?.why, resultOf(setup, m.state)?.winner], ["empty", 0]);
});

test("host-end stops the match; rounds already won still decide it", () => {
  const setup = setupOf(game("race", { rounds: 3 }));
  const m = drive(setup).toPlay();
  m.put(1, IN_GOAL).tick();
  const ev = m.tick(1, [{ type: "host-end" }]);
  assert.deepEqual(ev, [{ tick: m.state.tick, type: "match-end", team: 2, why: "host" }]);
  assert.deepEqual(resultOf(setup, m.state), {
    winner: 2, rounds: [0, 1], scores: [0, 1], ticks: COUNTDOWN + 2, why: "host",
    players: [{ slot: 0, score: 0, returns: 0, left: false }, { slot: 1, score: 1, returns: 0, left: false }],
  });
});

test("swap is recorded and changes nothing else", () => {
  const setup = setupOf(game("race"));
  const m = drive(setup).toPlay();
  const before = m.state;
  const ev = m.tick(1, [{ type: "swap", slot: 1, to: "npc" }, { type: "swap", slot: 1, to: "human" }]);
  assert.deepEqual(ev, [{ tick: before.tick + 1, type: "swap", slot: 1, value: 1 }, { tick: before.tick + 1, type: "swap", slot: 1, value: 0 }]);
  assert.deepEqual(m.state, stepMatch(setup, before, []).state);
});

// ── When ▸ If ▸ Do ─────────────────────────────────────────────────────

/** A two-team survive game is a quiet stage for rules: nothing scores or ends by itself before time. */
const quiet = (rules: unknown[], settings: Record<string, unknown> = {}) => drive(setupOf(game("survive", { scoreToWin: 9, ...settings }, { rules }), 4));

test("rule: entering one zone adds score for the actor's team, the others, or all", () => {
  const m = quiet([
    { id: "mine", when: { event: "enter-zone", zone: "goal" }, if: [], do: [{ type: "add-score", target: "actor", value: 2 }] },
    { id: "theirs", when: { event: "leave-zone", zone: "goal" }, if: [], do: [{ type: "add-score", target: "others", value: 3 }] },
    { id: "all", when: { event: "enter-zone", zone: "blue" }, if: [], do: [{ type: "add-score", target: "all", value: 1 }] },
  ]).toPlay();
  const ev = m.put(0, IN_GOAL).tick();
  assert.deepEqual(only(ev, "rule"), [{ tick: m.state.tick, type: "rule", slot: 0, team: 1, why: "mine" }]);
  assert.deepEqual(only(ev, "score"), [{ tick: m.state.tick, type: "score", slot: 0, team: 1, value: 2 }]);
  m.put(0, [0, 0, -5]).tick();
  assert.deepEqual(m.state.scores, [2, 3]);
  m.put(0, [15, 0, 0]).tick();
  assert.deepEqual(m.state.scores, [3, 4]);
  assert.deepEqual(m.of("rule").map((e) => e.why), ["mine", "theirs", "all"]);
  assert.deepEqual(scoreboard(m.events, 2), [3, 4]);
});

test("rule: a score can't go below zero, and the event carries what really changed", () => {
  const m = quiet([{ id: "tax", when: { event: "enter-zone", zone: "goal" }, if: [], do: [{ type: "add-score", target: "all", value: 2 }, { type: "add-score", target: "actor", value: -5 }] }]).toPlay();
  m.put(1, IN_GOAL).tick();
  assert.deepEqual(m.state.scores, [2, 0]);
  assert.deepEqual(m.of("score").map((e) => [e.team, e.value]), [[1, 2], [2, 2], [2, -2]]);
});

test("rule: seconds-left fires once and add-seconds moves the clock", () => {
  const m = quiet([{ id: "extra", when: { event: "seconds-left", seconds: 30 }, if: [], do: [{ type: "add-seconds", value: 20 }] }]).toPlay();
  m.tick(299);
  assert.deepEqual(m.of("rule"), []);
  m.tick();
  assert.equal(m.of("rule").length, 1);
  assert.equal(m.state.left, 500);
  m.until((s) => s.phase === "finished");
  assert.equal(m.of("rule").length, 1);
  assert.equal(m.state.tick, COUNTDOWN + 800);
});

test("rule: add-seconds keeps the clock between 1 s and the longest round", () => {
  const m = quiet([
    { id: "cut", when: { event: "enter-zone", zone: "goal" }, if: [], do: [{ type: "add-seconds", value: -600 }] },
    { id: "pile", when: { event: "leave-zone", zone: "goal" }, if: [], do: [{ type: "add-seconds", value: 600 }, { type: "add-seconds", value: 600 }, { type: "add-seconds", value: 600 }, { type: "add-seconds", value: 600 }] },
  ]).toPlay();
  m.put(0, IN_GOAL).tick();
  assert.equal(m.state.left, 10);
  m.put(0, [0, 0, -5]).tick();
  assert.equal(m.state.left, GAME_LIMITS.roundSeconds[1] * 10);
});

test("rule: return-to-spawn for the actor, the other teams, or everyone", () => {
  const m = quiet([
    { id: "me", when: { event: "enter-zone", zone: "goal" }, if: [], do: [{ type: "return-to-spawn", target: "actor" }] },
    { id: "them", when: { event: "enter-zone", zone: "pit" }, if: [], do: [{ type: "return-to-spawn", target: "others" }] },
    { id: "all", when: { event: "every-seconds", seconds: 20 }, if: [], do: [{ type: "return-to-spawn", target: "all" }] },
  ]).toPlay();
  const me = m.put(0, IN_GOAL).tick();
  assert.deepEqual(only(me, "return").map((e) => [e.slot, e.why]), [[0, "rule"]]);
  assert.equal(m.player(0).returns, 1);
  const them = m.put(2, [0, 0, 5]).tick();
  assert.deepEqual(only(them, "return").map((e) => e.slot), [1, 3]);
  m.put(2, [-10, 0, 0]).until((s) => (s.played ?? 0) === 200);
  assert.deepEqual(m.events.filter((e) => e.type === "return" && e.tick === m.state.tick).map((e) => e.slot), [0, 1, 2, 3]);
});

test("rule: end-round gives the round to the actor's team, or to nobody", () => {
  const win = quiet([{ id: "flagpole", when: { event: "enter-zone", zone: "goal" }, if: [], do: [{ type: "end-round", target: "actor" }, { type: "announce", value: 3 }] }]).toPlay();
  const ev = win.put(1, IN_GOAL).tick();
  assert.deepEqual([only(ev, "round-end")[0].team, only(ev, "round-end")[0].why], [2, "rule"]);
  assert.deepEqual(only(ev, "announce"), [], "nothing runs after end-round");
  assert.equal(win.state.winner, 2);
  // Survivors still get their point on the scoreboard
  assert.deepEqual(win.state.scores, [2, 2]);

  const draw = quiet([{ id: "bell", when: { event: "every-seconds", seconds: 3 }, if: [], do: [{ type: "end-round", target: "actor" }] }]).toPlay();
  draw.tick(30);
  assert.equal(draw.state.phase, "finished");
  assert.deepEqual([draw.of("round-end")[0].team, draw.state.winner], [0, 0]);
});

test("rule: variables, conditions and announcements", () => {
  const m = quiet([
    { id: "count", when: { event: "every-seconds", seconds: 1 }, if: [], do: [{ type: "add-var", name: "var-a", value: 1 }] },
    { id: "third", when: { event: "every-seconds", seconds: 1 }, if: [{ left: "var-a", op: "=", right: 3 }, { left: "var-b", op: "<", right: 1 }], do: [{ type: "set-var", name: "var-b", value: 7 }, { type: "announce", value: 2 }] },
    { id: "never", when: { event: "every-seconds", seconds: 1 }, if: [{ left: "var-a", op: ">=", right: 1 }, { left: "var-c", op: ">", right: 0 }], do: [{ type: "announce", value: 4 }] },
  ]).toPlay();
  m.tick(29);
  assert.deepEqual(m.state.vars, [2, 0, 0]);
  const ev = m.tick();
  assert.deepEqual(m.state.vars, [3, 7, 0]);
  assert.deepEqual(only(ev, "announce"), [{ tick: m.state.tick, type: "announce", value: 2 }]);
  m.tick(40);
  assert.deepEqual(m.state.vars, [7, 7, 0]);
  assert.equal(m.of("announce").length, 1);
});

test("rule: match-start once, round-start every round, on the first tick of play", () => {
  const m = quiet([
    { id: "hello", when: { event: "match-start" }, if: [], do: [{ type: "announce", value: 0 }] },
    { id: "round", when: { event: "round-start" }, if: [{ left: "round", op: ">=", right: 1 }], do: [{ type: "announce", value: 7 }, { type: "add-score", target: "all", value: 1 }] },
  ], { rounds: 2 });
  m.toPlay();
  assert.deepEqual(m.of("announce"), []);
  m.tick();
  assert.deepEqual(m.of("announce").map((e) => [e.tick, e.value]), [[COUNTDOWN + 1, 0], [COUNTDOWN + 1, 7]]);
  assert.deepEqual(m.state.scores, [1, 1]);
  m.until((s) => s.phase === "finished");
  assert.deepEqual(m.of("announce").map((e) => e.value), [0, 7, 7]);
  assert.deepEqual(m.of("rule").map((e) => e.why), ["hello", "round", "round"]);
});

test("rule conditions: score, other-score, seconds-left and players", () => {
  const m = quiet([
    { id: "a", when: { event: "enter-zone", zone: "goal" }, if: [{ left: "seconds-left", op: "<=", right: 60 }, { left: "seconds-left", op: ">", right: 58 }], do: [{ type: "add-score", target: "actor", value: 2 }] },
    { id: "lead", when: { event: "score" }, if: [{ left: "score", op: ">", right: 3 }, { left: "other-score", op: "<=", right: 2 }, { left: "players", op: "=", right: 3 }], do: [{ type: "set-var", name: "var-c", value: 1 }] },
  ]).toPlay();
  m.put(1, IN_GOAL).tick();
  m.put(1, [0, 0, -5]).tick();
  m.put(0, IN_GOAL).tick();
  m.put(0, [0, 0, -5]).tick();
  m.put(0, IN_GOAL).tick();
  assert.deepEqual(m.state.scores, [4, 2]);
  assert.deepEqual(m.state.vars, [0, 0, 0], "four players in: the players condition fails");
  m.put(0, [0, 0, -5]).tick(1, [{ type: "leave", slot: 3 }]);
  m.put(0, IN_GOAL).tick();
  assert.deepEqual(m.state.vars, [0, 0, 1]);
});

test("rules react to out-of-bounds, pickup and capture", () => {
  const rules = [
    { id: "oob", when: { event: "out-of-bounds" }, if: [], do: [{ type: "add-score", target: "others", value: 1 }] },
    { id: "got", when: { event: "pickup" }, if: [], do: [{ type: "add-var", name: "var-a", value: 1 }] },
    { id: "cap", when: { event: "capture" }, if: [], do: [{ type: "add-score", target: "actor", value: 1 }, { type: "return-to-spawn", target: "all" }] },
  ];
  const m = drive(setupOf(game("capture-the-flag", { scoreToWin: 5 }, { rules }))).toPlay();
  m.put(1, [0, 0, 22]).tick();
  assert.deepEqual(m.state.scores, [1, 0]);
  m.put(1, [15, 0, 0]).put(0, [15, 0, 0]).tick();
  assert.equal(m.state.vars[0], 1);
  const ev = m.put(0, [-15, 0, 0]).tick();
  assert.deepEqual(m.state.scores, [3, 0]);
  assert.deepEqual(only(ev, "return").map((e) => e.slot), [0, 1]);
  assert.deepEqual(scoreboard(m.events, 2), [3, 0]);
});

test("time rules have no actor: actor targets do nothing, all works", () => {
  const m = quiet([{ id: "t", when: { event: "every-seconds", seconds: 2 }, if: [], do: [
    { type: "add-score", target: "actor", value: 5 }, { type: "return-to-spawn", target: "actor" }, { type: "add-score", target: "all", value: 1 },
  ] }]).toPlay();
  const ev = m.tick(20);
  assert.deepEqual(m.state.scores, [1, 1]);
  assert.deepEqual(only(ev, "return"), []);
  assert.deepEqual(only(ev, "rule"), [{ tick: m.state.tick, type: "rule", why: "t" }]);
});

test("a rule that feeds itself stops at the cascade depth", () => {
  const rules = [{ id: "echo", when: { event: "score" }, if: [], do: [{ type: "add-score", target: "actor", value: 1 }] }];
  const m = drive(setupOf(game("race", { scoreToWin: 50 }, { rules }))).toPlay();
  const ev = m.put(0, IN_GOAL).tick();
  assert.equal(only(ev, "rule").length, GAME_LIMITS.ruleDepth);
  assert.deepEqual(m.state.scores, [1 + GAME_LIMITS.ruleDepth, 0]);
  assert.deepEqual(scoreboard(m.events, 2), m.state.scores);
});

test("rules stop quietly at the per-tick action budget", () => {
  const rules = Array.from({ length: GAME_LIMITS.rules }, (_, i) => ({
    id: `r${i}`, when: { event: "score" }, if: [], do: Array.from({ length: GAME_LIMITS.ruleActions }, () => ({ type: "add-var", name: "var-a", value: 1 })),
  }));
  const g = game("race", { scoreToWin: 50 }, { rules });
  assert.equal(g.rules.length * g.rules[0].do.length, GAME_LIMITS.ruleActionsPerTick);
  // One goal: exactly the budget
  const one = drive(setupOf(g)).toPlay();
  one.put(0, IN_GOAL).tick();
  assert.equal(one.state.vars[0], 256);
  // Two goals on one tick would be twice that
  const two = drive(setupOf(g)).toPlay();
  const ev = two.put(0, IN_GOAL).put(1, [1, 0, -15]).tick();
  assert.equal(only(ev, "score").length, 2);
  assert.equal(two.state.vars[0], GAME_LIMITS.ruleActionsPerTick);
  assert.equal(only(ev, "rule").length, GAME_LIMITS.rules);
  // The budget is per tick: the next tick's rules run again
  two.tick(RETURN_GRACE_TICKS);
  two.put(0, IN_GOAL).tick();
  assert.equal(two.state.vars[0], 2 * GAME_LIMITS.ruleActionsPerTick);
});

// ── Determinism and the record ─────────────────────────────────────────

test("stepMatch never mutates what it is given", () => {
  const { setup, script } = busyMatch();
  deepFreeze(setup);
  let state = deepFreeze(initMatch(setup));
  for (let t = 1; t <= 700; t++) {
    const { samples, controls } = script(t);
    state = deepFreeze(stepMatch(setup, state, deepFreeze(samples), deepFreeze(controls ?? [])).state);
  }
  assert.equal(state.tick, 700);
});

test("the same inputs give the same states and events, twice", () => {
  const { setup, script } = busyMatch();
  const a = runScript(setup, script, initMatch(setup), 5000);
  const b = runScript(setup, script, initMatch(setup), 5000);
  assert.equal(a.state.phase, "finished");
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.events, b.events);
  // The script really exercises things
  const seen = new Set(types(a.events));
  for (const t of ["round-start", "pickup", "score", "out-of-bounds", "return", "rule", "announce", "swap", "leave", "round-end", "match-end"]) assert.ok(seen.has(t), t);
  assert.equal(only(a.events, "round-end").length, 2);
  // A different seed is a different match
  const c = runScript({ ...setup, seed: 1 }, script, initMatch({ ...setup, seed: 1 }), 5000);
  assert.notDeepEqual(c.events, a.events);
});

test("score events alone rebuild every round's scoreboard", () => {
  const { setup, script } = busyMatch();
  let state = initMatch(setup);
  let board = [0, 0];
  for (let t = 1; t <= 5000 && state.phase !== "finished"; t++) {
    const { samples, controls } = script(t);
    const step = stepMatch(setup, state, samples, controls);
    for (const e of step.events) {
      if (e.type === "round-start") board = [0, 0];
      if (e.type === "score") board[e.team! - 1] += e.value!;
    }
    state = step.state;
    assert.deepEqual(board, state.scores, `tick ${t}`);
  }
  assert.ok(board[0] + board[1] > 0);
});

test("the state is plain JSON: a round trip mid-match continues to the same end", () => {
  const { setup, script } = busyMatch();
  const half = runScript(setup, script, initMatch(setup), 444);
  assert.equal(half.state.phase, "playing");
  const thawed = JSON.parse(JSON.stringify(half.state)) as MatchState;
  assert.deepEqual(thawed, half.state);
  const a = runScript(setup, script, half.state, 5000);
  const b = runScript(setup, script, thawed, 5000);
  assert.equal(a.state.phase, "finished");
  assert.deepEqual(b.state, a.state);
  assert.deepEqual(b.events, a.events);
});

test("verifyRecord: a recorded match replays to the same events and result", () => {
  const { setup, script } = busyMatch();
  const run = runScript(setup, script, initMatch(setup), 5000);
  const record: MatchRecord = { v: 1, setup, frames: run.frames, events: run.events, result: resultOf(setup, run.state), startedAt: 1, endedAt: 2 };
  assert.ok(record.result);
  const stored = JSON.parse(JSON.stringify(record)) as MatchRecord;
  assert.equal(verifyRecord(stored), true);
  const replay = replayRecord(stored);
  assert.deepEqual(replay.state, run.state);
  assert.deepEqual(replay.events, run.events);
  assert.deepEqual(replay.result, record.result);
});

test("verifyRecord: a hand-driven race, the frames skipped while nobody sent anything, and a match still running", () => {
  const m = drive(setupOf(game("race", { rounds: 2 })));
  m.tick(20);
  m.put(0, [-12, 0, -2]).toPlay();
  assert.equal(m.frames[0].t, 21);
  assert.equal(verifyRecord(m.record()), true, "still running: result null");
  m.walk(0, IN_GOAL, 15);
  m.silent(0).until((s) => s.phase === "finished");
  const record = JSON.parse(JSON.stringify(m.record())) as MatchRecord;
  assert.equal(record.result?.why, "time");
  assert.ok(record.frames[record.frames.length - 1].t < record.result!.ticks, "the last ticks have no frames");
  assert.equal(verifyRecord(record), true);
  assert.deepEqual(replayRecord(record).state, m.state);
});

test("verifyRecord is false when a frame, a control, an event or the result is tampered with", () => {
  const m = drive(setupOf(game("race", { rounds: 3 }))).toPlay();
  m.put(0, [-5, 0, -10]).tick(3);
  m.put(0, IN_GOAL).tick();
  m.tick(30);
  m.tick(1, [{ type: "host-end" }]);
  const json = JSON.stringify(m.record());
  const fresh = (): MatchRecord => JSON.parse(json) as MatchRecord;
  assert.equal(verifyRecord(fresh()), true);

  // The winning step never happened: move that sample out of the goal
  const moved = fresh();
  const goalTick = moved.events.find((e) => e.type === "goal")!.tick;
  const frame = moved.frames.find((f) => f.t === goalTick)!;
  frame.s[3] = -1000;
  assert.equal(verifyRecord(moved), false);

  const noHostEnd = fresh();
  delete noHostEnd.frames[noHostEnd.frames.length - 1].c;
  assert.equal(verifyRecord(noHostEnd), false);

  const droppedFrame = fresh();
  droppedFrame.frames = droppedFrame.frames.filter((f) => f.t !== goalTick);
  assert.equal(verifyRecord(droppedFrame), false);

  const extraEvent = fresh();
  extraEvent.events.push({ tick: 60, type: "score", team: 2, value: 1 });
  assert.equal(verifyRecord(extraEvent), false);

  const otherWinner = fresh();
  otherWinner.result!.winner = 2;
  assert.equal(verifyRecord(otherWinner), false);

  const otherSeed = fresh();
  otherSeed.setup.game.settings.scoreToWin = 2;
  assert.equal(verifyRecord(otherSeed), false);

  const broken = fresh();
  (broken as unknown as { setup: unknown }).setup = null;
  assert.equal(verifyRecord(broken), false);
});

test("king of the hill: more players on the hill than the other team holds it; equal numbers contest it", () => {
  const g = game("king-of-the-hill", { scoreToWin: 50 });
  const hill = g.zones.find((z) => z.kind === "goal")!.at;
  const slots: MatchSlot[] = [0, 1, 2].map((i) => ({ slot: i, team: i < 2 ? 1 : 2, kind: "human", id: `p${i}`, name: `P${i}` }));
  const m = drive({ ...setupOf(g), slots }).toPlay();
  m.put(0, hill).put(1, hill).put(2, hill).tick();
  assert.equal(m.state.hill, 1, "two against one: team 1 holds it");
  m.tick(9);
  assert.equal(m.state.scores[0], 1);
  assert.equal(m.state.players[2].score, 0, "standing on a hill the other team holds scores nothing");
  m.put(1, [hill[0] + 9, hill[1], hill[2]]).tick();
  assert.equal(m.state.hill, 0, "one against one: contested");
});

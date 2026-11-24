/**
 * The match host (Phase 10) with fake deps, a fake referee and fake NPC movement, and the
 * real record store on node:sqlite. Time only moves when the test says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MatchHost, type NpcDriver, type Referee } from "./matches.js";
import { MatchStore } from "./match-store.js";
import type { SqlDb } from "./build-requests.js";
import { parseGame, gameMissing, type Game } from "../../../shared/game.js";
import { unpackSamples, verifyRecord, type MatchRecord, type MatchState } from "../../../shared/match.js";
import { AGAIN_MS, AWE_PER_MATCH, DROP_GRACE_MS, EMPTY_MATCH_MS, POOL_WAIT_MS, READY_MS, type MatchMessage } from "../../../shared/match-protocol.js";

const W = "11111111-2222-4333-8444-555555555555";
const RING = { x: 100, y: 0, z: 0 };
const ARRIVAL = [100, 0, 3];

function makeGame(over: Record<string, unknown> = {}): Game {
  const p = parseGame({
    template: "race", version: 1,
    settings: { teams: 2, players: { min: 2, max: 4 } },
    arena: { at: [0, 0, 0], size: [40, 20, 40] },
    zones: [
      { id: "s1", kind: "spawn", team: 1, at: [-15, 0, 0], size: [4, 3, 4] },
      { id: "s2", kind: "spawn", team: 2, at: [15, 0, 0], size: [4, 3, 4] },
      { id: "goal", kind: "goal", at: [0, 0, 15], size: [4, 3, 4] },
    ],
    lobby: { at: [100, 0, 0], size: [12, 6, 12], ring: { at: [RING.x, RING.y, RING.z], radius: 2 }, arrival: ARRIVAL },
    npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }],
    ...over,
  });
  assert.ok(p.ok);
  if (over.lobby !== null) assert.deepEqual(gameMissing(p.value), []);
  return p.value;
}

/** A referee with two rules: a sample at z ≥ 500 wins for that team; a sample at z ≤ -500 is sent back to [1, 2, 3]. */
const referee: Referee = {
  initMatch: (setup) => ({
    tick: 0, phase: "playing", round: 1, left: 600,
    scores: new Array<number>(setup.game.settings.teams).fill(0), rounds: new Array<number>(setup.game.settings.teams).fill(0),
    players: setup.slots.map((s) => ({ slot: s.slot, x: 0, y: 0, z: 0, fresh: false, out: false, left: false, outsideTicks: 0, keepOutTicks: 0, carrying: null, score: 0, returns: 0, zones: [] })),
    items: [], hill: 0, vars: [0, 0, 0], rng: setup.seed, winner: null,
  }),
  stepMatch(setup, state, samples, controls = []) {
    const s: MatchState = structuredClone(state);
    const events: ReturnType<Referee["stepMatch"]>["events"] = [];
    if (s.phase === "finished") return { state: s, events };
    for (const c of controls) {
      if (c.type === "host-end") { s.phase = "finished"; s.winner = 0; events.push({ tick: s.tick, type: "match-end", why: "host" }); }
      if (c.type === "leave") { s.players[c.slot].left = true; events.push({ tick: s.tick, type: "leave", slot: c.slot }); }
      if (c.type === "swap") events.push({ tick: s.tick, type: "swap", slot: c.slot, value: c.to === "npc" ? 1 : 0 });
    }
    for (const sm of samples) {
      const p = s.players.find((x) => x.slot === sm.slot)!;
      p.x = sm.x; p.y = sm.y; p.z = sm.z;
      if (sm.z >= 500 && s.phase !== "finished") {
        const team = setup.slots.find((x) => x.slot === sm.slot)!.team;
        s.scores[team - 1]++;
        s.winner = team;
        s.phase = "finished";
        events.push({ tick: s.tick, type: "goal", slot: sm.slot, team }, { tick: s.tick, type: "match-end", why: "score" });
      }
      if (sm.z <= -500) events.push({ tick: s.tick, type: "return", slot: sm.slot, to: [1, 2, 3] });
    }
    s.tick++;
    s.left--;
    return { state: s, events };
  },
  resultOf(_setup, state, why) {
    if (state.phase !== "finished" && !why) return null;
    return { winner: state.winner ?? 0, rounds: state.rounds, scores: state.scores, players: state.players.map((p) => ({ slot: p.slot, score: p.score, returns: p.returns, left: p.left })), ticks: state.tick, why: why ?? (state.winner ? "score" : "host") };
  },
};
/** NPCs walk one metre along x every tick. */
const npc: NpcDriver = {
  initNpc: () => ({ x: 0, y: 0, z: 0, goal: null, wait: 0, rng: 0 }),
  stepNpc: (_setup, _state, _slot, mind) => ({ ...mind, x: mind.x + 1 }),
};

function rig(gameOver: Record<string, unknown> = {}, aweCap = Infinity, real = false) {
  let t = 1_000_000;
  let seed = 1;
  let game: Game | null = makeGame(gameOver);
  const sent: { to: string; msg: MatchMessage }[] = [];
  const pos = new Map<string, { x: number; y: number; z: number }>();
  const on = new Set<string>();
  const groups = new Map<string, string | null>();
  const awes: { id: string; amount: number; ref: string }[] = [];
  const chats: string[] = [];
  const verified: MatchRecord[] = [];
  const owners = new Set(["owner"]);
  /** Players behind the 18+ door (research candidates, Q10b). */
  const adults = new Set<string>();
  const store = new MatchStore(new DatabaseSync(":memory:") as unknown as SqlDb);
  let granted = 0;
  const host = new MatchHost({
    game: () => game,
    isOwner: (_w, id) => owners.has(id),
    position: (_w, id) => pos.get(id) ?? null,
    online: (_w, id) => on.has(id),
    send: (to, _w, msg) => { sent.push({ to, msg }); },
    setGroup: (id, g) => { groups.set(id, g); },
    name: (id) => id.toUpperCase(),
    researchId: (id) => `r-${id}`,
    researchCandidate: (id) => adults.has(id),
    awe: (id, amount, ref) => {
      const give = Math.max(0, Math.min(amount, aweCap - granted));
      granted += give;
      awes.push({ id, amount: give, ref });
      return give;
    },
    chat: (_w, line) => { chats.push(line); },
    store,
    ...(real ? {} : { referee, npc, verify: (r: MatchRecord) => { verified.push(r); return true; } }),
    now: () => t,
    seed: () => (seed = (seed * 1103515245 + 12345) >>> 0),
  });
  const of = <T extends MatchMessage["t"]>(id: string, type: T) => sent.filter((s) => s.to === id && s.msg.t === type).map((s) => s.msg as Extract<MatchMessage, { t: T }>);
  const last = <T extends MatchMessage["t"]>(id: string, type: T) => of(id, type).at(-1);
  const run = (ms: number) => { for (let i = 0; i < Math.round(ms / 100); i++) { t += 100; host.tick(); } };
  const say = (id: string, intent: Record<string, unknown>) => host.intent(W, id, intent);
  /** Enter the world standing in the ring and say hello. */
  const enter = (...ids: string[]) => { for (const id of ids) { on.add(id); pos.set(id, { ...RING }); say(id, { t: "hello" }); } };
  const queue = (...ids: string[]) => { for (const id of ids) say(id, { t: "queue", on: true }); };
  /** Enter, queue, and run through the ready check: returns the match id. */
  const play = (...ids: string[]) => {
    enter(...ids);
    queue(...ids);
    run(POOL_WAIT_MS + 100);
    run(READY_MS + 100);
    const start = last(ids[0], "start");
    assert.ok(start, "the match started");
    // Everyone arrives at their spawn (their presence catches up with the teleport)
    for (const id of ids) { const s = last(id, "start")!; pos.set(id, { x: s.spawn[0], y: s.spawn[1], z: s.spawn[2] }); }
    run(100);
    return start.matchId;
  };
  return { host, store, sent, pos, on, groups, awes, chats, verified, owners, adults, of, last, run, say, enter, queue, play, setGame: (g: Game | null) => { game = g; }, now: () => t };
}

test("queue → found → start: the roster locks after the ready check and the players are placed in an instance", () => {
  const r = rig();
  r.enter("ann", "ben");
  assert.deepEqual(r.last("ann", "lobby"), { t: "lobby", gameVersion: 1, ready: true, pool: 0, queued: false, held: false, matches: [], links: [], asks: [], rejoin: null });
  r.queue("ann", "ben");
  r.run(POOL_WAIT_MS - 200);
  assert.equal(r.of("ann", "found").length, 0); // waits a little for more players
  r.run(300);
  const found = r.last("ann", "found")!;
  assert.equal(found.readyMs, READY_MS);
  assert.equal(found.roster.length, 2);
  assert.equal(found.npc, null);
  assert.notEqual(found.roster[0].team, found.roster[1].team);
  assert.equal(r.last("ben", "found")!.matchId, found.matchId);
  assert.equal(r.last("ann", "lobby")!.queued, true);
  r.run(READY_MS - 500);
  assert.equal(r.of("ann", "start").length, 0);
  r.run(600);
  const start = r.last("ann", "start")!;
  assert.equal(start.matchId, found.matchId);
  assert.equal(start.gameVersion, 1);
  assert.deepEqual(start.spawn, start.you.team === 1 ? [-15, 0, 0] : [15, 0, 0]);
  assert.deepEqual(start.face, [0, 1, 0]);
  assert.equal(r.groups.get("ann"), `${W}#${found.matchId}`);
  assert.equal(r.groups.get("ben"), `${W}#${found.matchId}`);
  const rec = r.store.record(found.matchId)!;
  assert.equal(rec.setup.formed.policy, "random-balanced");
  assert.deepEqual(rec.setup.slots.map((s) => s.slot), [0, 1]);
  assert.equal(rec.endedAt, null);
  assert.deepEqual(r.chats, ["A match is forming. Step out of the ring if you can't play.", "Match started: 1 v 1. Good luck!"]);
  // Snaps arrive every tick
  r.run(300);
  assert.equal(r.of("ann", "snap").length, 4);
  // Already playing: can't queue again
  r.say("ann", { t: "queue", on: true });
  assert.equal(r.last("ann", "error")!.message, "You're already in a match.");
});

test("queueing needs the ring and a ready game; walking out of the ring leaves the pool", () => {
  const r = rig();
  r.enter("ann", "ben");
  r.pos.set("ann", { x: 104.5, y: 0, z: 0 }); // radius 2 + 1.5 slack
  r.say("ann", { t: "queue", on: true });
  assert.equal(r.last("ann", "error")!.message, "Stand in the ring to play.");
  r.pos.set("ann", { x: 103.4, y: 0, z: 0 });
  r.queue("ann");
  r.run(100);
  assert.equal(r.last("ben", "lobby")!.pool, 1);
  r.pos.set("ann", { x: 110, y: 0, z: 0 });
  r.run(6000); // after the grace for presence to catch up, the ring is checked every second
  assert.equal(r.last("ann", "lobby")!.queued, false);
  assert.equal(r.last("ben", "lobby")!.pool, 0);

  const half = rig({ lobby: null });
  half.enter("ann");
  assert.equal(half.last("ann", "lobby")!.ready, false);
  half.queue("ann");
  assert.equal(half.last("ann", "error")!.message, "This game isn't ready to play yet.");
});

test("a decline during the ready check is refilled from the pool", () => {
  const r = rig({ settings: { teams: 2, players: { min: 2, max: 2 } } });
  r.enter("ann", "ben", "cy");
  r.queue("ann", "ben", "cy");
  r.run(100); // the pool is full for a match: no waiting
  const matched = ["ann", "ben", "cy"].filter((id) => r.of(id, "found").length > 0);
  assert.equal(matched.length, 2);
  const spare = ["ann", "ben", "cy"].find((id) => !matched.includes(id))!;
  r.say(matched[0], { t: "queue", on: false });
  assert.equal(r.last(matched[0], "cancel")!.matchId, r.last(matched[1], "found")!.matchId);
  const found = r.last(spare, "found")!;
  assert.deepEqual(found.roster.map((s) => s.id).sort(), [matched[1], spare].sort());
  assert.ok(found.readyMs > 0 && found.readyMs <= READY_MS);
  r.run(READY_MS + 100);
  assert.ok(r.last(spare, "start"));
  assert.ok(r.last(matched[1], "start"));
  assert.equal(r.of(matched[0], "start").length, 0);
  assert.equal(r.store.record(found.matchId)!.setup.slots.length, 2);
});

test("a decline that leaves too few cancels the check, and the others stay in the pool", () => {
  const r = rig();
  r.enter("ann", "ben");
  r.queue("ann", "ben");
  r.run(POOL_WAIT_MS + 100);
  const id = r.last("ben", "found")!.matchId;
  r.pos.set("ann", { x: 120, y: 0, z: 0 }); // walks out of the ring
  r.run(6000);
  assert.equal(r.last("ben", "cancel")!.matchId, id);
  assert.equal(r.last("ben", "lobby")!.queued, true);
  assert.equal(r.last("ben", "lobby")!.pool, 1);
  assert.equal(r.last("ann", "lobby")!.queued, false);
  r.run(READY_MS + 5000);
  assert.equal(r.of("ben", "start").length, 0);
});

test("play now: alone in the pool, a match starts at once with NPCs in the other slots", () => {
  const r = rig();
  r.enter("ann");
  r.say("ann", { t: "play-now", level: 2 });
  const start = r.last("ann", "start")!;
  assert.equal(start.roster.length, 4);
  assert.deepEqual(start.roster.filter((s) => s.kind === "npc").map((s) => [s.name, s.npc!.level]), [["Bolt", 2], ["Bolt 2", 2], ["Bolt 3", 2]]); // one roster NPC used three times: numbered
  assert.deepEqual([1, 2].map((team) => start.roster.filter((s) => s.team === team).length), [2, 2]);
  const rec = r.store.record(start.matchId)!;
  assert.equal(rec.setup.formed.policy, "play-now");
  r.run(300);
  // NPC bodies are in the snaps and in the record, moved by the server
  const snap = r.last("ann", "snap")!;
  assert.deepEqual(snap.players.filter((p) => p.slot !== start.you.slot).map((p) => p.x), [3, 3, 3]);
  r.run(5000);
  const frames = r.store.record(start.matchId)!.frames;
  assert.ok(frames.length >= 40);
  assert.deepEqual(frames[0].t, 1); // a frame is named by the tick its step produced
  assert.equal(unpackSamples(frames[0].s).length, 4); // the human is held at their spawn until presence catches up
  assert.deepEqual(unpackSamples(frames[0].s).find((s) => s.slot === start.you.slot), { slot: start.you.slot, x: start.spawn[0], y: start.spawn[1], z: start.spawn[2] });

  // Not alone: no
  const two = rig();
  two.enter("ann", "ben");
  two.queue("ben");
  two.say("ann", { t: "play-now", level: 2 });
  assert.match(two.last("ann", "error")!.message, /Others are waiting/);
  // The game doesn't allow it: no
  const none = rig({ npc: { fill: false } });
  none.enter("ann");
  none.say("ann", { t: "play-now", level: 2 });
  assert.match(none.last("ann", "error")!.message, /no NPC players/);
});

test("NPC fill in a ready check needs everyone's yes", () => {
  const r = rig();
  r.enter("ann", "ben");
  r.queue("ann", "ben");
  r.run(POOL_WAIT_MS + 100);
  r.say("ann", { t: "npc-propose", level: 9 });
  assert.deepEqual(r.last("ben", "found")!.npc, { level: 5, by: "ann", votes: 1, needed: 2 });
  r.say("ben", { t: "npc-vote", yes: false });
  assert.equal(r.last("ann", "found")!.npc, null);
  r.say("ben", { t: "npc-propose", level: 4 });
  r.say("ann", { t: "npc-vote", yes: true });
  assert.deepEqual(r.last("ann", "found")!.npc, { level: 4, by: "ben", votes: 2, needed: 2 });
  r.run(READY_MS);
  const start = r.last("ann", "start")!;
  assert.equal(start.roster.length, 4);
  assert.deepEqual(start.roster.map((s) => s.kind), ["human", "human", "npc", "npc"]);
  assert.deepEqual(start.roster.map((s) => s.slot), [0, 1, 2, 3]);

  // Without everyone's yes, no NPCs
  const no = rig();
  no.enter("ann", "ben");
  no.queue("ann", "ben");
  no.run(POOL_WAIT_MS + 100);
  no.say("ann", { t: "npc-propose", level: 3 });
  no.run(READY_MS);
  assert.equal(no.last("ann", "start")!.roster.length, 2);
});

test("the host holds and releases the queue, and starts early with whoever is there", () => {
  const r = rig();
  r.enter("owner", "ann", "ben");
  r.pos.set("owner", { x: 105, y: 0, z: 5 }); // in the lobby, not in the ring
  r.say("ann", { t: "host", cmd: "hold" });
  assert.match(r.last("ann", "error")!.message, /creator and builders/);
  r.say("owner", { t: "host", cmd: "hold" });
  r.queue("ann", "ben");
  r.run(POOL_WAIT_MS + 3000);
  assert.equal(r.of("ann", "found").length, 0);
  assert.equal(r.last("ann", "lobby")!.held, true);
  r.say("owner", { t: "host", cmd: "release" });
  r.run(POOL_WAIT_MS + 100);
  assert.ok(r.last("ann", "found"));
  // Start early: the ready check locks now
  r.say("owner", { t: "host", cmd: "start" });
  r.run(100);
  assert.ok(r.last("ann", "start"));

  // Below the minimum: the host starts with one player, NPCs make up the numbers
  const one = rig();
  one.enter("owner", "ann");
  one.pos.set("owner", { x: 105, y: 0, z: 5 });
  one.say("owner", { t: "host", cmd: "start" });
  assert.match(one.last("owner", "error")!.message, /Nobody is in the ring/);
  one.queue("ann");
  one.say("owner", { t: "host", cmd: "start" });
  const start = one.last("ann", "start")!;
  assert.deepEqual(start.roster.map((s) => [s.kind, s.team]), [["human", start.you.team], ["npc", start.you.team === 1 ? 2 : 1]]);
  assert.equal(one.store.record(start.matchId)!.setup.formed.policy, "host-start");
  // And ends it
  one.run(500);
  one.say("ann", { t: "host-end", matchId: start.matchId });
  one.run(200);
  assert.equal(one.of("ann", "end").length, 0);
  one.say("owner", { t: "host-end", matchId: start.matchId });
  one.run(200);
  assert.equal(one.last("ann", "end")!.result.why, "host");
  assert.deepEqual(one.store.record(start.matchId)!.frames.at(-1)!.c, [{ type: "host-end" }]);
});

test("a dropped player's slot is held by an NPC until they rejoin", () => {
  const r = rig();
  const id = r.play("ann", "ben");
  const slot = r.last("ben", "start")!.you.slot;
  r.pos.set("ben", { x: 7, y: 0, z: 7 });
  r.run(200);
  r.on.delete("ben");
  r.host.left(W, "ben");
  r.run(DROP_GRACE_MS - 500);
  assert.equal(r.groups.get("ben"), `${W}#${id}`); // still theirs during the grace period
  r.run(700);
  assert.equal(r.groups.get("ben"), null);
  r.run(1000);
  // The NPC started where ben last was and walks on
  const held = r.last("ann", "snap")!.players.find((p) => p.slot === slot)!;
  assert.ok(held.x > 7 && held.z === 7);
  assert.ok(r.of("ann", "snap").some((s) => s.events.some((e) => e.type === "swap" && e.slot === slot && e.value === 1)));
  // Back in the world: the lobby offers the slot
  r.on.add("ben");
  r.pos.set("ben", { ...RING });
  r.say("ben", { t: "hello" });
  assert.equal(r.last("ben", "lobby")!.rejoin, id);
  assert.equal(r.last("ann", "lobby"), r.of("ann", "lobby").at(-1)); // (ann is in the match: no lobby traffic for her)
  const npcAt = r.last("ann", "snap")!.players.find((p) => p.slot === slot)!;
  r.say("ben", { t: "rejoin", matchId: id });
  assert.equal(r.groups.get("ben"), `${W}#${id}`);
  assert.equal(r.last("ben", "start")!.you.slot, slot);
  const move = r.last("ben", "move")!;
  assert.equal(move.why, "rejoin");
  assert.deepEqual(move.to, [npcAt.x, npcAt.y, npcAt.z]);
  r.run(300);
  // Until ben's presence arrives there, the referee sees him where he was put
  assert.deepEqual(r.last("ann", "snap")!.players.find((p) => p.slot === slot), { slot, x: npcAt.x, y: npcAt.y, z: npcAt.z });
  r.pos.set("ben", { x: npcAt.x + 1, y: npcAt.y, z: npcAt.z });
  r.run(100);
  assert.equal(r.last("ben", "snap")!.players.find((p) => p.slot === slot)!.x, npcAt.x + 1);
  r.run(5000);
  const controls = r.store.record(id)!.frames.flatMap((f) => f.c ?? []);
  assert.deepEqual(controls, [{ type: "swap", slot, to: "npc" }, { type: "swap", slot, to: "human" }]);
  assert.equal(r.last("ben", "lobby")!.rejoin, id); // (sent before rejoining; nothing newer while in the match)
});

test("without `hold` a dropped slot just stops, and can still be rejoined", () => {
  const r = rig({ npc: { hold: false } });
  const id = r.play("ann", "ben");
  const slot = r.last("ben", "start")!.you.slot;
  r.on.delete("ben");
  r.run(DROP_GRACE_MS + 2000);
  r.run(5000);
  const rec = r.store.record(id)!;
  assert.deepEqual(rec.frames.flatMap((f) => f.c ?? []), []);
  assert.ok(!unpackSamples(rec.frames.at(-1)!.s).some((s) => s.slot === slot));
  r.on.add("ben");
  r.say("ben", { t: "hello" });
  assert.equal(r.last("ben", "lobby")!.rejoin, id);
  r.say("ben", { t: "rejoin", matchId: id });
  assert.equal(r.last("ben", "move")!.why, "rejoin");
  assert.equal(r.groups.get("ben"), `${W}#${id}`);
});

test("leaving a match is for good: back to the lobby, no awe", () => {
  const r = rig();
  const id = r.play("ann", "ben");
  const slot = r.last("ann", "start")!.you.slot;
  r.say("ann", { t: "leave" });
  assert.deepEqual(r.last("ann", "back"), { t: "back", to: ARRIVAL });
  assert.equal(r.groups.get("ann"), null);
  const snaps = r.of("ann", "snap").length;
  r.run(300);
  assert.equal(r.of("ann", "snap").length, snaps);
  assert.equal(r.last("ann", "lobby")!.rejoin, null);
  r.say("ann", { t: "rejoin", matchId: id });
  assert.equal(r.last("ann", "error")!.message, "That match is over.");
  r.pos.set("ben", { x: 0, y: 0, z: 500 });
  r.run(100);
  assert.deepEqual(r.awes.map((a) => a.id), ["ben"]);
  assert.deepEqual(r.store.record(id)!.frames.flatMap((f) => f.c ?? []), [{ type: "leave", slot }]);
  assert.equal(r.store.record(id)!.result!.players[slot].left, true);
});

test("a match with no human in it ends after a while", () => {
  const r = rig({ npc: { hold: false } });
  const id = r.play("ann", "ben");
  r.on.delete("ann");
  r.on.delete("ben");
  r.host.left(W, "ann");
  r.host.left(W, "ben");
  r.run(EMPTY_MATCH_MS - 500);
  assert.equal(r.store.record(id)!.endedAt, null);
  r.run(700);
  const rec = r.store.record(id)!;
  assert.notEqual(rec.endedAt, null);
  assert.equal(rec.result!.winner, 0);
  assert.deepEqual(rec.frames.at(-1)!.c, [{ type: "host-end" }]);
  assert.deepEqual(r.awes, []);
  assert.deepEqual(r.host.stats(), { lobbies: 1, matches: 0, pooled: 0 });
  r.run(2000);
  assert.deepEqual(r.host.stats(), { lobbies: 0, matches: 0, pooled: 0 });
});

test("the end: recorded and verified, awe once, play again together, back to the lobby", () => {
  const r = rig();
  const id = r.play("ann", "ben", "cy", "dee");
  const team = (p: string) => r.last(p, "start")!.you.team;
  const winners = ["ann", "ben", "cy", "dee"].filter((p) => team(p) === team("ann"));
  const losers = ["ann", "ben", "cy", "dee"].filter((p) => team(p) !== team("ann"));
  assert.deepEqual([winners.length, losers.length], [2, 2]);
  r.pos.set("ann", { x: 0, y: 0, z: 500 });
  r.run(100);
  const end = r.last("ann", "end")!;
  assert.equal(end.result.winner, team("ann"));
  assert.equal(end.awe, AWE_PER_MATCH);
  assert.equal(end.again, true);
  assert.equal(r.last(losers[0], "end")!.awe, AWE_PER_MATCH); // winners get nothing extra
  assert.deepEqual(r.awes.map((a) => [a.id, a.amount, a.ref]).sort(), ["ann", "ben", "cy", "dee"].map((p) => [p, AWE_PER_MATCH, id]));
  const rec = r.store.record(id)!;
  assert.equal(rec.result!.why, "score");
  assert.ok(rec.events.some((e) => e.type === "goal"));
  assert.deepEqual(r.verified.map((v) => v.setup.matchId), [id]);
  assert.deepEqual(r.verified[0], rec);
  assert.equal(r.chats.at(-1), `Match over. ${["Red", "Blue"][team("ann") - 1]} wins!`);
  // Still together in the instance for the results
  assert.equal(r.groups.get("ann"), `${W}#${id}`);
  r.run(5000);
  assert.equal(r.awes.length, 4); // once
  assert.equal(r.of("ann", "back").length, 0);
  for (const p of winners) r.say(p, { t: "again", yes: true });
  r.say(losers[0], { t: "again", yes: true });
  r.run(1000);
  assert.equal(r.of("ann", "back").length, 0); // one answer is still missing
  r.say(losers[1], { t: "again", yes: false });
  r.run(100);
  // The winners all said yes: back in the ring, in the pool, as one unit. The others: the arrival point, not queued.
  for (const p of winners) {
    assert.deepEqual(r.last(p, "back"), { t: "back", to: [RING.x, RING.y, RING.z] });
    assert.equal(r.last(p, "lobby")!.queued, true);
  }
  for (const p of losers) {
    assert.deepEqual(r.last(p, "back"), { t: "back", to: ARRIVAL });
    assert.equal(r.last(p, "lobby")!.queued, false);
  }
  for (const p of ["ann", "ben", "cy", "dee"]) assert.equal(r.groups.get(p), null);
  const row = r.last("ann", "lobby")!.matches[0];
  assert.deepEqual({ id: row.id, phase: row.phase, winner: row.winner, players: row.players }, { id, phase: "finished", winner: team("ann"), players: 4 });
  assert.ok(row.endedAt);
  // A team alone can't play itself; with two more in the ring the next match keeps them together
  for (const p of ["ann", "ben", "cy", "dee"]) r.pos.set(p, { ...RING });
  r.run(POOL_WAIT_MS + 1000);
  assert.equal(r.of(winners[0], "found").length, 1);
  r.queue(...losers);
  r.run(POOL_WAIT_MS + 1100);
  const found = r.last(winners[0], "found")!;
  assert.equal(r.of(winners[0], "found").length, 2);
  const t2 = (p: string) => found.roster.find((s) => s.id === p)!.team;
  assert.equal(t2(winners[0]), t2(winners[1]));
  r.run(READY_MS);
  assert.deepEqual(r.store.record(found.matchId)!.setup.formed.together.map((g) => [...g].sort()), [[...winners].sort()]);
});

test("the results wait at most AGAIN_MS; unanswered means no", () => {
  const r = rig();
  r.play("ann", "ben");
  r.pos.set("ben", { x: 0, y: 0, z: 500 });
  r.run(100);
  r.say("ann", { t: "again", yes: true });
  r.run(AGAIN_MS - 500);
  assert.equal(r.of("ann", "back").length, 0);
  r.run(600);
  assert.deepEqual(r.last("ann", "back")!.to, [RING.x, RING.y, RING.z]); // a team of one that said yes
  assert.deepEqual(r.last("ben", "back")!.to, ARRIVAL);
  assert.equal(r.host.stats().matches, 0);
});

test("awe: a quarter when no other human played, and whatever the daily cap leaves", () => {
  const r = rig({}, Math.ceil(AWE_PER_MATCH / 4) + 3);
  r.enter("ann");
  for (const expected of [Math.ceil(AWE_PER_MATCH / 4), 3, 0]) {
    r.say("ann", { t: "play-now", level: 1 });
    const start = r.last("ann", "start")!;
    r.pos.set("ann", { x: start.spawn[0], y: start.spawn[1], z: start.spawn[2] });
    r.run(100);
    r.pos.set("ann", { x: 0, y: 0, z: 500 });
    r.run(100);
    assert.equal(r.last("ann", "end")!.matchId, start.matchId);
    assert.equal(r.last("ann", "end")!.awe, expected);
    r.say("ann", { t: "again", yes: false });
    r.run(100);
    r.pos.set("ann", { ...RING });
  }
  assert.deepEqual(r.awes.map((a) => a.amount), [Math.ceil(AWE_PER_MATCH / 4), 3, 0]);
});

test("watchers get the snaps and the end, and are counted", () => {
  const r = rig();
  r.enter("zed");
  const id = r.play("ann", "ben");
  r.say("zed", { t: "watch", matchId: "nope" });
  assert.equal(r.last("zed", "error")!.message, "That match is over.");
  r.say("zed", { t: "watch", matchId: id });
  r.run(1100);
  assert.equal(r.of("zed", "snap").length, 11);
  assert.equal(r.last("ann", "snap")!.watching, 1);
  const row = r.last("zed", "lobby")!.matches[0];
  assert.deepEqual({ id: row.id, phase: row.phase, players: row.players, watching: row.watching }, { id, phase: "playing", players: 2, watching: 1 });
  // Stop, then tune in again
  r.say("zed", { t: "watch", matchId: null });
  r.run(300);
  assert.equal(r.of("zed", "snap").length, 11);
  assert.equal(r.last("ann", "snap")!.watching, 0);
  r.say("zed", { t: "watch", matchId: id });
  r.pos.set("ann", { x: 0, y: 0, z: 500 });
  r.run(100);
  const end = r.last("zed", "end")!;
  assert.deepEqual([end.matchId, end.awe, end.again], [id, 0, false]);
  assert.ok(r.last("zed", "snap")!.events.some((e) => e.type === "goal"));
  assert.deepEqual(r.awes.map((a) => a.id).sort(), ["ann", "ben"]);
});

test("the referee's `return` moves the player and holds their sample there until presence arrives", () => {
  const r = rig();
  const id = r.play("ann", "ben");
  const slot = r.last("ann", "start")!.you.slot;
  r.pos.set("ann", { x: 0, y: 0, z: -500 });
  r.run(100);
  assert.deepEqual(r.last("ann", "move"), { t: "move", matchId: id, to: [1, 2, 3], face: [0, 1, 0], why: "return" });
  r.run(500);
  assert.equal(r.of("ann", "move").length, 1); // the stale presence didn't trigger it again
  assert.deepEqual(r.last("ben", "snap")!.players.find((p) => p.slot === slot), { slot, x: 1, y: 2, z: 3 });
  r.pos.set("ann", { x: 2, y: 2, z: 3 });
  r.run(100);
  assert.equal(r.last("ben", "snap")!.players.find((p) => p.slot === slot)!.x, 2);
});

test("lobby state is coalesced: at most one message a second per subscriber", () => {
  const r = rig({ settings: { teams: 2, players: { min: 4, max: 4 } } });
  r.enter("zed", "ann", "ben", "cy");
  r.run(2000);
  const before = r.of("zed", "lobby").length;
  r.queue("ann");
  r.queue("ben");
  r.run(100);
  assert.equal(r.of("zed", "lobby").length, before + 1);
  assert.equal(r.last("zed", "lobby")!.pool, 2);
  r.queue("cy");
  r.say("ann", { t: "queue", on: false });
  r.say("ben", { t: "queue", on: false });
  r.run(800);
  assert.equal(r.of("zed", "lobby").length, before + 1); // not yet
  r.run(200);
  assert.equal(r.of("zed", "lobby").length, before + 2);
  assert.equal(r.last("zed", "lobby")!.pool, 1);
  r.run(3000);
  assert.equal(r.of("zed", "lobby").length, before + 2); // nothing changed, nothing sent
});

test("links: ask, answer, play with and against; gone when either leaves", () => {
  const r = rig();
  r.enter("ann", "ben", "cy", "dee");
  r.say("ann", { t: "link", to: "ben", kind: "with" });
  r.say("cy", { t: "link", to: "ann", kind: "against" });
  r.say("ann", { t: "link", to: "nobody", kind: "with" });
  assert.equal(r.last("ann", "error")!.message, "They aren't in this lobby.");
  r.run(100);
  assert.deepEqual(r.last("ben", "lobby")!.asks, [{ from: "ann", name: "ANN", kind: "with" }]);
  r.say("ben", { t: "link-answer", from: "ann", yes: true });
  r.say("ann", { t: "link-answer", from: "cy", yes: true });
  r.run(1000);
  assert.deepEqual(r.last("ann", "lobby")!.links, [{ with: "ben", name: "BEN", kind: "with" }, { with: "cy", name: "CY", kind: "against" }]);
  assert.deepEqual(r.last("ben", "lobby")!.links, [{ with: "ann", name: "ANN", kind: "with" }]);
  assert.deepEqual(r.last("ben", "lobby")!.asks, []);
  r.queue("ann", "ben", "cy", "dee");
  r.run(100);
  const found = r.last("ann", "found")!;
  const team = (p: string) => found.roster.find((s) => s.id === p)!.team;
  assert.equal(team("ann"), team("ben"));
  assert.notEqual(team("ann"), team("cy"));
  r.run(READY_MS);
  assert.deepEqual(r.store.record(found.matchId)!.setup.formed.links, [{ a: "ann", b: "ben", kind: "with" }, { a: "cy", b: "ann", kind: "against" }]);

  const gone = rig();
  gone.enter("ann", "ben");
  gone.say("ann", { t: "link", to: "ben", kind: "with" });
  gone.say("ben", { t: "link-answer", from: "ann", yes: true });
  gone.run(1000);
  assert.equal(gone.last("ann", "lobby")!.links.length, 1);
  gone.say("ann", { t: "unlink", with: "ben" });
  gone.run(1000);
  assert.deepEqual(gone.last("ben", "lobby")!.links, []);
  gone.say("ben", { t: "link", to: "ann", kind: "against" });
  gone.say("ann", { t: "link-answer", from: "ben", yes: true });
  gone.on.delete("ben");
  gone.host.left(W, "ben");
  gone.run(1000);
  assert.deepEqual(gone.last("ann", "lobby")!.links, []);
});

test("a running match keeps its game version; the lobby moves to the new one", () => {
  const r = rig();
  r.enter("zed");
  const id = r.play("ann", "ben");
  r.setGame({ ...makeGame(), version: 2 });
  r.host.gameChanged(W);
  r.run(1000);
  assert.equal(r.last("zed", "lobby")!.gameVersion, 2);
  assert.equal(r.store.record(id)!.setup.game.version, 1);
  r.say("ann", { t: "hello" }); // a reload mid-match: told again, still version 1
  assert.equal(r.last("ann", "start")!.gameVersion, 1);
  // The game is removed: nobody can queue, the match plays on
  r.setGame(null);
  r.host.gameChanged(W);
  r.run(1000);
  assert.deepEqual([r.last("zed", "lobby")!.ready, r.last("zed", "lobby")!.gameVersion], [false, 0]);
  r.pos.set("ann", { x: 0, y: 0, z: 500 });
  r.run(100);
  assert.ok(r.last("ann", "end"));
  r.run(AGAIN_MS + 100);
  assert.deepEqual(r.last("ann", "back")!.to, ARRIVAL);
});

test("no host lines when the game has no host NPC; junk intents are ignored", () => {
  const r = rig({ npc: { host: false } });
  r.play("ann", "ben");
  assert.deepEqual(r.chats, []);
  for (const junk of [null, 5, "hello", [], {}, { t: 5 }, { t: "nope" }, { t: "queue" }, { t: "watch", matchId: 7 }, { t: "link", to: 1 }, { t: "rejoin" }, { t: "host", cmd: "explode" }]) {
    r.host.intent(W, "ann", junk);
  }
  r.host.intent(W, "offline-player", { t: "hello" });
  assert.equal(r.of("offline-player", "lobby").length, 0);
});

// ── With the real referee and the real NPC movement ──────────────────

test("real referee: a two-human race played to the end through the host verifies", () => {
  const r = rig({}, Infinity, true);
  const id = r.play("ann", "ben");
  const team = r.last("ann", "start")!.you.team;
  // Round 1 sends everyone to their spawn on tick 1, then counts down
  assert.equal(r.of("ann", "move")[0].why, "round");
  r.run(6000);
  assert.equal(r.last("ann", "snap")!.phase, "playing");
  // Ben wanders; Ann walks to the goal
  const from = r.pos.get("ann")!;
  for (let i = 1; i <= 20; i++) {
    r.pos.set("ann", { x: from.x + ((0 - from.x) * i) / 20, y: 0.5, z: (15 * i) / 20 });
    r.pos.set("ben", { x: 15, y: 0.5, z: -i / 4 });
    r.run(100);
    if (r.last("ann", "end")) break;
  }
  const end = r.last("ann", "end")!;
  assert.ok(end, "the race ended at the goal");
  assert.equal(end.result.winner, team);
  assert.equal(end.awe, AWE_PER_MATCH);
  const rec = r.store.record(id)!;
  assert.deepEqual(rec.result, end.result);
  assert.ok(rec.events.some((e) => e.type === "goal"));
  assert.ok(rec.frames.length > 60);
  assert.equal(verifyRecord(rec), true);
  // A record that was tampered with does not
  assert.equal(verifyRecord({ ...rec, result: { ...rec.result!, winner: team === 1 ? 2 : 1 } }), false);
});

test("real referee and NPCs: play now, a drop held by an NPC, a rejoin, a host end: the record still verifies", () => {
  const r = rig({}, Infinity, true);
  r.enter("owner", "ann");
  r.pos.set("owner", { x: 105, y: 0, z: 5 });
  r.say("ann", { t: "play-now", level: 3 });
  const start = r.last("ann", "start")!;
  const id = start.matchId;
  r.pos.set("ann", { x: start.spawn[0], y: start.spawn[1], z: start.spawn[2] });
  r.run(10000); // past the countdown and the NPCs' head start
  // The NPCs move on their own once play starts
  const a = r.last("ann", "snap")!;
  r.run(2000);
  const b = r.last("ann", "snap")!;
  if (!r.last("ann", "end")) {
    assert.ok(b.players.some((p, i) => p.slot !== start.you.slot && (p.x !== a.players[i].x || p.z !== a.players[i].z)), "an NPC moved");
    // The live record (for watchers) has the roster, the ticks so far and no result
    const live = r.host.record(id)!;
    assert.equal(live.result, null);
    assert.equal(live.setup.slots.length, 4);
    assert.ok(live.frames.length >= r.store.record(id)!.frames.length);
    assert.equal(live.frames.at(-1)!.t, b.tick);
    // Ann drops; an NPC holds her slot; she comes back
    r.on.delete("ann");
    r.host.left(W, "ann");
    r.run(DROP_GRACE_MS + 1000);
  }
  if (!r.store.record(id)!.endedAt) {
    r.on.add("ann");
    r.say("ann", { t: "hello" });
    assert.equal(r.last("ann", "lobby")!.rejoin, id);
    r.say("ann", { t: "rejoin", matchId: id });
    const to = r.last("ann", "move")!.to;
    r.pos.set("ann", { x: to[0], y: to[1], z: to[2] });
    r.run(1000);
    r.say("owner", { t: "host-end", matchId: id });
    r.run(200);
  }
  const rec = r.store.record(id)!;
  assert.notEqual(rec.endedAt, null);
  assert.ok(rec.result);
  assert.equal(verifyRecord(rec), true);
  assert.deepEqual(r.host.record(id), rec);
});

test("real referee: a match nobody is in any more ends through the referee and verifies", () => {
  const r = rig({ npc: { hold: false } }, Infinity, true);
  const id = r.play("ann", "ben");
  r.run(6000);
  r.on.delete("ann");
  r.on.delete("ben");
  r.run(EMPTY_MATCH_MS + 500);
  const rec = r.store.record(id)!;
  assert.equal(rec.result!.why, "host");
  assert.equal(verifyRecord(rec), true);
});

test("the 18+ door is read as the match starts: research copies carry only candidates' own traces (Q10b)", () => {
  const r = rig();
  r.adults.add("ann");
  const matchId = r.play("ann", "ben");
  // Ben opens the door mid-match: this match was already stamped
  r.adults.add("ben");
  const copy = r.store.researchCopy(matchId, (id) => r.adults.has(id))!;
  const humans = copy.setup.slots.filter((s) => s.kind === "human");
  assert.deepEqual(humans.map((s) => s.id).sort(), ["r-ann", `stand-in:${copy.setup.slots.find((s) => s.id.startsWith("stand-in:"))!.slot}`].sort());
  assert.ok(humans.every((s) => s.name === "Player"));
  // The replay itself still names both
  assert.deepEqual(r.store.record(matchId)!.setup.slots.filter((s) => s.kind === "human").map((s) => s.id).sort(), ["ann", "ben"]);
  // His next match counts
  const second = rig();
  second.adults.add("ann"); second.adults.add("ben");
  const next = second.play("ann", "ben");
  assert.deepEqual(second.store.researchCopy(next, () => true)!.setup.slots.filter((s) => s.kind === "human").map((s) => s.id).sort(), ["r-ann", "r-ben"]);
});

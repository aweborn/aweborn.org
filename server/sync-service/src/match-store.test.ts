/** Match records (Phase 10). Uses node:sqlite so it runs without native modules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MatchStore } from "./match-store.js";
import type { SqlDb } from "./build-requests.js";
import { newGame } from "../../../shared/game.js";
import type { MatchEvent, MatchFrame, MatchResult, MatchSetup } from "../../../shared/match.js";

const W = "11111111-2222-4333-8444-555555555555";
const W2 = "22222222-2222-4333-8444-555555555555";

function setup(matchId: string, worldId = W, over: Partial<MatchSetup> = {}): MatchSetup {
  return {
    matchId, worldId, game: { ...newGame("race"), version: 3 }, seed: 99, simVersion: 1,
    slots: [
      { slot: 0, team: 1, kind: "human", id: "ann", name: "Ann" },
      { slot: 1, team: 2, kind: "human", id: "ben", name: "Ben" },
      { slot: 2, team: 2, kind: "npc", id: "npc:bolt:1", name: "Bolt", npc: { rosterId: "bolt", behavior: "auto", level: 2, version: 1 } },
    ],
    formed: { policy: "random-balanced", seed: 5, links: [{ a: "ann", b: "ben", kind: "against" }], together: [["ann", "cy"]] },
    ...over,
  };
}
const result: MatchResult = { winner: 2, rounds: [0, 1], scores: [0, 1], players: [{ slot: 0, score: 0, returns: 1, left: false }, { slot: 1, score: 1, returns: 0, left: false }], ticks: 40, why: "score" };
const events: MatchEvent[] = [{ tick: 0, type: "round-start" }, { tick: 39, type: "goal", slot: 1, team: 2 }, { tick: 39, type: "match-end", why: "score" }];
const frames = (from: number, n: number): MatchFrame[] => Array.from({ length: n }, (_, i) => ({ t: from + i, s: [0, 100 + i, 0, 0, 1, -100 - i, 0, 0] }));

const fresh = () => {
  const db = new DatabaseSync(":memory:") as unknown as SqlDb;
  return { db, store: new MatchStore(db, (id) => (id === W ? "Arena World" : "Other"), 1) };
};

test("a record round-trips: setup, chunked frames in order, events, result", () => {
  const { store } = fresh();
  const s = setup("m1");
  store.begin(s, 1000, { ann: "r-ann" });
  store.appendFrames("m1", frames(0, 50));
  store.appendFrames("m1", []);
  store.appendFrames("m1", [...frames(50, 10), { t: 60, s: [], c: [{ type: "leave", slot: 0 }] }]);
  const running = store.record("m1")!;
  assert.equal(running.endedAt, null);
  assert.equal(running.result, null);
  assert.equal(running.frames.length, 61);
  store.finish("m1", events, result, 5000);
  const r = store.record("m1")!;
  assert.deepEqual(r, { v: 1, setup: s, frames: [...frames(0, 50), ...frames(50, 10), { t: 60, s: [], c: [{ type: "leave", slot: 0 }] }], events, result, startedAt: 1000, endedAt: 5000 });
  assert.deepEqual(r.frames.map((f) => f.t), Array.from({ length: 61 }, (_, i) => i));
  assert.equal(store.record("nope"), null);
});

test("summaries: a world's finished matches and a player's, newest first", () => {
  const { store } = fresh();
  store.begin(setup("m1"), 1000);
  store.finish("m1", events, result, 2000);
  store.begin(setup("m2"), 3000);
  store.finish("m2", events, { ...result, winner: 0 }, 4000);
  store.begin(setup("m3", W2, { slots: [{ slot: 0, team: 1, kind: "human", id: "cy", name: "Cy" }] }), 5000);
  store.finish("m3", [], result, 6000);
  store.begin(setup("m4"), 7000); // still running: not listed
  const world = store.worldRecent(W);
  assert.deepEqual(world.map((m) => m.id), ["m2", "m1"]);
  assert.deepEqual(world[1], {
    id: "m1", worldId: W, worldName: "Arena World", template: "race", gameVersion: 3, startedAt: 1000, endedAt: 2000, winner: 2, scores: [0, 1],
    roster: [{ slot: 0, team: 1, kind: "human", name: "Ann" }, { slot: 1, team: 2, kind: "human", name: "Ben" }, { slot: 2, team: 2, kind: "npc", name: "Bolt" }],
  });
  assert.equal(store.worldRecent(W, 1).length, 1);
  const mine = store.playerRecent(["ann", "cy"]);
  assert.deepEqual(mine.map((m) => m.id), ["m3", "m2", "m1"]);
  assert.deepEqual(mine[1].roster.map((p) => p.you ?? false), [true, false, false]);
  assert.equal(mine[0].worldName, "Other");
  assert.deepEqual(store.playerRecent([]), []);
  assert.deepEqual(store.playerRecent(["nobody"]), []);
});

test("several rounds: the list shows rounds won", () => {
  const { store } = fresh();
  const s = setup("m1");
  s.game.settings.rounds = 3;
  store.begin(s, 1000);
  store.finish("m1", [], { ...result, rounds: [2, 1], scores: [5, 0], winner: 1 }, 2000);
  assert.deepEqual(store.worldRecent(W)[0].scores, [2, 1]);
});

test("erasing a player keeps the replay and leaves an anonymous stand-in", () => {
  const { db, store } = fresh();
  store.begin(setup("m1"), 1000, { ann: "r-ann", ben: "r-ben" });
  store.appendFrames("m1", frames(0, 5));
  store.finish("m1", events, result, 2000);
  store.begin(setup("m2"), 3000, { ann: "r-ann" });
  store.finish("m2", events, result, 4000);
  assert.equal(store.erasePlayer("ann"), 2);
  assert.deepEqual(store.playerRecent(["ann"]), []);
  const r = store.record("m1")!;
  assert.deepEqual(r.setup.slots[0], { slot: 0, team: 1, kind: "human", id: "stand-in:0", name: "Player" });
  assert.equal(r.setup.slots[1].id, "ben");
  assert.deepEqual(r.setup.formed.links, [{ a: "stand-in:0", b: "ben", kind: "against" }]);
  assert.deepEqual(r.setup.formed.together, [["stand-in:0", "cy"]]);
  assert.equal(r.frames.length, 5);
  assert.deepEqual(r.result, result);
  assert.ok(!JSON.stringify(r).includes("ann"));
  const rows = db.prepare("SELECT slot, player_id, research_id, name FROM match_players WHERE match_id = 'm1' ORDER BY slot").all() as { slot: number; player_id: string | null; research_id: string | null; name: string }[];
  assert.deepEqual(rows.map((x) => ({ ...x })), [
    { slot: 0, player_id: null, research_id: null, name: "Player" },
    { slot: 1, player_id: "ben", research_id: "r-ben", name: "Ben" },
    { slot: 2, player_id: null, research_id: null, name: "Bolt" },
  ]);
  // Ben still finds it, with the stand-in in the roster
  assert.deepEqual(store.playerRecent(["ben"])[1].roster[0], { slot: 0, team: 1, kind: "human", name: "Player" });
  assert.equal(store.erasePlayer("ann"), 0);
});

test("a match the server never finished is closed on the next boot, frames kept", () => {
  const { db, store } = fresh();
  store.begin(setup("m1"), 1000);
  store.appendFrames("m1", frames(0, 50));
  store.begin(setup("m2"), 1500);
  store.finish("m2", events, result, 2000);
  const again = new MatchStore(db, () => "", 9000);
  const r = again.record("m1")!;
  assert.equal(r.endedAt, 9000);
  assert.equal(r.result, null);
  assert.deepEqual(r.events, []);
  assert.equal(r.frames.length, 50);
  assert.equal(again.record("m2")!.endedAt, 2000);
  assert.deepEqual(again.worldRecent(W).map((m) => [m.id, m.winner]), [["m2", 2], ["m1", null]]);
});

test("records are kept forever: the store has no way to delete one", () => {
  const { store } = fresh();
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
  assert.ok(!names.some((n) => /delete|remove|purge|drop/i.test(n)));
});

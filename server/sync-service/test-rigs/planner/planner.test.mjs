/**
 * The real planner.ts, end to end, with no native modules (2026-11-08): node:sqlite stands
 * in for better-sqlite3, and the model, safety check, job runner and research ids are fakes
 * (mocks/, wired by hooks.mjs). Covers one growing plan per world: seeding from an old
 * session, the planner's anonymous view of the world, additive merges, who may change
 * what, undo, and Make skipping what's already made.
 *
 * Not part of `npm test` (it needs Node 22+'s node:sqlite and loader hooks). Run from
 * server/sync-service:
 *   node --import ./test-rigs/planner/register.mjs --import tsx --test test-rigs/planner/planner.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "./mocks/persistence.mjs";
const P = await import("../../src/planner.ts");

const W = "11111111-2222-4333-8444-555555555555";
const grass = { id: "grass", name: "Grass", color: "#55aa55", surface: "smooth" };
const hill = { type: "hill", at: [100, 0, 100], radius: 20, height: 6, block: "grass" };
const isle = { type: "floating-island", at: [160, 10, 160], radius: 8, block: "grass" };
const terrain = { kind: "voxel", size: [320, 16, 320], seed: 7, blocks: [grass], features: [hill] };
const asset = (key, prompt = `a ${key}`) => ({ key, kind: "model", prompt, quality: "quick", at: [10, 0, 10] });
const music = { key: "world-music", kind: "music", prompt: "slow piano", quality: "quick" };
const bp = (assets, features = [hill]) => ({ name: "The Drift", style: { artDirection: "misty", palette: [], lighting: "dusk" }, terrain: { ...terrain, features }, assets: [...assets, music] });

// The world: ground with the hill, and the old plan's "roots" placed by someone
const worldState = { terrain, objects: [
  { type: "model", prompt: "hanging roots", planKey: "old-sess:roots", x: 5, z: 6, placedBy: "player-ALICE" },
  { type: "block", x: 1, z: 1, placedBy: "player-ALICE" },
] };
const rooms = {
  admission: { requestDraw: () => ({ ok: true, remainingToday: 999 }) },
  mana: { settle() {}, release() {} },
  readWorldState: (id) => (id === W ? worldState : null),
  isWorldOwner: () => true,
  setWorldMusic: () => true,
  lookupWorld: () => ({ music: globalThis.__music ?? null }),
  progress: { playerProgress: () => ({}) },
};
P.hookWorldMusic(rooms);

// A world planned before plans grew: an old session by Alice
const db = getDb();
P.planResume("player-NOBODY", W, () => {}); // creates the tables
const old = { ...bp([asset("roots", "hanging roots"), asset("shrine")]), id: "old-sess", version: 3, worldId: W, estimate: { items: [], planner: 0, total: 0 } };
db.prepare("INSERT INTO plan_sessions (id, player_id, world_id, version, blueprint, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").run("old-sess", "player-ALICE", W, 3, JSON.stringify(old), 1, 2);
db.prepare("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?,?,?,?)").run("old-sess", "user", JSON.stringify({ message: "roots hanging from the clouds" }), 1);
db.prepare("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?,?,?,?)").run("old-sess", "turn", JSON.stringify({ reply: "Roots it is, drifting down.", chips: [] }), 2);
db.prepare("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?,?,?,?)").run("old-sess", "user", JSON.stringify({ message: "something rude" }), 3);
db.prepare("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?,?,?,?)").run("old-sess", "blocked", JSON.stringify({ reply: "no" }), 4);

let lastMessages = null;
let nextTurn = null;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  lastMessages = body.messages;
  return new Response(JSON.stringify({ content: JSON.stringify(nextTurn), model: body.model, costUsd: 0.01 }), { status: 200 });
};
const call = (fn) => new Promise((res) => fn((status, body) => res({ status, body })));

test("someone new sees the world's plan before saying anything", async () => {
  const r = await call((json) => P.planResume("player-BOB", W, json));
  assert.equal(r.body.session, null);
  assert.equal(r.body.worldPlan.id, "old-sess");
  assert.deepEqual(r.body.worldPlan.assets.map((a) => a.key), ["roots", "shrine", "world-music"]);
});

let bobSession;
test("a turn sees the whole world anonymously and only adds", async () => {
  // The planner forgets roots (made) and the hill (in the ground), and adds a lantern + an island
  nextTurn = { reply: "A lantern by the shrine.", chips: ["More light"], blueprint: bp([asset("shrine"), asset("lantern")], [isle]) };
  const r = await call((json) => P.planTurn(rooms, "player-BOB", { worldId: W, message: "add a lantern" }, json));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  bobSession = r.body.sessionId;
  const sys = lastMessages[0].content;
  assert.match(sys, /THE WORLD AS IT IS/);
  assert.match(sys, /model at \(5, 6\): hanging roots/);
  assert.match(sys, /1 block/);
  assert.match(sys, /player: roots hanging from the clouds/);
  assert.doesNotMatch(sys, /something rude/, "refused requests never become context");
  assert.doesNotMatch(sys, /ALICE|BOB|player-/, "no player ids or names");
  assert.match(sys, /THE PLAN \(planned, not made yet\)/);
  assert.doesNotMatch(sys.split("THE PLAN")[1], /"roots"/, "made things aren't in the editable plan");
  const b = r.body.blueprint;
  assert.equal(b.id, "old-sess");
  assert.deepEqual(b.assets.map((a) => a.key).sort(), ["lantern", "roots", "shrine", "world-music"]);
  assert.match(sys, /Planned by others, not made yet[\s\S]*model shrine/, "Alice's planned shrine is shown read-only");
  assert.deepEqual(b.terrain.features.map((f) => f.type), ["hill", "floating-island"]);
});

test("Alice's old session continues from the grown plan", async () => {
  nextTurn = { reply: "A bridge.", chips: [], blueprint: bp([asset("shrine"), asset("lantern"), asset("bridge")], [isle]) };
  const r = await call((json) => P.planTurn(rooms, "player-ALICE", { sessionId: "old-sess", worldId: W, message: "a bridge" }, json));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.blueprint.assets.map((a) => a.key).sort(), ["bridge", "lantern", "roots", "shrine", "world-music"]);
  assert.match(lastMessages[0].content, /player: add a lantern/, "Bob's words, anonymous");
});

test("a hand edit can't touch what's already made", async () => {
  const resume = await call((json) => P.planResume("player-BOB", W, json));
  const base = resume.body.session.version;
  const r = await call((json) => P.planEdit(rooms, "player-BOB", { sessionId: bobSession, base, edit: { op: "remove", key: "roots" } }, json));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "made");
  const theirs = await call((json) => P.planEdit(rooms, "player-BOB", { sessionId: bobSession, base, edit: { op: "remove", key: "shrine" } }, json));
  assert.equal(theirs.status, 409);
  assert.equal(theirs.body.error, "not_yours");
  const ok = await call((json) => P.planEdit(rooms, "player-BOB", { sessionId: bobSession, base, edit: { op: "remove", key: "lantern" } }, json));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.blueprint.assets.map((a) => a.key).sort(), ["bridge", "roots", "shrine", "world-music"]);
});

test("undo brings back an earlier version but keeps Alice's bridge and the made roots", async () => {
  const r = await call((json) => P.planRestore("player-BOB", { sessionId: bobSession, version: 1 }, json));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.blueprint.assets.map((a) => a.key).sort(), ["bridge", "lantern", "roots", "shrine", "world-music"]);
});

test("Make models makes what's planned (anyone's), never what's already made", async () => {
  const r = await call((json) => P.planManifest(rooms, "player-BOB", { sessionId: bobSession }, json, "acct-bob"));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const made = r.body.items.filter((i) => i.jobId).map((i) => i.key).sort();
  assert.ok(!made.includes("roots"), "already in the world");
  assert.ok(made.includes("bridge") && made.includes("shrine"), JSON.stringify(r.body.items));
  const v = await call((json) => P.planVersions("player-BOB", bobSession, json));
  assert.equal(v.status, 200);
  assert.ok(v.body.versions.length >= 3);
});

test("the world's music isn't made again once the world has some", async () => {
  globalThis.__music = "abc.mp3";
  const r = await call((json) => P.planManifest(rooms, "player-BOB", { sessionId: bobSession }, json, "acct-bob"));
  assert.equal(r.status, 200);
  assert.ok(!r.body.items.some((i) => i.key === "world-music"), JSON.stringify(r.body.items));
});

test("the first plan in an empty world becomes its world plan", async () => {
  const W2 = "22222222-2222-4333-8444-555555555555";
  nextTurn = { reply: "A quiet meadow.", chips: [], blueprint: bp([asset("tree")], [hill]) };
  const r = await call((json) => P.planTurn(rooms, "player-CARA", { worldId: W2, message: "a meadow" }, json));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.blueprint.id, r.body.sessionId);
  assert.match(lastMessages[0].content, /No ground yet/);
  const other = await call((json) => P.planResume("player-DAN", W2, json));
  assert.deepEqual(other.body.worldPlan.assets.map((a) => a.key).sort(), ["tree", "world-music"]);
});

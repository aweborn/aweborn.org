import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { researchIdFor, isResearchId, playerForResearchId, forgetPlayer } from "./research.js";

function planDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE plan_sessions (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, blueprint TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, research_id TEXT);
    CREATE TABLE plan_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, kind TEXT NOT NULL,
      ref TEXT, model TEXT, cost_mana REAL, version INTEGER, payload TEXT NOT NULL, at INTEGER NOT NULL);`);
  return db;
}

test("a player's research id is stable, well-formed and not their player id", () => {
  const db = new Database(":memory:");
  const a = researchIdFor("player-a", db);
  assert.ok(isResearchId(a));
  assert.equal(researchIdFor("player-a", db), a);
  assert.notEqual(researchIdFor("player-b", db), a);
  assert.ok(!a.includes("player"));
  assert.equal(playerForResearchId(a, db), "player-a");
  assert.equal(playerForResearchId("r00000000000000000000", db), null);
});

test("isResearchId rejects anything else", () => {
  for (const bad of ["", "r123", "R0123456789abcdef0123", "r0123456789abcdef012g", "player-a", 42, null]) assert.equal(isResearchId(bad), false);
});

test("forgetPlayer deletes their planner history and the link, and nobody else's", () => {
  const db = planDb();
  const a = researchIdFor("player-a", db);
  researchIdFor("player-b", db);
  const ins = db.prepare("INSERT INTO plan_sessions (id, player_id, world_id, created_at, updated_at, research_id) VALUES (?, ?, 'w', 0, 0, ?)");
  ins.run("s1", "player-a", a);
  ins.run("s2", "player-b", null);
  const ev = db.prepare("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?, 'user', '{}', 0)");
  ev.run("s1"); ev.run("s1"); ev.run("s2");

  assert.deepEqual(forgetPlayer("player-a", db), { sessions: 1, events: 2, researchId: a });
  assert.equal(playerForResearchId(a, db), null);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM plan_events").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM plan_sessions").get() as { n: number }).n, 1);
  // Coming back later is a new research id: the old archive records stay untied
  assert.notEqual(researchIdFor("player-a", db), a);
});

test("forgetPlayer works before any planning tables exist", () => {
  const db = new Database(":memory:");
  researchIdFor("player-a", db);
  assert.deepEqual(forgetPlayer("player-a", db).sessions, 0);
});

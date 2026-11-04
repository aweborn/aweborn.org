import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildMakingOf } from "./making-of.js";
import { hasMakingOf } from "../../../shared/making-of.js";

function planDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE plan_sessions (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, blueprint TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, research_id TEXT);
    CREATE TABLE plan_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, kind TEXT NOT NULL,
      ref TEXT, model TEXT, cost_mana REAL, version INTEGER, payload TEXT NOT NULL, at INTEGER NOT NULL);`);
  return db;
}

const names = (ids: string[]) => Object.fromEntries(ids.filter((i) => i === "p-alex").map((i) => [i, "Alex"]));

function session(db: Database.Database, id: string, player: string, world: string, at: number, events: [string, Record<string, unknown>, { model?: string; version?: number }?][]) {
  db.prepare("INSERT INTO plan_sessions (id, player_id, world_id, version, blueprint, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)")
    .run(id, player, world, JSON.stringify({ name: "Moss Hill" }), at, at);
  const ev = db.prepare("INSERT INTO plan_events (session_id, kind, ref, model, cost_mana, version, payload, at) VALUES (?, ?, 'r', ?, 1, ?, ?, ?)");
  events.forEach(([kind, payload, x], i) => ev.run(id, kind, x?.model ?? null, x?.version ?? null, JSON.stringify(payload), at + i));
}

test("the world's planner history reads like the conversation, refusals and raw calls left out", () => {
  const db = planDb();
  session(db, "s1", "p-alex", "w1", 100, [
    ["user", { message: "a mossy   hill\nat dusk" }],
    ["llm_call", { messages: ["secret prompt"], response: "{...}" }, { model: "anthropic/claude-opus-5.5" }],
    ["turn", { reply: "A hill, soft with moss. What grows on it?", chips: ["lanterns", "old trees"], blueprint: { assets: [] } }, { model: "anthropic/claude-opus-5.5", version: 1 }],
    ["user", { message: "something not allowed" }],
    ["blocked", { category: "x", reply: "I can't make that one here." }],
    ["edit", { label: "removed old-bench", blueprint: {} }, { version: 2 }],
    ["restore", { from: 1, blueprint: {} }, { version: 3 }],
    ["manifest", { version: 3, items: [{ key: "a", jobId: "j1" }, { key: "b", error: "later" }, { key: "c", jobId: "j2" }] }, { version: 3 }],
    ["redo", { key: "moon-bridge", note: "darker wood", jobId: "j3" }, { version: 3 }],
  ]);
  const m = buildMakingOf(db, "w1", names);
  assert.equal(m.sessions.length, 1);
  const s = m.sessions[0];
  assert.equal(s.by, "Alex");
  assert.equal(s.plan, "Moss Hill");
  assert.deepEqual(s.entries.map((e) => e.kind), ["player", "planner", "note", "note", "note", "note"]);
  assert.equal(s.entries[0].text, "a mossy hill at dusk");
  const p = s.entries[1];
  assert.ok(p.kind === "planner" && p.model === "claude-opus-5.5" && p.version === 1 && p.chips.length === 2);
  assert.deepEqual(s.entries.slice(2).map((e) => e.text), [
    "removed old bench", "went back to version 1", "manifested: 2 things began to take shape", "remade moon bridge: “darker wood”",
  ]);
  const json = JSON.stringify(m);
  assert.ok(!json.includes("secret prompt") && !json.includes("not allowed") && !json.includes("p-alex"));
  assert.ok(hasMakingOf(m));
});

test("oldest conversation first, any author; unanswered ones and other worlds are skipped; words masked", () => {
  const db = planDb();
  session(db, "late", "p-alex", "w1", 300, [["user", { message: "add a pond" }], ["turn", { reply: "A small pond.", chips: [] }, { version: 2 }]]);
  session(db, "early", "p-guest", "w1", 200, [["user", { message: "what the shit" }], ["turn", { reply: "Here.", chips: [] }, { version: 1 }]]);
  session(db, "silent", "p-alex", "w1", 250, [["user", { message: "hello?" }], ["llm_error", { error: "down" }]]);
  session(db, "elsewhere", "p-alex", "w2", 150, [["user", { message: "x" }], ["turn", { reply: "y", chips: [] }, { version: 1 }]]);
  const m = buildMakingOf(db, "w1", names);
  assert.deepEqual(m.sessions.map((s) => s.id), ["early", "late"]);
  assert.equal(m.sessions[0].by, "A traveler");
  assert.equal(m.sessions[0].entries[0].text, "what the ****");
});

test("no planner tables yet → an empty history, not an error", () => {
  const m = buildMakingOf(new Database(":memory:"), "w1", names);
  assert.deepEqual(m, { worldId: "w1", sessions: [] });
  assert.equal(hasMakingOf(m), false);
});


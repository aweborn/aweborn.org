import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { parsePlannerTurn, applyEdit, type BlueprintDraft } from "../../../shared/blueprint.js";
import { replayResearch, exportResearch, canonical, terrainHash } from "./replay.js";
import { researchIdFor } from "./research.js";

function planDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE plan_sessions (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0, blueprint TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, research_id TEXT);
    CREATE TABLE plan_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, kind TEXT NOT NULL,
      ref TEXT, model TEXT, cost_mana REAL, version INTEGER, payload TEXT NOT NULL, at INTEGER NOT NULL);`);
  return db;
}

const ANSWER = JSON.stringify({
  reply: "A mossy hill with a lantern.",
  chips: ["add a pond"],
  blueprint: {
    name: "Moss Hill",
    style: { artDirection: "soft storybook", palette: ["#88aa66"] },
    terrain: { size: [64, 16, 64], seed: 7, blocks: [{ id: "grass", name: "Grass", color: "#6a9f4b", surface: "smooth" }, { id: "stone", name: "Stone", color: "#888888" }], features: [{ type: "hill", at: [32, 0, 32], radius: 8, height: 5, block: "grass" }] },
    assets: [{ key: "lantern", kind: "model", prompt: "a brass lantern" }, { key: "bench", kind: "model", prompt: "a wooden bench" }],
  },
});

/** A session the way planner.ts logs it: request, raw answer, turn, edit, reworded redo, restore. */
function seed(db: Database.Database, player: string, opts: { researchId?: string | null; tamper?: boolean } = {}) {
  const sid = randomUUID(); // like planner.ts: nothing about the player in it
  const stamp = (d: BlueprintDraft, version: number) => ({ ...d, id: sid, version, worldId: "world-secret", estimate: { items: [], planner: 10, total: 10 } });
  db.prepare("INSERT INTO plan_sessions (id, player_id, world_id, created_at, updated_at, research_id) VALUES (?, ?, 'world-secret', 1, 1, ?)")
    .run(sid, player, opts.researchId === undefined ? researchIdFor(player, db) : opts.researchId);
  const ev = db.prepare("INSERT INTO plan_events (session_id, kind, ref, model, cost_mana, version, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?, 2)");
  const v1 = (parsePlannerTurn(JSON.parse(ANSWER)) as { value: { blueprint: BlueprintDraft } }).value.blueprint;
  ev.run(sid, "user", "plan:1", null, null, null, JSON.stringify({ message: "a mossy hill" }));
  ev.run(sid, "llm_call", "plan:1", "m/x", 1.5, null, JSON.stringify({ response: `Sure!\n${ANSWER}` }));
  ev.run(sid, "turn", "plan:1", "m/x", 2, 1, JSON.stringify({ reply: "ok", blueprint: stamp(v1, 1) }));
  const v2 = (applyEdit(v1, { op: "size", key: "lantern", factor: 2 }) as { value: BlueprintDraft }).value;
  const saved2 = opts.tamper ? { ...v2, name: "Changed by hand in the DB" } : v2;
  ev.run(sid, "edit", null, null, null, 2, JSON.stringify({ edit: { op: "size", key: "lantern", factor: 2 }, label: "lantern bigger", blueprint: stamp(saved2, 2) }));
  const v3 = (applyEdit(saved2, { op: "prompt", key: "bench", prompt: "a stone bench" }) as { value: BlueprintDraft }).value;
  ev.run(sid, "edit", null, null, null, 3, JSON.stringify({ key: "bench", note: "stone", prompt: "a stone bench", blueprint: stamp(v3, 3) }));
  ev.run(sid, "manifest", null, null, null, 3, JSON.stringify({ version: 3, items: [] }));
  ev.run(sid, "restore", null, null, null, 4, JSON.stringify({ from: 1, blueprint: stamp(v1, 4) }));
  return sid;
}

test("canonical ignores key order and undefined", () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: undefined } }), canonical({ a: { d: 2 }, b: 1 }));
});

test("a clean history replays with no mismatches", () => {
  const db = planDb();
  seed(db, "player-a");
  const r = replayResearch(db, researchIdFor("player-a", db));
  assert.deepEqual(r.mismatches, []);
  assert.equal(r.sessions.length, 1);
  const s = r.sessions[0];
  assert.deepEqual([s.turns, s.edits, s.restores], [1, 2, 1]);
  assert.deepEqual(s.versions.map((v) => v.version), [1, 2, 3, 4]);
  assert.equal(s.costMana, 2); // the turn's total; the llm_call inside it isn't counted twice
  // Terrain never changed across the versions, and is a real hash
  assert.equal(new Set(s.versions.map((v) => v.terrainHash)).size, 1);
  assert.match(s.versions[0].terrainHash, /^[0-9a-f]{16}$/);
  assert.ok(r.checked >= 8);
});

test("a saved version that doesn't follow from its inputs is reported", () => {
  const db = planDb();
  seed(db, "player-a", { tamper: true });
  const r = replayResearch(db, researchIdFor("player-a", db));
  assert.equal(r.mismatches.length, 1);
  assert.equal(r.mismatches[0].check, "edit");
  assert.equal(r.mismatches[0].version, 2);
});

test("terrain hash is deterministic and changes with the seed", () => {
  const t = (parsePlannerTurn(JSON.parse(ANSWER)) as { value: { blueprint: BlueprintDraft } }).value.blueprint.terrain;
  assert.equal(terrainHash(t), terrainHash(structuredClone(t)));
  assert.notEqual(terrainHash(t), terrainHash({ ...t, seed: 8 }));
});

test("export is keyed by research id, never the player or world id, and stamps old sessions", () => {
  const db = planDb();
  seed(db, "player-a");
  seed(db, "player-b", { researchId: null }); // saved before research ids existed
  const lines: string[] = [];
  assert.equal(exportResearch(db, (l) => lines.push(l)), 2);
  const text = lines.join("\n");
  assert.ok(!text.includes("player-a") && !text.includes("player-b"), "no player ids");
  assert.ok(!text.includes("world-secret"), "no world ids");
  const rows = lines.map((l) => JSON.parse(l) as { researchId: string; replay: { mismatches: unknown[] } });
  assert.deepEqual(rows.map((r) => r.researchId).sort(), [researchIdFor("player-a", db), researchIdFor("player-b", db)].sort());
  for (const r of rows) assert.deepEqual(r.replay.mismatches, []);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM plan_sessions WHERE research_id IS NULL").get() as { n: number }).n, 0);
  // Only the asked-for research id
  const one: string[] = [];
  assert.equal(exportResearch(db, (l) => one.push(l), [researchIdFor("player-b", db)]), 1);
});

test("a DB from before the research_id column: replay reads it, export adds the column", () => {
  const db = planDb();
  seed(db, "player-a", { researchId: null });
  db.exec("ALTER TABLE plan_sessions DROP COLUMN research_id");
  const id = researchIdFor("player-a", db);
  const r = replayResearch(db, id);
  assert.equal(r.sessions.length, 1);
  assert.deepEqual(r.mismatches, []);
  assert.equal(exportResearch(db, () => {}), 1);
  assert.equal((db.prepare("SELECT research_id FROM plan_sessions").get() as { research_id: string }).research_id, id);
});

test("no planning tables: empty report, nothing exported", () => {
  const db = new Database(":memory:");
  assert.deepEqual(replayResearch(db, "r00000000000000000000").sessions, []);
  assert.equal(exportResearch(db, () => {}), 0);
});

/**
 * Progress tests (Rough Draft M3). Run: npm test (node --test via tsx), in-memory SQLite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Progress } from "./progress.js";
import { SKILLS, XP, masteryUses } from "../../../shared/progress.js";

const fresh = (worlds = 10) => {
  let t = 1_000_000;
  const db = new Database(":memory:");
  const p = new Progress(db, () => worlds, () => t);
  return { db, p, tick: (ms: number) => (t += ms) };
};

test("a new character starts at chapter 1; flying + steering opens chapter 2", () => {
  const { p } = fresh();
  assert.equal(p.view("c1").chapter, 1);
  assert.deepEqual(p.playerProgress("c1"), { chapter: 1, warpUnlocked: false, levelsSinceWarp: 0 });
  p.useSkill("c1", "move");
  const d = p.useSkill("c1", "steer");
  assert.equal(d.chapter, 2);
  const v = p.view("c1");
  assert.equal(v.chapter, 2);
  assert.equal(v.chapterName, "Pilot");
  assert.equal(v.xp, 2 * XP.skillFirst + XP.chapter);
  assert.equal(v.steps.length, 3);
});

test("grants dedupe: the same sighting, visit or reaction never pays twice", () => {
  const { p } = fresh();
  assert.equal(p.sighted("c1", "w1").xp, XP.sighting);
  assert.equal(p.sighted("c1", "w1").xp, 0);
  assert.equal(p.firstVisit("c1", "w2", 2).xp, XP.firstVisit * 2, "shared awe doubles a first visit");
  assert.equal(p.firstVisit("c1", "w2", 0).xp, 0);
  assert.equal(p.reaction("maker", "w2", "acctA").xp, XP.reaction);
  assert.equal(p.reaction("maker", "w2", "acctA").xp, 0);
  assert.equal(p.reaction("maker", "w2", "acctB").xp, XP.reaction);
  const s = p.view("c1").stats;
  assert.equal(s.sightings, 1);
  assert.equal(s.visits, 1);
});

test("characters that existed before the ladder start at Maker", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE character (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, createdAt INTEGER NOT NULL)`);
  db.prepare(`INSERT INTO character VALUES ('old', 'a', 1)`).run();
  const p = new Progress(db);
  assert.equal(p.view("old").chapter, 5);
  assert.equal(p.view("newcomer").chapter, 1);
  // A second boot doesn't re-seed (or lift) anyone.
  db.prepare(`INSERT INTO character VALUES ('later', 'a', 2)`).run();
  assert.equal(new Progress(db).view("later").chapter, 1);
});

test("flight is capped at max speed × elapsed; every 1,000 u pays", () => {
  const { p, tick } = fresh();
  p.flight("c1", 50, 10); // first report: up to 60 s worth
  tick(10_000);
  p.flight("c1", 1_000_000, 900); // 10 s at most 100 u/s + slack → 1,200
  const s = p.view("c1").stats;
  assert.equal(s.distance, 1250);
  assert.equal(s.farthest, 900);
  assert.equal(p.view("c1").xp, XP.distance);
});

test("creation XP is concave and capped per rolling day", () => {
  const { p, tick } = fresh();
  const a = p.creation("c1", 100, "job1"); // 10·√100 = 100 + first mesh skill
  assert.equal(a.xp, 100 + XP.skillFirst);
  p.creation("c1", 10_000, "job2"); // 1,000 → capped to the remaining 300
  p.creation("c1", 100, "job3"); // cap reached
  const creationXp = p.view("c1").xp - XP.skillFirst - XP.skillMastered;
  assert.equal(creationXp, XP.creationDailyMax);
  tick(25 * 60 * 60 * 1000);
  assert.equal(p.creation("c1", 100, "job4").xp, 100);
  assert.equal(p.creation("c1", 100, "job4").xp, 0, "same job never pays twice");
});

test("the whole ladder: chapter 7 unlocks warp and starts counting levels since", () => {
  const { p, tick } = fresh(3); // sparse universe: visit 3, sight 3
  for (const s of SKILLS) p.useSkill("c1", s, masteryUses(s));
  assert.equal(p.view("c1").chapter, 6);
  for (const w of ["a", "b", "c"]) { p.sighted("c1", w); p.firstVisit("c1", w, 0); }
  p.flight("c1", 1000, 1200);
  assert.equal(p.view("c1").chapter, 6, "still needs 5,000 u in total");
  for (let i = 0; i < 4; i++) {
    tick(20_000);
    p.flight("c1", 1000, 0);
  }
  const v = p.view("c1");
  assert.ok(v.stats.distance >= 5000);
  assert.equal(v.chapter, 7);
  assert.equal(v.warpUnlocked, true);
  assert.equal(v.levelsSinceWarp, 0);
  assert.deepEqual(p.playerProgress("c1"), { chapter: 7, warpUnlocked: true, levelsSinceWarp: 0 });
});

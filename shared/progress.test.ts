import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterFor, emptyStats, explorerTargets, levelFor, masteredForLevel, xpForLevel, SKILLS, masteryUses } from "./progress.ts";

test("level curve rises and the breadth gate holds levels back", () => {
  assert.equal(xpForLevel(1), 0);
  assert.ok(xpForLevel(3) > xpForLevel(2));
  assert.equal(levelFor(0, 0), 1);
  assert.equal(masteredForLevel(4), 1);
  assert.equal(levelFor(xpForLevel(4), 0), 3, "level 4 needs 1 mastered skill");
  assert.equal(levelFor(xpForLevel(4), 1), 4);
  assert.equal(levelFor(1e9, 0), 3, "without mastery you stop at 3");
});

test("chapters follow the ladder; the explorer bar shrinks with a sparse universe", () => {
  const s = emptyStats();
  assert.equal(chapterFor(s, 10), 1);
  s.skills.move = 1;
  s.skills.steer = 1;
  assert.equal(chapterFor(s, 10), 2);
  assert.equal(chapterFor(s, 10, 5), 5, "a floor skips ahead");
  assert.deepEqual(explorerTargets(2), { visits: 2, sightings: 2, distance: 5000, farthest: 1000 });
  for (const k of SKILLS) s.skills[k] = masteryUses(k);
  Object.assign(s, { visits: 2, sightings: 2, distance: 5000, farthest: 1000 });
  assert.equal(chapterFor(s, 2), 7);
  assert.equal(chapterFor(s, 10), 6);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEstimate, clampSeconds, isMakeKind, MAKE_SKILL, MAKE_KINDS } from "./make-costs.ts";
import { SKILLS, EXPLORER_SKILLS, SERVER_SKILLS, CLIENT_SKILLS, chapterFor, emptyStats, masteryUses } from "./progress.ts";

test("estimates follow MANA_COSTS", () => {
  assert.equal(makeEstimate("model"), 60);
  assert.equal(makeEstimate("image"), 7);
  assert.equal(makeEstimate("sound"), 1);
  assert.equal(makeEstimate("music", { seconds: 30 }), 9); // ceil(7.5) + 1
  assert.equal(makeEstimate("music", { seconds: 9999 }), 31); // clamped to 120 s
  assert.equal(makeEstimate("voice", { chars: 100 }), 1);
  assert.equal(makeEstimate("voice", { chars: 600 }), 3.5);
  assert.equal(makeEstimate("lore"), 2);
});

test("seconds are clamped per kind", () => {
  assert.equal(clampSeconds("sound", 0), 1);
  assert.equal(clampSeconds("sound", 100), 22);
  assert.equal(clampSeconds("sound", "x"), 5);
  assert.equal(clampSeconds("music", 3), 10);
  assert.equal(clampSeconds("music", undefined), 30);
});

test("every kind maps to a real, server-observed skill", () => {
  for (const k of MAKE_KINDS) {
    assert.ok(isMakeKind(k));
    assert.ok((SKILLS as readonly string[]).includes(MAKE_SKILL[k]), k);
    assert.ok((SERVER_SKILLS as readonly string[]).includes(MAKE_SKILL[k]), k);
    assert.ok(!(CLIENT_SKILLS as readonly string[]).includes(MAKE_SKILL[k]), k);
  }
  assert.ok(!isMakeKind("texture"));
});

test("media skills don't gate the Explorer chapter", () => {
  const s = emptyStats();
  for (const k of EXPLORER_SKILLS) s.skills[k] = masteryUses(k);
  s.visits = 99; s.sightings = 99; s.distance = 99999; s.farthest = 99999;
  assert.equal(chapterFor(s, 50), 7);
});

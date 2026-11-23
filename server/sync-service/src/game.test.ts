/**
 * A world's stored game (Phase 10, slice 1). Uses node:sqlite so it runs without native modules.
 * Run: node --import tsx --test src/game.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { WorldGames } from "./game.js";
import type { SqlDb } from "./build-requests.js";

const W = "11111111-2222-4333-8444-555555555555";
const W2 = "22222222-2222-4333-8444-555555555555";
const fresh = () => new WorldGames(new DatabaseSync(":memory:") as unknown as SqlDb);
const race = { template: "race", arena: { at: [0, 0, 0], size: [40, 20, 40] } };

test("saving validates, repairs and numbers versions from 1", () => {
  const g = fresh();
  assert.equal(g.get(W), null);
  const a = g.save(W, { ...race, settings: { teams: 99 }, version: 50 }, "cara", 1000);
  assert.ok(a.ok && a.changed);
  assert.equal(a.game.version, 1); // the client's version is ignored
  assert.equal(a.game.settings.teams, 8);
  assert.deepEqual(g.get(W), a.game);
  const b = g.save(W, { ...race, template: "collect" }, "ben", 2000);
  assert.ok(b.ok && b.changed && b.game.version === 2);
  assert.equal(g.get(W)?.template, "collect");
  assert.equal(g.get(W2), null);
});

test("saving the same game again makes no new version", () => {
  const g = fresh();
  const a = g.save(W, race, "cara");
  assert.ok(a.ok);
  const again = g.save(W, { ...a.game, version: 0 }, "ben");
  assert.ok(again.ok && !again.changed && again.game.version === 1);
});

test("a game that can't be repaired is refused and nothing is stored", () => {
  const g = fresh();
  const r = g.save(W, { template: "deathmatch" }, "cara");
  assert.equal(r.ok, false);
  assert.equal(g.get(W), null);
  assert.equal(g.save(W, "race", "cara").ok, false);
});

test("every version stays readable, even after the game is removed; numbers are never reused", () => {
  const g = fresh();
  g.save(W, race, "cara");
  g.save(W, { ...race, template: "survive" }, "cara");
  assert.equal(g.remove(W), true);
  assert.equal(g.remove(W), false);
  assert.equal(g.get(W), null);
  assert.equal(g.getVersion(W, 1)?.template, "race");
  assert.equal(g.getVersion(W, 2)?.template, "survive");
  assert.equal(g.getVersion(W, 3), null);
  const back = g.save(W, race, "cara");
  assert.ok(back.ok && back.game.version === 3);
});

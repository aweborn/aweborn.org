import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initLibrary, listLibrary, removeAsset, rateAsset, ratingOf, listUnrated } from "./library.js";

function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initLibrary(db);
  const add = db.prepare(`INSERT INTO library (sha, file, kind, prompt, provider, bytes, created_at) VALUES (?, ?, ?, ?, 'test', 1, ?)`);
  add.run("a", "a.glb", "model", "a stone giant", 1);
  add.run("b", "b.mp3", "sound", "waves on pebbles", 2);
  add.run("c", "c.mp3", "music", "a slow harp by the sea", 3);
  add.run("d", "d.mp3", "voice", "welcome, traveller", 4);
  add.run("e", "e.webp", "image", "a sea at dusk", 5);
  db.exec("UPDATE library SET rating = 'everyone'"); // already through the output check
  return db;
}

test("listLibrary: models by default; pictures and sounds never leak into the model shelf", () => {
  const db = seed();
  assert.deepEqual(listLibrary(db, "", 10).map((a) => a.sha), ["a"]);
  assert.deepEqual(listLibrary(db, "", 10, "image").map((a) => a.sha), ["e"]);
});

test("listLibrary: several kinds at once (the Sounds shelf), newest first, searchable, trash hidden", () => {
  const db = seed();
  const sounds = ["sound", "music", "voice"];
  assert.deepEqual(listLibrary(db, "", 10, sounds).map((a) => a.sha), ["d", "c", "b"]);
  assert.deepEqual(listLibrary(db, "sea", 10, sounds).map((a) => a.sha), ["c"]);
  assert.deepEqual(listLibrary(db, "", 2, sounds).map((a) => a.sha), ["d", "c"]);
  removeAsset(db, "c", "test");
  assert.deepEqual(listLibrary(db, "", 10, sounds).map((a) => a.sha), ["d", "b"]);
  assert.deepEqual(listLibrary(db, "", 10, []).map((a) => a.sha), ["a"], "no kinds = models");
});

test("ratings: unrated and blocked never reach the shelves; a rating only goes up (except admin)", () => {
  const db = seed();
  db.prepare(`INSERT INTO library (sha, file, kind, prompt, provider, bytes, created_at) VALUES ('n', 'n.glb', 'model', 'a new statue', 'test', 1, 9)`).run();
  assert.equal(ratingOf(db, "n.glb"), "unrated");
  assert.deepEqual(listLibrary(db, "", 10).map((a) => a.sha), ["a"], "unrated stays off the shelf");
  assert.deepEqual(listUnrated(db, 10).map((a) => a.sha), ["n"]);
  assert.equal(rateAsset(db, "n", "everyone"), "everyone");
  assert.deepEqual(listLibrary(db, "", 10).map((a) => a.sha), ["n", "a"]);
  assert.equal(rateAsset(db, "n", "blocked"), "blocked");
  assert.equal(rateAsset(db, "n", "everyone"), "blocked", "never lowered by the check");
  assert.deepEqual(listLibrary(db, "", 10).map((a) => a.sha), ["a"]);
  assert.equal(rateAsset(db, "n", "everyone", { admin: true }), "everyone", "an admin can lower it");
  assert.equal(rateAsset(db, "missing", "everyone"), null);
});

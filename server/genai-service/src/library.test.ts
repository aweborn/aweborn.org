import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initLibrary, listLibrary, removeAsset } from "./library.js";

function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  initLibrary(db);
  const add = db.prepare(`INSERT INTO library (sha, file, kind, prompt, provider, bytes, created_at) VALUES (?, ?, ?, ?, 'test', 1, ?)`);
  add.run("a", "a.glb", "model", "a stone giant", 1);
  add.run("b", "b.mp3", "sound", "waves on pebbles", 2);
  add.run("c", "c.mp3", "music", "a slow harp by the sea", 3);
  add.run("d", "d.mp3", "voice", "welcome, traveller", 4);
  add.run("e", "e.webp", "image", "a sea at dusk", 5);
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


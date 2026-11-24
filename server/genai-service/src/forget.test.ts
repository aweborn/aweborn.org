import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { forgetMakers } from "./forget.js";

function seed(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, ref TEXT, prompt TEXT, creator TEXT, research_id TEXT, asset TEXT);
    CREATE TABLE library (sha TEXT PRIMARY KEY, file TEXT, prompt TEXT, job_id TEXT, creator TEXT, removed_at INTEGER, removed_by TEXT);`);
  const job = db.prepare("INSERT INTO jobs (id, ref, prompt, creator, research_id) VALUES (?, ?, ?, ?, ?)");
  job.run("j1", "r1", "a stone giant", "ann", "r00000000000000000001");
  job.run("j2", "r2", "a glass bird", "ann-2", "r00000000000000000002");
  job.run("j3", "r3", "a red kite", "ben", "r00000000000000000003");
  const lib = db.prepare("INSERT INTO library (sha, file, prompt, job_id, creator, removed_at, removed_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
  lib.run("s1", "s1.glb", "a stone giant", "j1", "aaaaaa", null, null); // on the shelf
  lib.run("s2", "s2.glb", "a glass bird", "j2", "bbbbbb", 5, "maker:bbbbbb"); // in the trash
  lib.run("s3", "s3.glb", "a red kite", "j3", "aaaaaa", 6, "maker:aaaaaa"); // ben's, in the trash, same pseudonym as ann
  return db;
}

test("forgetMakers: their trash is purged, their shelf items lose the maker, their jobs lose the player id; others untouched", async () => {
  const db = seed();
  const purged: string[] = [];
  const purge = async (sha: string) => {
    purged.push(sha);
    db.prepare("DELETE FROM library WHERE sha = ?").run(sha);
    return true;
  };
  assert.deepEqual(await forgetMakers(db, ["ann", "ann-2"], purge), { genai_jobs: 2, genai_library: 1, genai_trash: 1 });
  assert.deepEqual(purged, ["s2"]);
  // The shelf item stays for the worlds that use it, with nobody as its maker
  assert.deepEqual({ ...db.prepare("SELECT creator, removed_at FROM library WHERE sha = 's1'").get() }, { creator: null, removed_at: null });
  // Another player's trash with the same 6-hex pseudonym is not touched
  assert.deepEqual({ ...db.prepare("SELECT creator, removed_at FROM library WHERE sha = 's3'").get() }, { creator: "aaaaaa", removed_at: 6 });
  // Job history: the prompt and research id stay (the archive), the player id is gone
  assert.deepEqual(db.prepare("SELECT id, creator, research_id FROM jobs ORDER BY id").all().map((r) => ({ ...r })), [
    { id: "j1", creator: null, research_id: "r00000000000000000001" },
    { id: "j2", creator: null, research_id: "r00000000000000000002" },
    { id: "j3", creator: "ben", research_id: "r00000000000000000003" },
  ]);
  // Again: nothing left to do
  assert.deepEqual(await forgetMakers(db, ["ann", "ann-2"], purge), { genai_jobs: 0, genai_library: 0, genai_trash: 0 });
  assert.deepEqual(await forgetMakers(db, [], purge), { genai_jobs: 0, genai_library: 0, genai_trash: 0 });
});

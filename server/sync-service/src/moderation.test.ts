import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "aw-mod-")), "t.db");
const { initDb, getDb } = await import("./persistence.js");
const { setMute, listMutes, fileReport, listReports, resolveReport, MAX_MUTES } = await import("./moderation.js");

before(() => {
  initDb();
});

test("mutes: add, dedupe, remove, cap", () => {
  assert.ok(setMute("acct", "p1", true));
  assert.ok(setMute("acct", "p1", true));
  assert.ok(setMute("acct", "p2", true));
  assert.deepEqual(listMutes("acct"), ["p1", "p2"]);
  setMute("acct", "p1", false);
  assert.deepEqual(listMutes("acct"), ["p2"]);
  for (let i = 0; i < MAX_MUTES; i++) setMute("full", `x${i}`, true);
  assert.equal(setMute("full", "one-more", true), false);
});

test("reports take evidence from the server archive, not the reporter", () => {
  const now = Date.now();
  const d = getDb();
  const ins = d.prepare("INSERT INTO chat_messages (world_id, player_id, text, at) VALUES (?, ?, ?, ?)");
  ins.run("w1", "bad", "first line", now - 60_000);
  ins.run("w1", "bad", "second line", now - 30_000);
  ins.run("w2", "bad", "elsewhere", now - 30_000); // other place: not included
  ins.run("w1", "bad", "too old", now - 2 * 3600_000); // outside the hour
  ins.run("w1", "nice", "not them", now - 10_000);
  const r = fileReport("acct", "me", { targetId: "bad", place: "w1", reason: "harassment", note: "  rude\u0000 " }, now);
  assert.ok(r.ok);
  const [rep] = listReports("open");
  assert.deepEqual(rep.evidence.map((e) => e.text), ["first line", "second line"]);
  assert.equal(rep.note, "rude");
  assert.ok(resolveReport(rep.id, "warned"));
  assert.equal(listReports("open").length, 0);
  assert.equal(listReports("resolved")[0].resolution, "warned");
});

test("reports: validation and per-account rate limit", () => {
  assert.equal(fileReport("a2", "me", { targetId: "me", place: "w1", reason: "spam" }).ok, false); // self
  assert.equal(fileReport("a2", "me", { targetId: "x", place: "w1", reason: "nope" }).ok, false);
  assert.equal(fileReport("a2", "me", { targetId: "<script>", place: "w1", reason: "spam" }).ok, false);
  for (let i = 0; i < 10; i++) assert.ok(fileReport("a3", "me", { targetId: `t${i}`, place: "space", reason: "spam" }).ok);
  const r = fileReport("a3", "me", { targetId: "t11", place: "space", reason: "spam" });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.status, 429);
});

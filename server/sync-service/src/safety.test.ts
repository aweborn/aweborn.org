import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "aw-safety-")), "t.db");
const { initDb } = await import("./persistence.js");
const { checkCreation, parseVerdict, setClassifierForTests, listFlags, chargeCheck } = await import("./safety.js");

before(() => {
  initDb();
});

test("parseVerdict reads allowed / blocked and rejects junk", () => {
  assert.deepEqual(parseVerdict('{"allowed": true, "category": "none", "suggestion": ""}'), { allowed: true });
  assert.deepEqual(parseVerdict('Sure! ```json\n{"allowed": false, "category": "ip", "suggestion": "a storm mouse"}\n```'), {
    allowed: false, category: "ip", suggestion: "a storm mouse",
  });
  assert.deepEqual(parseVerdict('{"allowed": false, "category": "weird"}'), { allowed: false, category: "other", suggestion: "" });
  assert.equal(parseVerdict("no json here"), null);
  assert.equal(parseVerdict('{"allowed": "yes"}'), null);
});

test("local blocklist blocks without calling the classifier", async () => {
  let calls = 0;
  setClassifierForTests(async () => {
    calls++;
    return { verdict: { allowed: true }, costUsd: 0.001 };
  });
  const v = await checkCreation("p1", "make", ["a big fucking rock"], "r1");
  assert.equal(v.ok, false);
  assert.equal(calls, 0);
  if (!v.ok) assert.equal(v.category, "profanity");
});

test("classifier verdicts are cached and blocks are logged", async () => {
  let calls = 0;
  setClassifierForTests(async (_ref, texts) => {
    calls++;
    return texts.some((t) => /pikachu/i.test(t))
      ? { verdict: { allowed: false, category: "ip", suggestion: "a cheerful storm-mouse of your own design" }, costUsd: 0.0004 }
      : { verdict: { allowed: true }, costUsd: 0.0004 };
  });
  const ok1 = await checkCreation("p1", "make", ["a mossy stone lantern"], "r2");
  const ok2 = await checkCreation("p1", "make", ["  A mossy stone lantern "], "r3");
  assert.ok(ok1.ok && ok2.ok);
  assert.equal(calls, 1, "second check is a cache hit");
  assert.equal(ok2.costUsd, 0, "cache hits are free");

  const bad = await checkCreation("p2", "plan", ["Pikachu statue"], "r4");
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.category, "ip");
    assert.match(bad.message, /storm-mouse/);
  }
  const flags = listFlags();
  assert.equal(flags[0].playerId, "p2");
  assert.equal(flags[0].surface, "plan");
  assert.equal(flags[0].layer, "classifier");
});

test("classifier outage lets the prompt through (local list still applied)", async () => {
  setClassifierForTests(async () => ({ verdict: null, costUsd: 0 }));
  const v = await checkCreation("p1", "make", ["a glass whale"], "r5");
  assert.ok(v.ok);
});

test("chargeCheck books the classifier cost as reserve → settle", () => {
  const calls: string[] = [];
  const ledger = {
    reserve: (ref: string, est: number) => (calls.push(`reserve ${ref} ${est}`), { ok: true }),
    settle: (ref: string, mana: number) => calls.push(`settle ${ref} ${mana}`),
  };
  chargeCheck(ledger, "p1", "x", 0.0004);
  chargeCheck(ledger, "p1", "y", 0);
  assert.deepEqual(calls, ["reserve safety:x 0.04", "settle safety:x 0.04"]);
  setClassifierForTests(null);
});

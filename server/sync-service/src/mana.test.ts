/**
 * Mana ledger tests. Run: npm test (node --test via tsx), in-memory SQLite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ManaLedger } from "./mana.js";

const fresh = () => {
  const db = new Database(":memory:");
  return { db, mana: new ManaLedger(db) };
};

test("a gift fills pool + high-water, half goes to the creative share", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 9.41, ref: "pi_1" });
  const s = mana.state();
  assert.equal(s.pool, 941);
  assert.equal(s.highWater, 941);
  assert.equal(s.totalIn, 941);
  assert.equal(s.creative, 470.5);
  assert.ok(s.lastDonationAt > 0);
});

test("founding gift: $1,000 → 100,000 pool, 50,000 creative, Frontier 100 u", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "founding", netDollars: 1000 });
  const s = mana.state();
  assert.equal(s.pool, 100_000);
  assert.equal(s.creative, 50_000);
  assert.ok(Math.abs(s.frontierRadius - 100) < 1e-9);
  assert.equal(s.lastDonationAt, 0, "only gifts count as donations for the wave timestamp");
});

test("restricted grants add nothing creative; card sales count after their costs", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "grant", netDollars: 100, restricted: true, creativeBaseDollars: 100 });
  mana.recordInflow({ source: "card", netDollars: 20, creativeBaseDollars: 12 });
  const s = mana.state();
  assert.equal(s.pool, 12_000);
  assert.equal(s.creative, 600);
  assert.throws(() => mana.recordInflow({ source: "card", netDollars: 5, creativeBaseDollars: 6 }));
});

test("inflows are idempotent on ref (webhook retries)", () => {
  const { mana } = fresh();
  assert.ok(mana.recordInflow({ source: "gift", netDollars: 10, ref: "pi_x" }));
  assert.equal(mana.recordInflow({ source: "gift", netDollars: 10, ref: "pi_x" }), null);
  assert.equal(mana.state().pool, 1000);
});

test("non-creative draws come out of the pool, never the creative share while there's room", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 100 }); // pool 10,000 / creative 5,000
  const r = mana.recordDraw({ purpose: "servers", fn: "program", dollars: 30 });
  assert.ok(r && r.shortfall === null);
  const s = mana.state();
  assert.equal(s.pool, 7000);
  assert.equal(s.creative, 5000);
  assert.equal(s.drawnBy.program, 3000);
  assert.equal(s.drawnByPurpose.servers, 3000);
});

test("shortfall: a bill bigger than the non-creative part shrinks the creative share, in the open", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 100 }); // 10,000 / 5,000
  const r = mana.recordDraw({ purpose: "compensation", fn: "management", dollars: 70, ref: "payroll-oct" });
  assert.ok(r?.shortfall);
  assert.equal(r.shortfall.amount, 2000);
  assert.equal(r.shortfall.creativeDelta, -2000);
  const s = mana.state();
  assert.equal(s.pool, 3000);
  assert.equal(s.creative, 3000);
  assert.equal(s.shortfall, 2000);
  assert.ok(s.creative <= s.pool);
  // the next gift refills the creative share as usual
  mana.recordInflow({ source: "gift", netDollars: 10 });
  assert.equal(mana.state().creative, 3500);
});

test("a draw past the whole pool leaves creative at 0 (pool may go negative = owed)", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 10 });
  mana.recordDraw({ purpose: "servers", fn: "program", dollars: 15 });
  const s = mana.state();
  assert.equal(s.pool, -500);
  assert.equal(s.creative, 0);
});

test("creations: reserve → settle draws the actual cost from creative + pool", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 10 }); // 1,000 / 500
  const r = mana.reserve("gen-1", 60, "player-a");
  assert.deepEqual(r, { ok: true, ref: "gen-1", estimate: 60 });
  assert.equal(mana.state().reserved, 60);
  assert.equal(mana.available(), 440);
  mana.settle("gen-1", 58.2);
  const s = mana.state();
  assert.equal(s.reserved, 0);
  assert.equal(s.creative, 441.8);
  assert.equal(s.pool, 941.8);
  assert.equal(s.drawnByPurpose.creations, 58.2);
  assert.equal(s.drawnBy.program, 58.2);
});

test("creations: release on failure draws nothing", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 10 });
  mana.reserve("gen-2", 60, null);
  mana.release("gen-2");
  const s = mana.state();
  assert.equal(s.reserved, 0);
  assert.equal(s.creative, 500);
  assert.equal(s.pool, 1000);
  assert.equal(mana.settle("gen-2", 10), null, "can't settle a released hold");
});

test("reserve refuses more than the unreserved creative share, and duplicates", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 1 }); // creative 50
  assert.deepEqual(mana.reserve("a", 40, null), { ok: true, ref: "a", estimate: 40 });
  assert.deepEqual(mana.reserve("b", 20, null), { ok: false, reason: "insufficient_creative" });
  assert.deepEqual(mana.reserve("a", 1, null), { ok: false, reason: "duplicate" });
  assert.deepEqual(mana.reserve("c", 0, null), { ok: false, reason: "bad_amount" });
});

test("creations can't be recorded as plain draws", () => {
  const { mana } = fresh();
  // @ts-expect-error creations are not a DrawInput purpose
  assert.throws(() => mana.recordDraw({ purpose: "creations", fn: "program", dollars: 1 }));
});

test("awe raises the high-water line (and Frontier) only", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "founding", netDollars: 1000 });
  mana.recordAweReach(25, "player-a", "first:world-1");
  const s = mana.state();
  assert.equal(s.highWater, 100_025);
  assert.equal(s.pool, 100_000);
  assert.equal(s.creative, 50_000);
  assert.ok(s.frontierRadius > 100);
});

test("state is rebuilt exactly from the ledger after a restart (open holds too)", () => {
  const { db, mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 100 });
  mana.recordDraw({ purpose: "compensation", fn: "management", dollars: 70 });
  mana.reserve("gen-9", 12.3, "p");
  mana.recordAweReach(5, "p");
  const before = mana.state();
  const again = new ManaLedger(db);
  assert.deepEqual(again.state(), before);
  assert.ok(again.settle("gen-9", 12.3), "open hold survives the restart");
});

test("the ledger is append-only", () => {
  const { db, mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 1 });
  assert.throws(() => db.prepare("UPDATE mana_ledger SET amount_mm = 0").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM mana_ledger").run(), /append-only/);
});

test("public ledger hides holds, players, refs and donor notes", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 10, ref: "pi_9", note: "from Jane" });
  mana.reserve("g", 5, "player-a");
  mana.settle("g", 5, "a lantern");
  const rows = mana.publicEntries();
  assert.deepEqual(rows.map((r) => r.kind), ["settle", "inflow"]);
  assert.equal(rows[1].note, null);
  assert.equal(rows[0].note, "a lantern");
  for (const r of rows) {
    assert.ok(!("playerId" in r));
    assert.ok(!("ref" in r));
  }
});

test("publish writes the state into the Universe doc and retires August fields", async () => {
  const Y = await import("yjs");
  const { mana } = fresh();
  const doc = new Y.Doc();
  doc.getMap("mana").set("regenRate", 100);
  mana.recordInflow({ source: "gift", netDollars: 10 });
  mana.publish(doc);
  const m = doc.getMap("mana");
  assert.equal(m.get("pool"), 1000);
  assert.equal(m.get("creative"), 500);
  assert.equal(m.has("regenRate"), false);
});

test("onChange fires once per tick after a draw + shortfall", async () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 100 });
  let calls = 0;
  mana.onChange(() => calls++);
  mana.recordDraw({ purpose: "servers", fn: "program", dollars: 80 });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
});

/**
 * Living sky ledger tests (M4): refunds as labeled draws, the smoothed
 * shooting-star flow, opt-in donor names, runway, and the runway email.
 * Run: npm test (in-memory SQLite).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ManaLedger } from "./mana.js";
import { RunwayWatch } from "./runway.js";
import type { Email } from "./email.js";

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const fresh = () => {
  const db = new Database(":memory:");
  return { db, mana: new ManaLedger(db) };
};

test("refund: a labeled draw, clamped to the gift, deduped, never lowers high-water", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 9.41, ref: "pi_1", at: T0 });
  const before = mana.state();
  const r = mana.recordRefund({ giftRef: "pi_1", refundRef: "ch_1:1000", dollars: 10, at: T0 + 1 });
  assert.ok(r.ok);
  assert.equal(r.draw.purpose, "refunds");
  assert.equal(r.draw.fn, "fundraising");
  assert.equal(r.draw.nature, "refund");
  assert.equal(r.draw.amount, 941, "clamped to the net the gift brought in");
  const after = mana.state();
  assert.equal(after.pool, 0);
  assert.equal(after.highWater, before.highWater, "the Frontier never moves back");
  assert.equal(after.drawnByPurpose.refunds, 941);
  assert.ok(r.shortfall, "the creative share shrinks in the open when the pool falls below it");
  assert.equal(after.creative, 0);

  const again = mana.recordRefund({ giftRef: "pi_1", refundRef: "ch_1:1000", dollars: 10 });
  assert.deepEqual(again, { ok: false, reason: "duplicate" });
  const more = mana.recordRefund({ giftRef: "pi_1", refundRef: "ch_1:2000", dollars: 1 });
  assert.deepEqual(more, { ok: false, reason: "exceeds_gift" }, "can't refund more than the gift");
  assert.deepEqual(mana.recordRefund({ giftRef: "pi_x", refundRef: "a", dollars: 1 }), { ok: false, reason: "unknown_gift" });
});

test("partial refunds add up to at most the gift", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "founding", netDollars: 1000 });
  mana.recordInflow({ source: "gift", netDollars: 20, ref: "pi_2" });
  assert.ok(mana.recordRefund({ giftRef: "pi_2", refundRef: "ch:500", dollars: 5 }).ok);
  const second = mana.recordRefund({ giftRef: "pi_2", refundRef: "ch:2500", dollars: 20 });
  assert.ok(second.ok);
  assert.equal(second.draw.amount, 1500, "only the $15 left of the gift");
  assert.equal(second.shortfall, null, "a big pool covers it without touching the creative share");
});

test("opt-in donor name: cleaned, shown in state for the latest gift only", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "gift", netDollars: 5, ref: "pi_a", publicName: "  Ada  ", at: T0 });
  assert.equal(mana.state().lastDonorName, "Ada");
  assert.equal(mana.publicEntries(1)[0].publicName, "Ada");
  mana.recordInflow({ source: "gift", netDollars: 5, ref: "pi_b", at: T0 + 1 });
  assert.equal(mana.state().lastDonorName, null, "the next anonymous gift is anonymous");
  mana.recordInflow({ source: "gift", netDollars: 5, ref: "pi_c", publicName: "x", at: T0 + 2 });
  assert.equal(mana.state().lastDonorName, null, "a refused name is dropped, the gift still counts");
  assert.equal(mana.state().pool, 1500);
});

test("draws carry a Form 990 nature (default by purpose) and reject unknown ones", () => {
  const { mana } = fresh();
  mana.recordInflow({ source: "founding", netDollars: 1000 });
  const a = mana.recordDraw({ purpose: "servers", fn: "program", dollars: 1 });
  assert.equal(a?.draw.nature, "it");
  const b = mana.recordDraw({ purpose: "other", fn: "management", dollars: 1, nature: "accounting" });
  assert.equal(b?.draw.nature, "accounting");
  assert.throws(() => mana.recordDraw({ purpose: "other", fn: "management", dollars: 1, nature: "bogus" as never }));
  assert.throws(() => mana.recordDraw({ purpose: "other", fn: "management", dollars: 1, periodDays: 400 }));
});

test("flow: period draws release evenly; creations land in real time", () => {
  const { mana } = fresh();
  const T0 = Date.now(); // settle() stamps real time
  mana.recordInflow({ source: "founding", netDollars: 1000, at: T0 - 40 * DAY });
  // $30 server bill over 30 days, booked 10 days ago → $1/day today
  mana.recordDraw({ purpose: "servers", fn: "program", dollars: 30, periodDays: 30, at: T0 - 10 * DAY });
  // Old instant draw: outside the window
  mana.recordDraw({ purpose: "other", fn: "management", dollars: 5, at: T0 - 3 * DAY });
  // A creation settled an hour ago
  mana.reserve("c1", 60, "p1", T0 - 2 * 3600_000);
  mana.settle("c1", 42);
  const f = mana.flow(T0 + 60_000);
  const servers = f.lines.find((l) => l.purpose === "servers");
  assert.ok(servers);
  assert.ok(Math.abs(servers.amount - 100) < 0.01, `≈100 mana/day, got ${servers.amount}`);
  assert.equal(f.lines.find((l) => l.purpose === "other"), undefined);
  const creations = f.lines.find((l) => l.purpose === "creations");
  assert.equal(creations?.amount, 42);
  assert.equal(creations?.nature, "it");
});

test("runway: reserve ÷ average monthly overhead; refunds don't count as overhead", () => {
  const { mana } = fresh();
  assert.equal(mana.runway().days, Infinity, "no overhead yet");
  mana.recordInflow({ source: "founding", netDollars: 1000, at: T0 - 100 * DAY }); // 50,000 outside the creative share
  mana.recordDraw({ purpose: "servers", fn: "program", dollars: 300, at: T0 - 30 * DAY }); // 30,000 over 90 days = 10,000/mo
  mana.recordInflow({ source: "gift", netDollars: 10, ref: "pi_r", at: T0 - DAY });
  mana.recordRefund({ giftRef: "pi_r", refundRef: "r1", dollars: 10, at: T0 });
  const r = mana.runway(T0);
  assert.equal(r.monthlyOverhead, 10_000);
  // 70,000 pool − 50,500 creative (the refunded gift's creative half stays creative: a refund is a draw on the pool)
  assert.equal(r.reserve, 19_500);
  assert.equal(r.days, 58.5);
});

test("runway email: under 90 days → one email, then quiet for a week", async () => {
  const { db, mana } = fresh();
  let clock = T0;
  mana.recordInflow({ source: "founding", netDollars: 1000, at: T0 - 100 * DAY });
  mana.recordDraw({ purpose: "servers", fn: "program", dollars: 300, at: T0 - 30 * DAY });
  const sent: Email[] = [];
  const watch = new RunwayWatch(db, mana, async (m) => void sent.push(m), "alex@example.org", () => clock);
  assert.equal(await watch.check(), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /runway: about 6\d days/);
  assert.equal(await watch.check(), false, "not again the same week");
  clock += 8 * DAY;
  assert.equal(await watch.check(), true, "reminds after a week if it still holds");
});

test("runway email: a healthy runway sends nothing", async () => {
  const { db, mana } = fresh();
  mana.recordInflow({ source: "founding", netDollars: 1000 });
  mana.recordDraw({ purpose: "servers", fn: "program", dollars: 10 });
  const sent: Email[] = [];
  const watch = new RunwayWatch(db, mana, async (m) => void sent.push(m), "a@b.c");
  assert.equal(await watch.check(), false);
  assert.equal(sent.length, 0);
});

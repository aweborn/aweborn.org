/**
 * Flow & admission tests. Run: npm test (in-memory SQLite, fake clock).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ManaLedger } from "./mana.js";
import { ManaAdmission, waterFill, REPLENISH_MESSAGE } from "./admission.js";
import { baseCap, MANA_CAPS } from "../../../shared/crdt-schema.js";

const DAY = 24 * 60 * 60 * 1000;
const maker = { chapter: 5, warpUnlocked: false, levelsSinceWarp: 0 };
const explorer = { chapter: 6, warpUnlocked: false, levelsSinceWarp: 0 };

function setup(dollars = 1000) {
  let clock = 1_800_000_000_000;
  const mana = new ManaLedger(new Database(":memory:"));
  if (dollars > 0) mana.recordInflow({ source: "founding", netDollars: dollars, at: clock });
  const adm = new ManaAdmission(mana, () => clock);
  return { mana, adm, tick: (ms: number) => (clock += ms) };
}

test("base(level): 0 / maker / explorer / +perLevel after warp, up to max", () => {
  assert.equal(baseCap({ chapter: 3, warpUnlocked: false, levelsSinceWarp: 0 }), 0);
  assert.equal(baseCap(maker), MANA_CAPS.maker);
  assert.equal(baseCap(explorer), MANA_CAPS.explorer);
  assert.equal(baseCap({ chapter: 7, warpUnlocked: true, levelsSinceWarp: 4 }), MANA_CAPS.explorer + 4 * MANA_CAPS.perLevel);
  assert.equal(baseCap({ chapter: 7, warpUnlocked: true, levelsSinceWarp: 100 }), MANA_CAPS.max);
});

test("water-filling is max-min fair and redistributes what light users don't need", () => {
  assert.deepEqual(waterFill(300, [50, 1000, 1000]), [50, 125, 125]);
  assert.deepEqual(waterFill(100, [1000]), [100]);
  assert.deepEqual(waterFill(1000, [100, 200]), [100, 200]);
});

test("global flow: creative / τ, never below p_solo, never above creative", () => {
  assert.ok(Math.abs(setup(1000).adm.globalFlow() - 50_000 / 30) < 1e-9);
  assert.equal(setup(5).adm.globalFlow(), 250); // creative 250 < p_solo
  assert.equal(setup(30).adm.globalFlow(), MANA_CAPS.pSolo); // creative 1,500 → p_solo floor
});

test("chapters 1–4 can't draw yet", () => {
  const { adm } = setup();
  const d = adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 1, progress: { chapter: 2, warpUnlocked: false, levelsSinceWarp: 0 } });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.reason, "not_unlocked");
});

test("a lone maker gets their whole personal cap, then a gentle no", () => {
  const { adm } = setup();
  const a = adm.requestDraw({ playerId: "p1", ref: "r1", estimate: MANA_CAPS.maker - 46, progress: maker });
  assert.equal(a.ok, true);
  const b = adm.requestDraw({ playerId: "p1", ref: "r2", estimate: 60, progress: maker });
  assert.equal(b.ok, false);
  assert.equal(!b.ok && b.reason, "personal_cap");
  assert.equal(!b.ok && b.message, REPLENISH_MESSAGE);
  assert.equal(b.remainingToday, 46);
});

test("released holds don't count; settled ones count at their actual cost", () => {
  const { mana, adm } = setup();
  adm.requestDraw({ playerId: "p1", ref: "r1", estimate: MANA_CAPS.maker, progress: maker });
  mana.release("r1");
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r2", estimate: MANA_CAPS.maker, progress: maker }).ok, true);
  mana.settle("r2", MANA_CAPS.maker - 60);
  const d = adm.requestDraw({ playerId: "p1", ref: "r3", estimate: 60, progress: maker });
  assert.equal(d.ok, true);
});

test("the cap is a rolling 24 h window", () => {
  const { adm, tick } = setup();
  adm.requestDraw({ playerId: "p1", ref: "r1", estimate: MANA_CAPS.maker, progress: maker });
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r2", estimate: 10, progress: maker }).ok, false);
  tick(DAY + 1);
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r3", estimate: 10, progress: maker }).ok, true);
});

test("solar ±10% scales the cap and is clamped", () => {
  const { adm } = setup();
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r1", estimate: MANA_CAPS.maker * 1.1, progress: maker, solar: 5 }).ok, true);
  const { adm: night } = setup();
  assert.equal(night.requestDraw({ playerId: "p2", ref: "r1", estimate: MANA_CAPS.maker * 0.95, progress: maker, solar: 0.9 }).ok, false);
});

test("many players: the universe's flow binds and is shared evenly", () => {
  const { adm } = setup(); // G ≈ 1,666.7 per day
  for (let i = 0; i < 19; i++) adm.markActive(`other${i}`);
  // 20 active players → ≈ 83.3 each, below the explorer cap of 250.
  const big = adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 100, progress: explorer });
  assert.equal(big.ok, false);
  assert.equal(!big.ok && big.reason, "universe_flow");
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r2", estimate: 80, progress: explorer }).ok, true);
});

test("players idle for 30 minutes leave the split", () => {
  const { adm, tick } = setup();
  for (let i = 0; i < 19; i++) adm.markActive(`other${i}`);
  tick(31 * 60 * 1000);
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 250, progress: explorer }).ok, true);
});

test("a lone player can always make a whole world when the pool is small (p_solo)", () => {
  const { adm } = setup(20); // creative 1,000 → G = max(33, 400) = 400
  const d = adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 376, progress: { chapter: 7, warpUnlocked: true, levelsSinceWarp: 6 } });
  assert.equal(d.ok, true);
});

test("an empty creative share refuses even within the caps", () => {
  const { adm } = setup(0);
  const d = adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 5, progress: maker });
  assert.equal(d.ok, false);
});

test("the same ref can't be held twice", () => {
  const { adm } = setup();
  assert.equal(adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 5, progress: maker }).ok, true);
  const d = adm.requestDraw({ playerId: "p1", ref: "r1", estimate: 5, progress: maker });
  assert.equal(!d.ok && d.reason, "duplicate");
});

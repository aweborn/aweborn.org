import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { CardSets } from "./card-sets.js";
import { cardSetNumber, isCardSetId, parseCardSet, ORIGIN_SET_ID, CARD_SET_LIMITS } from "../../../shared/cards.js";
import { ORIGIN_WORLD_ID, isWorldId } from "../../../shared/crdt-schema.js";

const A = "11111111-2222-4333-8444-555555555555";
const B = "22222222-2222-4333-8444-555555555555";
const GONE = "99999999-2222-4333-8444-555555555555";

function setup() {
  const db = new Database(":memory:");
  const live = new Set([A, B, ORIGIN_WORLD_ID]);
  return { db, sets: new CardSets(db, (id) => live.has(id), () => 1_800_000_000_000) };
}

test("card sets: numbering and ids", () => {
  assert.equal(cardSetNumber(0, 1), "");
  assert.equal(cardSetNumber(0, 12), "01 / 12");
  assert.equal(cardSetNumber(6, 12), "07 / 12");
  assert.equal(cardSetNumber(4, 100), "005 / 100");
  assert.equal(cardSetNumber(12, 12), "");
  assert.ok(isCardSetId("fall-meetup-2026") && isCardSetId("origin"));
  assert.ok(!isCardSetId("Fall") && !isCardSetId("-x") && !isCardSetId("x-") && !isCardSetId("a".repeat(41)));
});

test("card sets: parse checks ids, name, worlds", () => {
  assert.ok(!parseCardSet({ id: "x", name: "", worldIds: [A] }, isWorldId).ok);
  assert.ok(!parseCardSet({ id: "x", name: "X", worldIds: [] }, isWorldId).ok);
  assert.ok(!parseCardSet({ id: "x", name: "X", worldIds: [A, A] }, isWorldId).ok);
  assert.ok(!parseCardSet({ id: "x", name: "X", worldIds: ["nope"] }, isWorldId).ok);
  assert.ok(!parseCardSet({ id: "x", name: "X", worldIds: Array(CARD_SET_LIMITS.maxWorlds + 1).fill(A) }, isWorldId).ok);
  const ok = parseCardSet({ id: "x", name: "  Fall   Meetup ", worldIds: [A.toUpperCase(), B] }, isWorldId);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.set, { id: "x", name: "Fall Meetup", worldIds: [A, B] });
});

test("card sets: Origin Set is seeded and stays; upsert, list order, remove", () => {
  const { sets } = setup();
  assert.deepEqual(sets.list(), [{ id: ORIGIN_SET_ID, name: "Origin Set", worldIds: [ORIGIN_WORLD_ID] }]);
  assert.equal((sets.remove(ORIGIN_SET_ID) as { status: number }).status, 409);

  assert.equal((sets.upsert({ id: "meetup", name: "Meetup", worldIds: [A, GONE] }) as { status: number }).status, 404);
  assert.ok(sets.upsert({ id: "meetup", name: "Meetup", worldIds: [A, B] }).ok);
  assert.deepEqual(sets.list().map((s) => s.id), [ORIGIN_SET_ID, "meetup"]);
  // Edit in place: same id, new name/order
  assert.ok(sets.upsert({ id: "meetup", name: "Fall Meetup", worldIds: [B, A] }).ok);
  assert.deepEqual(sets.list()[1], { id: "meetup", name: "Fall Meetup", worldIds: [B, A] });

  assert.ok(sets.remove("meetup").ok);
  assert.equal((sets.remove("meetup") as { status: number }).status, 404);
  assert.equal(sets.list().length, 1);
});

/** The 18+ door. Uses node:sqlite so it runs without native modules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AgeDoor, DOOR_RETRY_MS, forgetDoor, isOldEnough, parseBirthdate } from "./age-door.js";
import type { SqlDb } from "./build-requests.js";

const fresh = () => {
  const db = new DatabaseSync(":memory:") as unknown as SqlDb;
  return { db, door: new AgeDoor(db) };
};
/** Noon UTC on that day. */
const at = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h);
const NOW = at(2026, 11, 23);

test("parseBirthdate takes real calendar dates only", () => {
  assert.deepEqual(parseBirthdate("2000-02-29"), { y: 2000, m: 2, d: 29 });
  for (const bad of ["2001-02-29", "2000-13-01", "2000-00-10", "2000-1-1", "01/02/2000", "", "2000-01-01T00:00:00Z", 20000101, null, undefined, {}]) {
    assert.equal(parseBirthdate(bad), null, String(bad));
  }
});

test("18 means 18 everywhere on Earth: a day late on the birthday, never a day early", () => {
  const born = { y: 2008, m: 11, d: 23 };
  assert.equal(isOldEnough(born, at(2026, 11, 22, 23)), false);
  assert.equal(isOldEnough(born, at(2026, 11, 23, 0)), false); // still Nov 22 in UTC−12
  assert.equal(isOldEnough(born, at(2026, 11, 23, 11)), false);
  assert.equal(isOldEnough(born, at(2026, 11, 23, 12)), true); // Nov 23 has begun everywhere
  assert.equal(isOldEnough({ y: 2008, m: 11, d: 24 }, at(2026, 11, 23, 23)), false);
  assert.equal(isOldEnough({ y: 1990, m: 1, d: 1 }, NOW), true);
  // Born on a leap day: 18 on Mar 1 of a year without one
  assert.equal(isOldEnough({ y: 2008, m: 2, d: 29 }, at(2026, 2, 28, 23)), false);
  assert.equal(isOldEnough({ y: 2008, m: 2, d: 29 }, at(2026, 3, 1, 12)), true);
});

test("the door starts shut, opens with an adult birthdate, and the switch then works alone", () => {
  const { db, door } = fresh();
  assert.deepEqual(door.state("acct"), { confirmed: false, show: false });
  assert.equal(door.open("acct"), false);
  assert.equal(door.open(null), false);
  assert.deepEqual(door.set("acct", true, undefined, NOW), { ok: false, code: "birthdate_needed" });
  assert.deepEqual(door.set("acct", true, "1990-06-15", NOW), { ok: true, confirmed: true, show: true });
  assert.equal(door.open("acct"), true);
  assert.equal(door.open("someone-else"), false);
  assert.deepEqual(door.set("acct", false, undefined, NOW + 1), { ok: true, confirmed: true, show: false });
  assert.equal(door.open("acct"), false);
  // Back on without asking again
  assert.deepEqual(door.set("acct", true, undefined, NOW + 2), { ok: true, confirmed: true, show: true });
  // A new door over the same database remembers
  assert.deepEqual(new AgeDoor(db).state("acct"), { confirmed: true, show: true });
});

test("the birthdate is never stored", () => {
  const { db, door } = fresh();
  door.set("acct", true, "1990-06-15", NOW);
  const row = db.prepare("SELECT * FROM age_door WHERE account_id = 'acct'").get() as Record<string, unknown>;
  assert.deepEqual(Object.keys(row).sort(), ["account_id", "changed_at", "confirmed_at", "show"]);
  assert.ok(!JSON.stringify(row).includes("1990"));
});

test("turning it off when it was never on stores nothing", () => {
  const { db, door } = fresh();
  assert.deepEqual(door.set("acct", false, undefined, NOW), { ok: true, confirmed: false, show: false });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM age_door").get() as { n: number }).n, 0);
});

test("an under-18 birthdate stores nothing and holds the account from trying again", () => {
  const { db, door } = fresh();
  const r = door.set("kid", true, "2010-01-01", NOW);
  assert.deepEqual(r, { ok: false, code: "under_age", retryAt: NOW + DOOR_RETRY_MS });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM age_door").get() as { n: number }).n, 0);
  // A different date straight away doesn't get through, and doesn't push the hold out
  assert.deepEqual(door.set("kid", true, "1990-01-01", NOW + 1000), { ok: false, code: "under_age", retryAt: NOW + DOOR_RETRY_MS });
  assert.equal(door.open("kid"), false);
  // Another account isn't held
  assert.equal(door.set("adult", true, "1990-01-01", NOW + 1000).ok, true);
  // After the hold, an honest retry works
  assert.equal(door.retryAt("kid", NOW + DOOR_RETRY_MS), 0);
  assert.equal(door.set("kid", true, "1990-01-01", NOW + DOOR_RETRY_MS).ok, true);
});

test("dates that can't be a birthdate are refused without a hold", () => {
  const { door } = fresh();
  for (const bad of ["2030-01-01", "1850-01-01", "2001-02-29", "yesterday", 42]) {
    assert.deepEqual(door.set("acct", true, bad, NOW), { ok: false, code: "bad_birthdate" }, String(bad));
  }
  assert.equal(door.retryAt("acct", NOW), 0);
  assert.equal(door.set("acct", true, "1990-01-01", NOW).ok, true);
});

test("forgetting an account removes the door, with or without a door object", () => {
  const { db, door } = fresh();
  door.set("a", true, "1990-01-01", NOW);
  door.set("b", true, "1990-01-01", NOW);
  assert.equal(door.forget("a"), true);
  assert.equal(door.forget("a"), false);
  assert.deepEqual(door.state("a"), { confirmed: false, show: false });
  assert.equal(forgetDoor(db, "b"), true);
  assert.equal(forgetDoor(db, "b"), false);
  assert.equal(door.open("b"), false);
  // Safe before the table exists
  assert.equal(forgetDoor(new DatabaseSync(":memory:") as unknown as SqlDb, "a"), false);
});

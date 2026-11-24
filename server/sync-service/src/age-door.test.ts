/** The 18+ door: a toggle. Uses node:sqlite so it runs without native modules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AgeDoor, forgetDoor } from "./age-door.js";
import type { SqlDb } from "./build-requests.js";

const fresh = () => {
  const db = new DatabaseSync(":memory:") as unknown as SqlDb;
  return { db, door: new AgeDoor(db) };
};
const row = (db: SqlDb, id: string) => db.prepare("SELECT * FROM age_door WHERE account_id = ?").get(id) as Record<string, unknown> | undefined;

test("the door starts shut and is one switch: on, off, on", () => {
  const { db, door } = fresh();
  assert.equal(door.open("acct"), false);
  assert.equal(door.open(null), false);
  assert.equal(door.open(undefined), false);
  assert.equal(door.set("acct", true, 1000), true);
  assert.equal(door.open("acct"), true);
  assert.equal(door.open("someone-else"), false);
  assert.equal(door.set("acct", false, 2000), false);
  assert.equal(door.open("acct"), false);
  assert.equal(door.set("acct", true, 3000), true);
  // A new door over the same database remembers
  assert.equal(new AgeDoor(db).open("acct"), true);
});

test("it stores the switch and when it changed, and nothing about age", () => {
  const { db, door } = fresh();
  door.set("acct", true, 1000);
  assert.deepEqual({ ...row(db, "acct") }, { account_id: "acct", show: 1, changed_at: 1000 });
  // Setting it to what it already is changes nothing
  door.set("acct", true, 5000);
  assert.equal(row(db, "acct")!.changed_at, 1000);
  door.set("acct", false, 6000);
  assert.deepEqual({ ...row(db, "acct") }, { account_id: "acct", show: 0, changed_at: 6000 });
});

test("turning it off when it was never on stores nothing", () => {
  const { db, door } = fresh();
  assert.equal(door.set("acct", false, 1000), false);
  assert.equal(row(db, "acct"), undefined);
});

test("forgetting an account removes the door, with or without a door object", () => {
  const { db, door } = fresh();
  door.set("a", true);
  door.set("b", true);
  assert.equal(door.forget("a"), true);
  assert.equal(door.forget("a"), false);
  assert.equal(door.open("a"), false);
  assert.equal(forgetDoor(db, "b"), true);
  assert.equal(forgetDoor(db, "b"), false);
  assert.equal(door.open("b"), false);
  // Safe before the table exists
  assert.equal(forgetDoor(new DatabaseSync(":memory:") as unknown as SqlDb, "a"), false);
});

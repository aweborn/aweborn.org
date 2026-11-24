/** 18+ worlds' real names. Uses node:sqlite so it runs without native modules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AdultWorlds } from "./adult-worlds.js";
import type { SqlDb } from "./build-requests.js";
import { ADULT_WORLD_NAME, isAdultWorld, worldTierField } from "../../../shared/crdt-schema.js";

test("real names are kept by world id and survive a restart", () => {
  const db = new DatabaseSync(":memory:") as unknown as SqlDb;
  const a = new AdultWorlds(db);
  assert.deepEqual(a.names(), {});
  assert.equal(a.name("w1"), undefined);
  a.setName("w1", "Velvet");
  a.setName("w2", "Ember");
  a.setName("w1", "Velvet Hall");
  assert.equal(a.name("w1"), "Velvet Hall");
  assert.deepEqual(new AdultWorlds(db).names(), { w1: "Velvet Hall", w2: "Ember" });
});

test("a world's tier: only the exact value counts, and the stand-in name is fixed", () => {
  assert.equal(isAdultWorld({ tier: "adult" }), true);
  for (const not of [{}, { tier: "everyone" }, { tier: true }, { tier: "ADULT" }, null, undefined]) assert.equal(isAdultWorld(not as never), false);
  assert.deepEqual(worldTierField("adult"), { tier: "adult" });
  assert.deepEqual(worldTierField("everyone"), {});
  assert.deepEqual(worldTierField(undefined), {});
  assert.equal(ADULT_WORLD_NAME, "18+ world");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { solidifyWithinFrontier, insideFrontier } from "./frontier.js";
import { ORIGIN_WORLD_ID, frontierRadiusFor } from "../../../shared/crdt-schema.js";

function addWorld(doc: Y.Doc, id: string, x: number, solidified = false): void {
  const m = new Y.Map();
  doc.getMap("worlds").set(id, m);
  m.set("id", id);
  m.set("resolvedPosition.x", x);
  m.set("resolvedPosition.y", 0);
  m.set("resolvedPosition.z", 0);
  m.set("solidified", solidified);
  m.set("solidifiedAt", 0);
}

const flag = (doc: Y.Doc, id: string) => (doc.getMap("worlds").get(id) as Y.Map<unknown>).get("solidified");

test("founding gift ($1,000) reaches exactly 100 u", () => {
  assert.ok(insideFrontier({ x: 100, y: 0, z: 0 }, frontierRadiusFor(100_000)));
  assert.ok(!insideFrontier({ x: 100.5, y: 0, z: 0 }, frontierRadiusFor(100_000)));
  assert.ok(!insideFrontier({ x: 0, y: 0, z: 0 }, 0), "no Frontier before any money");
});

test("solidifies ghosts inside, leaves the Deep Dark alone, never reverses", () => {
  const doc = new Y.Doc();
  addWorld(doc, "near", 50);
  addWorld(doc, "edge", 99.9);
  addWorld(doc, "far", 400);
  addWorld(doc, "already", 10, true);
  addWorld(doc, ORIGIN_WORLD_ID, 0, true);

  const changed = solidifyWithinFrontier(doc, 100, 1234);
  assert.deepEqual(changed.sort(), ["edge", "near"]);
  assert.equal(flag(doc, "far"), false);
  assert.equal((doc.getMap("worlds").get("near") as Y.Map<unknown>).get("solidifiedAt"), 1234);

  assert.deepEqual(solidifyWithinFrontier(doc, 100), [], "idempotent");
  assert.deepEqual(solidifyWithinFrontier(doc, 50), [], "a smaller radius never un-solidifies");
  assert.equal(flag(doc, "near"), true);

  assert.deepEqual(solidifyWithinFrontier(doc, 500), ["far"]);
});

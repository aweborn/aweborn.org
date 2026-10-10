/**
 * Tests for world ID format + WebSocket room routing.
 * Run: node --test shared/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isWorldId, parseRoomPath } from "./crdt-schema.ts";

test("crypto.randomUUID() produces valid world IDs", () => {
  for (let i = 0; i < 1000; i++) assert.ok(isWorldId(randomUUID()));
});

test("isWorldId rejects legacy and malformed IDs", () => {
  assert.equal(isWorldId("k7x9m"), false); // legacy 5-char
  assert.equal(isWorldId("3F2B8C1E-7A4D-4E9B-9C2A-1D5E6F7A8B9C"), false); // uppercase
  assert.equal(isWorldId("3f2b8c1e-7a4d-1e9b-9c2a-1d5e6f7a8b9c"), false); // v1, not v4
  assert.equal(isWorldId("3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9"), false); // too short
  assert.equal(isWorldId(""), false);
});

test("parseRoomPath routes /world/<uuid>", () => {
  const id = randomUUID();
  assert.deepEqual(parseRoomPath(`/world/${id}`), { type: "world", id });
});

test("parseRoomPath routes /universe with sectors", () => {
  assert.deepEqual(parseRoomPath("/universe?sectors=0:0:0,1:0:0"), {
    type: "universe",
    id: "universe",
    sectors: ["0:0:0", "1:0:0"],
  });
});

test("parseRoomPath rejects unknown paths", () => {
  assert.equal(parseRoomPath("/w/abc"), null);
  assert.equal(parseRoomPath("/"), null);
});

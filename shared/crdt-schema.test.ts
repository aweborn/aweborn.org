/**
 * Tests for world ID format + WebSocket room routing.
 * Run: node --test shared/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  isWorldId,
  parseRoomPath,
  parseTeleportLink,
  ORIGIN_WORLD_ID,
  ORIGIN_WORLD_ENTRY,
} from "./crdt-schema.ts";

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

// Printed cards encode these URLs forever: this format must not change.
test("Origin has a permanent, valid world ID at (0,0,0)", () => {
  assert.equal(ORIGIN_WORLD_ID, "5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7");
  assert.ok(isWorldId(ORIGIN_WORLD_ID));
  assert.equal(ORIGIN_WORLD_ENTRY.id, ORIGIN_WORLD_ID);
  assert.deepEqual(ORIGIN_WORLD_ENTRY.resolvedPosition, { x: 0, y: 0, z: 0 });
  assert.equal(ORIGIN_WORLD_ENTRY.sector, "0:0:0");
});

test("parseTeleportLink: /w/<uuid> defaults to orbit", () => {
  const id = randomUUID();
  assert.deepEqual(parseTeleportLink(`/w/${id}`), { worldId: id, arrival: "orbit" });
  assert.deepEqual(parseTeleportLink(`/w/${id}/`), { worldId: id, arrival: "orbit" });
  assert.deepEqual(parseTeleportLink(`/w/${id}`, "?a=orbit"), { worldId: id, arrival: "orbit" });
  assert.deepEqual(parseTeleportLink(`/w/${id}`, "?a=bogus"), { worldId: id, arrival: "orbit" });
});

test("parseTeleportLink: ?a=in arrives inside", () => {
  const id = randomUUID();
  assert.deepEqual(parseTeleportLink(`/w/${id}`, "?a=in"), { worldId: id, arrival: "in" });
});

test("parseTeleportLink: uppercase IDs are normalized", () => {
  assert.deepEqual(parseTeleportLink(`/w/${ORIGIN_WORLD_ID.toUpperCase()}`), {
    worldId: ORIGIN_WORLD_ID,
    arrival: "orbit",
  });
});

test("parseTeleportLink: malformed IDs are flagged, other paths ignored", () => {
  assert.deepEqual(parseTeleportLink("/w/k7x9m"), { worldId: null, arrival: "orbit" });
  assert.deepEqual(parseTeleportLink("/w/%E0%A4%A"), { worldId: null, arrival: "orbit" });
  assert.deepEqual(parseTeleportLink("/w/"), { worldId: null, arrival: "orbit" });
  assert.equal(parseTeleportLink("/"), null);
  assert.equal(parseTeleportLink(`/world/${randomUUID()}`), null);
  assert.equal(parseTeleportLink(`/w/${randomUUID()}/extra`), null);
});

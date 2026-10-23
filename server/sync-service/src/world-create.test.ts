import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorldRequest, worldsLeftToday, WORLDS_PER_DAY } from "./world-create.js";
import { ORIGIN_WORLD_ID, type WorldEntry } from "../../../shared/crdt-schema.js";

const pos = { x: 1, y: 2, z: -3 };
const validParentId = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";

test("parseWorldRequest accepts a clean request", () => {
  assert.deepEqual(parseWorldRequest({ name: "  Moss Garden ", color: "#FF7B54", position: pos }), {
    name: "Moss Garden",
    color: "#ff7b54",
    position: pos,
  });
  assert.deepEqual(
    parseWorldRequest({ name: "Pocket Glade", color: "#5ac8fa", position: pos, parentWorldId: validParentId.toUpperCase() }),
    {
      name: "Pocket Glade",
      color: "#5ac8fa",
      position: pos,
      parentWorldId: validParentId,
    },
  );
});

test("parseWorldRequest refuses bad names, colours, positions and parentWorldIds", () => {
  const err = (b: unknown) => (parseWorldRequest(b) as { error?: string }).error;
  assert.equal(err({ name: "   ", color: "#ffffff", position: pos }), "bad_name");
  assert.equal(err({ name: "x".repeat(41), color: "#ffffff", position: pos }), "bad_name");
  assert.equal(err({ name: 7, color: "#ffffff", position: pos }), "bad_name");
  assert.equal(err({ name: "ok", color: "red", position: pos }), "bad_color");
  assert.equal(err({ name: "ok", color: "#ffffff", position: { x: 1, y: NaN, z: 0 } }), "bad_position");
  assert.equal(err({ name: "ok", color: "#ffffff", position: { x: 1e9, y: 0, z: 0 } }), "bad_position");
  assert.equal(err({ name: "ok", color: "#ffffff", position: pos, parentWorldId: "not-a-uuid" }), "bad_parent");
  assert.equal(err({ name: "ok", color: "#ffffff", position: pos, parentWorldId: ORIGIN_WORLD_ID }), "bad_parent");
  assert.equal(err({ name: "ok", color: "#ffffff", position: { x: 500, y: 0, z: 0 }, parentWorldId: validParentId }), "bad_position");
  assert.equal(err(null), "bad_name");
});

test("worldsLeftToday counts only this player's worlds from the last 24 h", () => {
  const now = 10 * 24 * 3600_000;
  const w = (creator: string, ago: number) => ({ creator, createdAt: now - ago }) as WorldEntry;
  const worlds = [w("me", 1000), w("me", 23 * 3600_000), w("me", 25 * 3600_000), w("you", 10)];
  assert.equal(worldsLeftToday(worlds, "me", now), WORLDS_PER_DAY - 2);
  assert.equal(worldsLeftToday([w("me", 1), w("me", 2), w("me", 3), w("me", 4)], "me", now), 0);
});

/** 9F: the action catalog stays in step with the server (routes and socket messages). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ACTIONS, WS_TRANSPORT, ACTOR_TIERS, meetsTier, actionsForWs, type ActionDef } from "./actions.js";

const SRC = new URL("../server/sync-service/src/", import.meta.url);
const server = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => readFileSync(new URL(f, SRC), "utf8")).join("\n");
const rooms = readFileSync(new URL("rooms.ts", SRC), "utf8");
const msgTypes = [...rooms.slice(rooms.indexOf("MSG_TYPES: Record"), rooms.indexOf("MSG_TYPE_NAMES")).matchAll(/"([a-z-]+)":\s*0x/g)].map((m) => m[1]);

test("every HTTP route in the catalog exists in the server", () => {
  for (const [id, a] of Object.entries(ACTIONS) as [string, ActionDef][]) {
    if (!a.via || !("http" in a.via)) continue;
    const path = a.via.http.split(" ")[1];
    assert.ok(server.includes(`"${path}"`), `${id}: ${path} not found in server/sync-service/src`);
  }
});

test("every socket message type is in the catalog or marked transport, and vice versa", () => {
  assert.ok(msgTypes.length >= 15);
  for (const t of msgTypes) {
    assert.ok((WS_TRANSPORT as readonly string[]).includes(t) || actionsForWs(t).length > 0, `rooms.ts message "${t}" has no catalog entry`);
  }
  for (const [id, a] of Object.entries(ACTIONS) as [string, ActionDef][]) {
    if (a.via && "ws" in a.via) assert.ok(msgTypes.includes(a.via.ws), `${id}: socket message "${a.via.ws}" not in rooms.ts`);
  }
});

test("tiers order: each tier needs at least what the weaker one does", () => {
  assert.equal(ACTOR_TIERS[0], "any_session");
  assert.equal(meetsTier("any_session", { session: true, saved: false }), true);
  assert.equal(meetsTier("saved", { session: true, saved: false }), false);
  assert.equal(meetsTier("world_creator", { session: true, saved: false, owner: true }), true);
  assert.equal(meetsTier("admin_inflow", { session: false, saved: false, inflow: true }), true);
  assert.equal(meetsTier("admin", { session: true, saved: true, inflow: true }), false);
});

test("offline-capable actions never need money or an admin", () => {
  for (const [id, a] of Object.entries(ACTIONS) as [string, ActionDef][]) {
    if (a.offline) assert.ok(a.tier === "any_session" || a.tier === "world_creator", id);
  }
});

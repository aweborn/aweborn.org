import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { WorldAuthority, CreateLimiter } from "./world-authority.js";
import type { WorldActor } from "../../../shared/world-policy.js";
import { TERRAIN_EDITS_MAP, TERRAIN_EDIT_LIMITS } from "../../../shared/terrain-edits.js";

const ALICE = "char-alice"; // world creator
const BOB = "char-bob"; // another signed-in player
const alice: WorldActor = { id: ALICE, owner: true };
const bob: WorldActor = { id: BOB, owner: false };
const guest: WorldActor = { id: null, owner: false };

function addObject(doc: Y.Doc, id: string, placedBy: string, extra: Record<string, unknown> = {}): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    const base = { id, type: "block", x: 0, y: 1, z: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "stone", placedBy, placedAt: 1 };
    for (const [k, v] of Object.entries({ ...base, ...extra })) m.set(k, v);
    doc.getMap("objects").set(id, m);
  });
}

/** A server doc + authority and one client doc kept in sync (client → server via the authority, server → client always). */
function setup() {
  const server = new Y.Doc();
  server.getMap("meta").set("creator", ALICE);
  server.getMap("meta").set("name", "Garden");
  server.getMap("terrain").set("seed", 7);
  addObject(server, "a1", ALICE);
  addObject(server, "b1", BOB);
  const authority = new WorldAuthority(server);
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  // Server → client relay (everything the server applies, including reverts)
  server.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "client") Y.applyUpdate(client, u, "server");
  });
  /** Run `edit` on the client and send the resulting update through the authority as `actor`. */
  const act = (actor: WorldActor, edit: (doc: Y.Doc) => void, allowCreate?: () => boolean) => {
    const updates: Uint8Array[] = [];
    const h = (u: Uint8Array, origin: unknown) => {
      if (origin !== "server") updates.push(u);
    };
    client.on("update", h);
    edit(client);
    client.off("update", h);
    let reverted = 0;
    for (const u of updates) reverted += authority.apply(u, "client", actor, allowCreate).reverted;
    return reverted;
  };
  const obj = (doc: Y.Doc, id: string) => (doc.getMap("objects").get(id) as Y.Map<unknown> | undefined)?.toJSON();
  return { server, client, authority, act, obj };
}

test("a guest can't delete someone else's object; it comes back on their screen too", () => {
  const { server, client, act, obj } = setup();
  assert.equal(act(guest, (d) => d.getMap("objects").delete("b1")), 1);
  assert.equal(obj(server, "b1")?.placedBy, BOB);
  assert.equal(obj(client, "b1")?.placedBy, BOB);
});

test("a placer may move and delete their own object", () => {
  const { server, act, obj } = setup();
  assert.equal(act(bob, (d) => (d.getMap("objects").get("b1") as Y.Map<unknown>).set("x", 5)), 0);
  assert.equal(obj(server, "b1")?.x, 5);
  assert.equal(act(bob, (d) => d.getMap("objects").delete("b1")), 0);
  assert.equal(obj(server, "b1"), undefined);
});

test("a non-owner can't move someone else's object (snaps back)", () => {
  const { server, client, act, obj } = setup();
  assert.equal(act(bob, (d) => (d.getMap("objects").get("a1") as Y.Map<unknown>).set("x", 9)), 1);
  assert.equal(obj(server, "a1")?.x, 0);
  assert.equal(obj(client, "a1")?.x, 0);
});

test("the creator may change anyone's object", () => {
  const { server, act, obj } = setup();
  assert.equal(act(alice, (d) => d.getMap("objects").delete("b1")), 0);
  assert.equal(obj(server, "b1"), undefined);
});

test("anyone may kick, and settle a kick nearby; a far 'settle' is refused", () => {
  const { server, act, obj } = setup();
  const a1 = (d: Y.Doc) => d.getMap("objects").get("a1") as Y.Map<unknown>;
  assert.equal(act(guest, (d) => a1(d).set("kick", { vx: 7, vy: 3, vz: 0, t: 1 })), 0);
  assert.deepEqual(obj(server, "a1")?.kick, { vx: 7, vy: 3, vz: 0, t: 1 });
  assert.equal(act(guest, (d) => d.transact(() => { a1(d).set("x", 12); a1(d).delete("kick"); })), 0);
  assert.equal(obj(server, "a1")?.x, 12);
  // A new kick, then a teleport disguised as a settle
  act(bob, (d) => a1(d).set("kick", { vx: 1, vy: 1, vz: 0, t: 2 }));
  assert.equal(act(bob, (d) => d.transact(() => { a1(d).set("x", 500); a1(d).delete("kick"); })), 1);
  assert.equal(obj(server, "a1")?.x, 12);
});

test("a too-fast kick is refused", () => {
  const { server, act, obj } = setup();
  assert.equal(act(bob, (d) => (d.getMap("objects").get("a1") as Y.Map<unknown>).set("kick", { vx: 400, vy: 0, vz: 0, t: 1 })), 1);
  assert.equal(obj(server, "a1")?.kick, undefined);
});

test("placing as yourself is fine; placing as someone else is refused", () => {
  const { server, act, obj } = setup();
  assert.equal(act(bob, (d) => addObject(d, "b2", BOB)), 0);
  assert.equal(obj(server, "b2")?.placedBy, BOB);
  assert.equal(act(bob, (d) => addObject(d, "fake", ALICE)), 1);
  assert.equal(obj(server, "fake"), undefined);
  assert.equal(act(guest, (d) => addObject(d, "g1", "guest-abc")), 0);
  assert.equal(act(guest, (d) => addObject(d, "g2", BOB)), 1);
});

test("nobody rewrites placedBy, and giant objects are refused", () => {
  const { server, act, obj } = setup();
  assert.equal(act(bob, (d) => (d.getMap("objects").get("b1") as Y.Map<unknown>).set("placedBy", ALICE)), 1);
  assert.equal(obj(server, "b1")?.placedBy, BOB);
  assert.equal(act(bob, (d) => addObject(d, "huge", BOB, { scaleX: 5000 })), 1);
  assert.equal(obj(server, "huge"), undefined);
});

test("terrain, sky and physics: creator only; meta.creator: server only", () => {
  const { server, client, act } = setup();
  assert.equal(act(bob, (d) => d.getMap("terrain").set("voxel", "{}")), 1);
  assert.equal(server.getMap("terrain").get("voxel"), undefined);
  assert.equal(client.getMap("terrain").get("voxel"), undefined);
  assert.equal(act(bob, (d) => d.getMap("physics").set("gravityY", 50)), 1);
  assert.equal(act(alice, (d) => d.getMap("terrain").set("voxel", "{}")), 0);
  assert.equal(server.getMap("terrain").get("voxel"), "{}");
  assert.equal(act(alice, (d) => d.getMap("meta").set("creator", BOB)), 1);
  assert.equal(server.getMap("meta").get("creator"), ALICE);
});

test("writing the same value back (cold-start meta fill) is not a violation", () => {
  const { act } = setup();
  assert.equal(act(guest, (d) => d.getMap("meta").set("name", "Garden")), 0);
});

test("server-side writes between client updates are accepted as the new baseline", () => {
  const { server, act, obj } = setup();
  server.transact(() => server.getMap("meta").set("coCreators", [BOB]), "server");
  addObject(server, "srv", ALICE);
  // Bob still isn't an owner by actor flag, so moving Alice's new object is refused, and srv stays.
  assert.equal(act(bob, (d) => (d.getMap("objects").get("srv") as Y.Map<unknown>).set("x", 3)), 1);
  assert.equal(obj(server, "srv")?.x, 0);
});

test("create budget: once exhausted, new objects are reverted", () => {
  const { server, act, obj } = setup();
  let left = 1;
  const allow = () => left-- > 0;
  assert.equal(act(bob, (d) => addObject(d, "c1", BOB), allow), 0);
  assert.equal(act(bob, (d) => addObject(d, "c2", BOB), allow), 1);
  assert.ok(obj(server, "c1"));
  assert.equal(obj(server, "c2"), undefined);
});

test("CreateLimiter: sliding window", () => {
  const lim = new CreateLimiter<object>(2, 1000);
  const k = {};
  assert.ok(lim.take(k, 0));
  assert.ok(lim.take(k, 10));
  assert.ok(!lim.take(k, 20));
  assert.ok(lim.take(k, 1500));
});

// ── Terrain edits (M5d) ──
const edits = (d: Y.Doc) => d.getMap(TERRAIN_EDITS_MAP);

test("terrain edits: the creator digs and fills; a non-owner's dig snaps back for everyone", () => {
  const { server, client, act } = setup();
  assert.equal(act(alice, (d) => edits(d).set("10,3,10", 0)), 0);
  assert.equal(act(alice, (d) => edits(d).set("11,4,10", 2)), 0);
  assert.equal(edits(server).get("10,3,10"), 0);
  assert.equal(act(bob, (d) => edits(d).set("12,3,10", 0)), 1);
  assert.equal(act(guest, (d) => edits(d).delete("10,3,10")), 1);
  assert.equal(edits(server).has("12,3,10"), false);
  assert.equal(edits(client).has("12,3,10"), false);
  assert.equal(edits(client).get("10,3,10"), 0);
});

test("terrain edits: bad keys and values are refused, even from the owner", () => {
  const { server, act } = setup();
  assert.equal(act(alice, (d) => edits(d).set("10,0,10", 0)), 1); // the floor
  assert.equal(act(alice, (d) => edits(d).set("nope", 0)), 1);
  assert.equal(act(alice, (d) => edits(d).set("10,3,10", 99)), 1);
  assert.equal(act(alice, (d) => edits(d).set("10,3,10", "x")), 1);
  assert.equal(edits(server).size, 0);
});

test("terrain edits: at most maxPerUpdate cells per update; owner deletes always pass", () => {
  const { server, act } = setup();
  const n = TERRAIN_EDIT_LIMITS.maxPerUpdate + 6;
  assert.equal(act(alice, (d) => d.transact(() => { for (let i = 0; i < n; i++) edits(d).set(`${i},2,5`, 0); })), 6);
  assert.equal(edits(server).size, TERRAIN_EDIT_LIMITS.maxPerUpdate);
  assert.equal(act(alice, (d) => d.transact(() => edits(d).clear())), 0);
  assert.equal(edits(server).size, 0);
});


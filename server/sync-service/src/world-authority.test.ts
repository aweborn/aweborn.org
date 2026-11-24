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


test("collision nudge (M7c): a new object on another player's spot slides to a free one, everywhere", () => {
  const { server, client, act, obj } = setup();
  // a1 (Alice) and b1 (Bob) both sit at (0, 1, 0); Bob places another block there: b1 is his own, a1 isn't
  assert.equal(act(bob, (d) => addObject(d, "b2", BOB)), 0);
  const s = obj(server, "b2") as Record<string, unknown>;
  assert.equal(Math.round(Math.hypot(s.x as number, s.z as number) * 100) / 100, 1);
  assert.deepEqual({ fx: (s.nudge as { fx: number }).fx, fz: (s.nudge as { fz: number }).fz }, { fx: 0, fz: 0 });
  assert.equal((obj(client, "b2") as Record<string, unknown>).x, s.x, "the placer sees it move too");
  // A block next to someone else's (not the same spot) stays put
  assert.equal(act(bob, (d) => addObject(d, "b3", BOB, { x: -1 })), 0);
  assert.equal(obj(server, "b3")?.x, -1);
  assert.equal(obj(server, "b3")?.nudge, undefined);
});

test("a creation's mind is server-only: owners can't set, change or copy it, but may still delete the object", () => {
  const { server, act, obj } = setup();
  // Server gives a1 a mind (minds.ts)
  server.transact(() => (server.getMap("objects").get("a1") as Y.Map<unknown>).set("mind", { name: "Kal", voice: "brian", size: "giant", spoken: true }), "server");
  // Even the creator can't rewrite it…
  assert.equal(act(alice, (d) => (d.getMap("objects").get("a1") as Y.Map<unknown>).set("mind", { name: "Evil", voice: "bill", size: "human", spoken: true })), 1);
  assert.equal((obj(server, "a1")?.mind as { name: string }).name, "Kal");
  // …or create (duplicate) an object carrying one
  assert.equal(act(alice, (d) => addObject(d, "dup", ALICE, { mind: { name: "Kal" } })), 1);
  assert.equal(obj(server, "dup"), undefined);
  // …but life settings stay theirs, and so does deleting it
  assert.equal(act(alice, (d) => (d.getMap("objects").get("a1") as Y.Map<unknown>).set("life", { mode: "alive", pace: 0.6, roam: 4 })), 0);
  assert.equal(act(alice, (d) => d.getMap("objects").delete("a1")), 0);
  assert.equal(obj(server, "a1"), undefined);
});

test("a sound keeps the words it was made from: nobody rewrites its prompt or file, but it still moves, copies and deletes", () => {
  const { server, act, obj } = setup();
  const sound = { type: "sound", asset: "a".repeat(64) + ".mp3", prompt: "waves on pebbles", media: "sound", loop: true, volume: 0.8 };
  assert.equal(act(bob, (d) => addObject(d, "s1", BOB, sound)), 0);
  const s1 = (d: Y.Doc) => d.getMap("objects").get("s1") as Y.Map<unknown>;
  // Not the placer, not the world's creator, not by changing what it is
  assert.equal(act(bob, (d) => s1(d).set("prompt", "something else")), 1);
  assert.equal(act(alice, (d) => s1(d).set("prompt", "something else")), 1);
  assert.equal(act(bob, (d) => s1(d).set("asset", "b".repeat(64) + ".mp3")), 1);
  assert.equal(act(bob, (d) => s1(d).set("type", "block")), 1);
  assert.equal(obj(server, "s1")?.prompt, "waves on pebbles");
  assert.equal(obj(server, "s1")?.type, "sound");
  // …but its placer may carry it, copy it (words and all) and delete it
  assert.equal(act(bob, (d) => s1(d).set("x", 4)), 0);
  assert.equal(act(bob, (d) => addObject(d, "s2", BOB, { ...sound, x: 6 })), 0);
  assert.equal(obj(server, "s2")?.prompt, "waves on pebbles");
  assert.equal(act(bob, (d) => d.getMap("objects").delete("s1")), 0);
  assert.equal(obj(server, "s1"), undefined);
});

test("a sign's words must be ones the server checked; old signs stay movable and copyable", async () => {
  const { approveText } = await import("./approved-text.js");
  const { server, act, obj } = setup();
  // Made up by a client, never through /api/player/lore: reverted
  assert.equal(act(bob, (d) => addObject(d, "s1", BOB, { type: "sign", text: "words nobody checked", prompt: "x" })), 1);
  assert.equal(obj(server, "s1"), undefined);
  // Lore that passed the check: placed
  approveText("A lantern that remembers every traveller.", { persist: false });
  assert.equal(act(bob, (d) => addObject(d, "s2", BOB, { type: "sign", text: "A lantern that remembers every traveller.", prompt: "lantern" })), 0);
  assert.equal(obj(server, "s2")?.text, "A lantern that remembers every traveller.");
  // A sign already in a world when it loads is grandfathered: a copy of it is fine
  const s = new Y.Doc();
  addObject(s, "old", ALICE, { type: "sign", text: "An old sign from before the check." });
  new WorldAuthority(s);
  const { act: act2, obj: obj2, server: server2 } = setup();
  assert.equal(act2(bob, (d) => addObject(d, "copy", BOB, { type: "sign", text: "An old sign from before the check." })), 0);
  assert.equal(obj2(server2, "copy")?.type, "sign");
});

test("the stage (Phase 10): the arena's spot is the owners' alone, and nobody writes meta.game through the doc", () => {
  const { server, client, act, obj } = setup();
  // Alice's own client can't set the game in the doc (the server writes it after POST /api/player/world/game)
  assert.equal(act(alice, (d) => d.getMap("meta").set("game", { template: "race", arena: { at: [50, 0, 50], size: [10, 10, 10] } })), 1);
  assert.equal(server.getMap("meta").get("game"), undefined);
  assert.equal(client.getMap("meta").get("game"), undefined);
  // The server writes it: the stage is x/z 45..55, y 0..10
  server.transact(() => server.getMap("meta").set("game", { template: "race", arena: { at: [50, 0, 50], size: [10, 10, 10] } }), "server");
  addObject(server, "prop", ALICE, { x: 50, z: 50 });

  assert.equal(act(bob, (d) => addObject(d, "b2", BOB, { x: 50, z: 50 })), 1);
  assert.equal(obj(server, "b2"), undefined);
  assert.equal(act(bob, (d) => addObject(d, "b3", BOB, { x: 20, z: 20 })), 0);
  // Bob's own thing, carried onto the stage: back where it was
  assert.equal(act(bob, (d) => d.transact(() => { const m = d.getMap("objects").get("b3") as Y.Map<unknown>; m.set("x", 50); m.set("z", 50); })), 1);
  assert.equal(obj(server, "b3")?.x, 20);
  // Kicking or removing what's on the stage
  assert.equal(act(bob, (d) => (d.getMap("objects").get("prop") as Y.Map<unknown>).set("kick", { vx: 1, vy: 2, vz: 0, t: 5 })), 1);
  assert.equal(act(guest, (d) => d.getMap("objects").delete("prop")), 1);
  assert.equal(obj(client, "prop")?.placedBy, ALICE);
  // The owners work there freely
  assert.equal(act(alice, (d) => addObject(d, "a2", ALICE, { x: 51, z: 51 })), 0);
  assert.equal(act(alice, (d) => (d.getMap("objects").get("prop") as Y.Map<unknown>).set("x", 52)), 0);
  // The game goes away: the spot is open again
  server.transact(() => server.getMap("meta").delete("game"), "server");
  assert.equal(act(bob, (d) => addObject(d, "b4", BOB, { x: 50, z: 50 })), 0);
});

// ── The ground under a running match (Phase 10, shared/arena.ts) ──

test("terrain lock: while a match runs, nobody digs under its arena or reshapes the ground, owners included", () => {
  const { server, client, authority } = setup();
  const ground = (seed: number) => JSON.stringify({ size: [64, 32, 64], seed, blocks: [] });
  server.getMap("terrain").set("voxel", ground(1));
  edits(server).set("32,2,32", 0); // dug before the match
  edits(server).set("5,2,5", 0);
  // The arena: x -10..10, z -18..2 → cells 22..41 by 14..33 (plus the margin)
  const lock = { minX: -11, maxX: 11, minY: -Infinity, maxY: 11, minZ: -19, maxZ: 3 };
  const act = (edit: (doc: Y.Doc) => void, locks = [lock]) => {
    const updates: Uint8Array[] = [];
    const h = (u: Uint8Array, origin: unknown) => { if (origin !== "server") updates.push(u); };
    client.on("update", h);
    edit(client);
    client.off("update", h);
    let reverted = 0, locked = 0;
    for (const u of updates) { const r = authority.apply(u, "client", alice, undefined, locks); reverted += r.reverted; locked += r.locked; }
    return { reverted, locked };
  };
  // Inside the arena's columns: refused, and the owner's screen snaps back
  assert.deepEqual(act((d) => edits(d).set("30,3,30", 0)), { reverted: 1, locked: 1 });
  assert.equal(edits(server).has("30,3,30"), false);
  assert.equal(edits(client).has("30,3,30"), false);
  // Filling a hole back in there is a change too
  assert.deepEqual(act((d) => edits(d).delete("32,2,32")), { reverted: 1, locked: 1 });
  assert.equal(edits(client).get("32,2,32"), 0);
  // Outside the arena the owner digs as always
  assert.deepEqual(act((d) => edits(d).set("6,2,6", 0)), { reverted: 0, locked: 0 });
  assert.equal(edits(server).get("6,2,6"), 0);
  // A new ground for the whole world: refused, and the edits it would have cleared stay
  const reshape = act((d) => d.transact(() => { d.getMap("terrain").set("voxel", ground(2)); edits(d).clear(); }));
  assert.ok(reshape.locked >= 1);
  assert.equal(server.getMap("terrain").get("voxel"), ground(1));
  assert.equal(client.getMap("terrain").get("voxel"), ground(1));
  assert.deepEqual([...edits(server).keys()].sort(), ["32,2,32", "5,2,5", "6,2,6"]);
  assert.deepEqual([...edits(client).keys()].sort(), ["32,2,32", "5,2,5", "6,2,6"]);
  // The match is over: all of it is allowed again
  assert.deepEqual(act((d) => edits(d).set("30,3,30", 0), []), { reverted: 0, locked: 0 });
  assert.deepEqual(act((d) => d.getMap("terrain").set("voxel", ground(2)), []), { reverted: 0, locked: 0 });
  assert.equal(server.getMap("terrain").get("voxel"), ground(2));
});

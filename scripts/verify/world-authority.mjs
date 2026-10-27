#!/usr/bin/env node
/**
 * Live check of the world write authority (Rough Draft M1, 2026-10-27).
 *
 * Connects as a GUEST (no session) on the real binary protocol, joins a world,
 * and tries two forbidden edits: renaming the world (meta) and, if the world
 * has objects, deleting one it didn't place. Passes if the server puts both
 * back. Leaves nothing behind (only forbidden edits are attempted, and the
 * server reverts them).
 *
 *   node scripts/verify/world-authority.mjs [--url https://sync.aweborn.org] [--origin https://aweborn.org] [--world <uuid>]
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(repo, "server/sync-service/package.json"));
const WebSocket = require("ws");
const Y = require("yjs");

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "https://sync.aweborn.org");
const origin = arg("origin", "https://aweborn.org");
const ORIGIN_ID = "5949dfc5-3a9b-46b7-a2c8-ad19323c5fa7";
const T = { universeSync: 0x01, universeUpdate: 0x02, worldSync: 0x03, worldUpdate: 0x04, joinWorld: 0x07 };

function encode(type, data, worldId) {
  const w = worldId ? Buffer.from(worldId) : Buffer.alloc(0);
  const buf = Buffer.alloc(3 + w.length + data.length);
  buf[0] = type;
  buf.writeUInt16BE(w.length, 1);
  w.copy(buf, 3);
  Buffer.from(data).copy(buf, 3 + w.length);
  return buf;
}
function decode(buf) {
  const wl = buf.readUInt16BE(1);
  return { type: buf[0], worldId: buf.subarray(3, 3 + wl).toString(), data: new Uint8Array(buf.subarray(3 + wl)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const universe = new Y.Doc();
const world = new Y.Doc();
let worldId = arg("world", null);
let worldSynced = false;

const ws = new WebSocket(url.replace(/^http/, "ws") + "/universe?sectors=0%2C0%2C0", { headers: { origin } });
ws.binaryType = "nodebuffer";
ws.on("message", (buf) => {
  const m = decode(buf);
  if (m.type === T.universeSync || m.type === T.universeUpdate) Y.applyUpdate(universe, m.data, "server");
  if ((m.type === T.worldSync || m.type === T.worldUpdate) && m.worldId === worldId) {
    Y.applyUpdate(world, m.data, "server");
    if (m.type === T.worldSync) worldSynced = true;
  }
});
await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});
for (let i = 0; i < 50 && universe.getMap("worlds").size === 0; i++) await sleep(100);

if (!worldId) {
  const ids = [...universe.getMap("worlds").keys()].filter((id) => id !== ORIGIN_ID);
  if (!ids.length) throw new Error("no worlds in the universe");
  worldId = ids[0];
}
ws.send(encode(T.joinWorld, Buffer.alloc(0), worldId));
for (let i = 0; i < 50 && !worldSynced; i++) await sleep(100);
if (!worldSynced) throw new Error("world-sync never arrived");

const meta = world.getMap("meta");
const objects = world.getMap("objects");
const name = meta.get("name");
const victim = [...objects.entries()].find(([, v]) => {
  const placedBy = v instanceof Y.Map ? v.get("placedBy") : v?.placedBy;
  return typeof placedBy === "string" && !placedBy.startsWith("guest");
});
console.log(`[verify] world ${worldId} "${name}", ${objects.size} objects${victim ? `, victim ${victim[0]}` : ""}`);

// Forbidden edits, sent as one client update
const updates = [];
world.on("update", (u, o) => o !== "server" && updates.push(u));
world.transact(() => {
  meta.set("name", "GRIEFED BY A GUEST");
  if (victim) objects.delete(victim[0]);
});
for (const u of updates) ws.send(encode(T.worldUpdate, u, worldId));
await sleep(2500);

const nameOk = meta.get("name") === name;
const objOk = victim ? objects.has(victim[0]) : true;
console.log(`[verify] rename reverted: ${nameOk ? "PASS" : "FAIL"} (now "${meta.get("name")}")`);
if (victim) console.log(`[verify] delete reverted: ${objOk ? "PASS" : "FAIL"}`);
if (!nameOk || !objOk) {
  // The server accepted grief: put things back ourselves so prod isn't left broken.
  const fix = [];
  world.on("update", (u, o) => o === "restore" && fix.push(u));
  world.transact(() => {
    if (!nameOk) meta.set("name", name);
    if (!objOk) objects.set(victim[0], victim[1] instanceof Y.Map ? victim[1].clone() : victim[1]);
  }, "restore");
  for (const u of fix) ws.send(encode(T.worldUpdate, u, worldId));
  await sleep(1500);
  console.log("[verify] restored the original state");
}
ws.close();
process.exit(nameOk && objOk ? 0 : 1);

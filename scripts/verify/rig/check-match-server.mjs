// Rig check for the sync-service's game layer (Phase 10), no browser: three players over
// real sockets and HTTP against the rig's server (scripts/verify/rig/up.sh first).
//   RIG_N=2 node scripts/verify/rig/check-match-server.mjs
// Plants a world, saves a race, queues two players through the ready check, plays the
// race to the goal, then checks the record, the lists, a live record, and the game Library.
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { verifyRecord } from "../../../shared/match.ts";

const require = createRequire(new URL("../../../server/sync-service/package.json", import.meta.url));
const WebSocket = require("ws");
const N = Number(process.env.RIG_N ?? 0);
const HTTP = `http://localhost:${1234 + 10 * N}`;
const ORIGIN = `http://localhost:${5173 + 10 * N}`;
const DB = `/tmp/rig${N}/universe.db`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { "join-world": 0x07, "leave-world": 0x08, presence: 0x09, match: 0x13 };

async function player(name) {
  const r = await fetch(`${HTTP}/api/auth/sign-in/anonymous`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{}" });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const api = async (path, body) => {
    const res = await fetch(HTTP + path, { method: body ? "POST" : "GET", headers: { Origin: ORIGIN, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const id = (await api("/api/player/me")).data?.playerId;
  assert.ok(id, `${name}: no session`);
  const p = { name, id, api, cookie, msgs: [], ws: null, world: null, pos: { x: 0, y: 0, z: 0 } };
  p.save = () => { const db = new DatabaseSync(DB); db.prepare(`UPDATE "user" SET isAnonymous = 0 WHERE playerId = ?`).run(id); db.close(); };
  p.send = (type, worldId, data) => {
    const w = new TextEncoder().encode(worldId ?? "");
    const d = typeof data === "string" ? new TextEncoder().encode(data) : (data ?? new Uint8Array(0));
    const buf = new Uint8Array(3 + w.length + d.length);
    buf[0] = TYPES[type]; buf[1] = w.length >> 8; buf[2] = w.length & 0xff; buf.set(w, 3); buf.set(d, 3 + w.length);
    p.ws.send(buf);
  };
  p.connect = () => new Promise((resolve, reject) => {
    p.ws = new WebSocket(`${HTTP.replace("http", "ws")}/universe?sectors=`, { headers: { Cookie: cookie, Origin: ORIGIN } });
    p.ws.on("open", resolve);
    p.ws.on("error", reject);
    p.ws.on("message", (raw) => {
      const b = new Uint8Array(raw);
      const len = (b[1] << 8) | b[2];
      if (b[0] === 0x13) p.msgs.push(JSON.parse(new TextDecoder().decode(b.subarray(3 + len))));
      if (b[0] === 0x0b) p.seen = JSON.parse(new TextDecoder().decode(b.subarray(3 + len))).map((x) => x.id ?? x.playerId ?? "?");
    });
  });
  p.enter = (worldId, at) => { p.world = worldId; p.pos = at; p.send("join-world", worldId); p.match({ t: "hello" }); };
  p.match = (intent) => p.send("match", p.world, JSON.stringify(intent));
  p.last = (t) => p.msgs.filter((m) => m.t === t).at(-1);
  // Presence ten times a second, like the client
  p.timer = setInterval(() => {
    if (p.ws?.readyState === 1 && p.world) p.send("presence", null, JSON.stringify({ id: p.id, playerId: p.id, position: p.pos, inWorld: p.world }));
  }, 100);
  return p;
}
const until = async (what, fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out waiting for ${what}`);
};

const owner = await player("owner"), ann = await player("ann"), ben = await player("ben");
owner.save();
const planted = await owner.api("/api/player/world", { name: "Match Rig", color: "#336699", position: { x: 300, y: 0, z: 300 } });
assert.equal(planted.status, 200, JSON.stringify(planted.data));
const W = planted.data.world.id;
const game = {
  template: "race", settings: { teams: 2, players: { min: 2, max: 4 } },
  arena: { at: [0, 0, 0], size: [40, 20, 40] },
  zones: [
    { id: "s1", kind: "spawn", team: 1, at: [-15, 0, 0], size: [4, 3, 4] },
    { id: "s2", kind: "spawn", team: 2, at: [15, 0, 0], size: [4, 3, 4] },
    { id: "goal", kind: "goal", at: [0, 0, 15], size: [4, 3, 4] },
  ],
  lobby: { at: [0, 30, 0], size: [12, 6, 12], ring: { at: [0, 30, 0], radius: 2 }, arrival: [0, 30, 3] },
  npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }],
};
const saved = await owner.api("/api/player/world/game", { worldId: W, game });
assert.equal(saved.status, 200, JSON.stringify(saved.data));
console.log("world", W, "game v" + saved.data.game.version);

for (const p of [owner, ann, ben]) await p.connect();
owner.enter(W, { x: 4, y: 30, z: 4 });
ann.enter(W, { x: 0, y: 30, z: 0 });
ben.enter(W, { x: 1, y: 30, z: 0 });
const lobby = await until("lobby", () => ann.last("lobby"));
assert.deepEqual([lobby.ready, lobby.gameVersion, lobby.pool], [true, 1, 0]);
await sleep(500);
ann.match({ t: "queue", on: true });
ben.match({ t: "queue", on: true });
const found = await until("found", () => ann.last("found"));
console.log("found", found.matchId, "roster", found.roster.map((s) => `${s.name}:t${s.team}`).join(" "));
owner.match({ t: "host", cmd: "start" }); // the owner starts early instead of waiting out the ready check
const start = await until("start", () => ann.last("start"));
const benStart = await until("ben's start", () => ben.last("start"));
const id = start.matchId;
ann.pos = { x: start.spawn[0], y: start.spawn[1], z: start.spawn[2] };
ben.pos = { x: benStart.spawn[0], y: benStart.spawn[1], z: benStart.spawn[2] };
owner.match({ t: "watch", matchId: id });
await until("playing", () => ann.last("snap")?.phase === "playing", 15000);
// The instance is a presence partition: the players see each other, the owner in the lobby sees neither
ann.seen = ben.seen = owner.seen = null;
ben.pos = { ...ben.pos, z: ben.pos.z + 0.5 };
await sleep(600);
console.log("presence: ann sees", ann.seen, "| owner (lobby) sees", owner.seen);
assert.ok(ann.seen?.includes(ben.id), "ann sees ben in the instance");
assert.ok(!owner.seen || (!owner.seen.includes(ann.id) && !owner.seen.includes(ben.id)), "the lobby doesn't see the instance");
assert.ok(owner.last("snap"), "the watcher gets snaps");
assert.equal(ann.last("snap").watching, 1);
// A live record (for watchers): roster, ticks so far, no result
const live = await owner.api(`/api/match/record?id=${id}`);
assert.equal(live.status, 200);
assert.deepEqual([live.data.record.result, live.data.record.setup.slots.length, live.data.record.frames.length > 10], [null, 2, true]);
// Ann walks to the goal
const from = { ...ann.pos };
for (let i = 1; i <= 15 && !ann.last("end"); i++) { ann.pos = { x: from.x + ((0 - from.x) * i) / 15, y: 0.5, z: (15 * i) / 15 }; await sleep(150); }
const end = await until("end", () => ann.last("end"));
console.log("end: winner team", end.result.winner, "why", end.result.why, "awe", end.awe, "| watcher got end:", !!owner.last("end"));
assert.equal(end.result.winner, start.you.team);
assert.ok(end.awe > 0);
ann.match({ t: "again", yes: false });
ben.match({ t: "again", yes: false });
const back = await until("back", () => ann.last("back"));
assert.deepEqual(back.to, [0, 30, 3]);

const rec = (await ann.api(`/api/match/record?id=${id}`)).data.record;
assert.ok(rec.endedAt && rec.result);
assert.equal(verifyRecord(rec), true);
console.log("record:", rec.frames.length, "frames,", rec.events.length, "events, verifies:", verifyRecord(rec));
const world = (await ben.api(`/api/match/world?worldId=${W}`)).data.matches;
assert.deepEqual([world.length, world[0].id, world[0].worldName, world[0].winner], [1, id, "Match Rig", end.result.winner]);
const replays = (await ann.api("/api/player/replays")).data.matches;
assert.deepEqual([replays.length, replays[0].roster.filter((r) => r.you).length], [1, 1]);
assert.equal((await owner.api("/api/player/replays")).data.matches.length, 0);
assert.equal((await ann.api("/api/match/record?id=nope")).status, 404);
const xp = (await ann.api("/api/player/progress")).data;
console.log("lists ok; ann's progress:", JSON.stringify(xp?.progress?.xp ?? xp?.xp ?? xp).slice(0, 80));

// The game Library: save (owner only), list, bring into a second world
assert.equal((await ann.api("/api/player/game-library", { worldId: W, name: "Rig Race" })).status, 403);
const lib = await owner.api("/api/player/game-library", { worldId: W, name: "Rig Race" });
assert.equal(lib.status, 200, JSON.stringify(lib.data));
await sleep(200);
const list = (await ann.api("/api/player/game-library")).data.games;
assert.deepEqual([list.length, list[0].name, list[0].mine, list[0].version], [1, "Rig Race", false, 1]);
assert.equal((await owner.api("/api/player/game-library")).data.games[0].mine, true);
const w2 = (await owner.api("/api/player/world", { name: "Second", color: "#993366", position: { x: 900, y: 0, z: 300 } })).data.world.id;
const brought = await owner.api("/api/player/game-library/bring", { worldId: w2, libraryId: lib.data.game.id, at: [50, 2, -40] });
assert.equal(brought.status, 200, JSON.stringify(brought.data));
assert.deepEqual(brought.data.game.arena.at, [50, 2, -40]);
assert.deepEqual(brought.data.game.lobby.ring.at, [50, 32, -40]);
assert.deepEqual(brought.data.game.credits, [{ libraryId: lib.data.game.id, version: 1, by: owner.id, name: "Rig Race" }]);
console.log("library ok: brought to", w2, "credits", JSON.stringify(brought.data.game.credits));

for (const p of [owner, ann, ben]) { clearInterval(p.timer); p.ws.close(); }
console.log("ALL OK");

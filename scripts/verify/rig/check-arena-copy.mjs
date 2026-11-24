// Sandbox rig: a running match keeps its own copy of the arena (Phase 10, Q1b), against the
// REAL server with two browsers: the world's owner and one player (with NPCs).
//   1. The owner builds on the stage, the player starts a match (Play now with NPCs).
//   2. While it runs the owner moves, recolours, deletes and adds things on the stage, and
//      moves a thing in the lobby: the player's view of the stage does not change (the
//      lobby's does), though the live changes did reach their device.
//   3. The owner tries to dig the arena's ground: refused, with the reason; digging
//      elsewhere works.
//   4. The match ends: the player sees the live stage; the ground can be dug.
//   5. The next match gets the new arena; the first match's record still has the old one;
//      a replay of the first match shows the arena as it was.
//   RIG_N=3 scripts/verify/rig/up.sh && RIG_N=3 node scripts/verify/rig/check-arena-copy.mjs   (VP=desktop for the wide layout)
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, store, WEB } from "./browser.mjs";
import { checklist, player, recordOf, GAMES } from "./match-kit.mjs";

const VP = process.env.VP ?? "phone";
const { ok, until, done } = checklist();
const b = await launch();
const [po, pa] = await Promise.all([open(b, WEB, VP), open(b, WEB, VP, await b.createBrowserContext())]);
const [idO, idA] = await Promise.all([savedPlayer(po), savedPlayer(pa)]);
console.log("owner", idO, "| player", idA);
const W = await plantWorld(po, "Arena Copy");
const O = player(po, "owner", W), A = player(pa, "player", W);
const shot = (h, name) => h.shot(`arena-${VP}-${name}`);

await Promise.all([enterWorld(po, W), enterWorld(pa, W)]);

// ── In-page helpers: the world doc as the app's own functions write it ──
/** Run `fn(worldStoreModule, doc, playerId, ...args)` in the page. */
const inWorld = (h, fn, ...args) => h.page.evaluate(async (fn, args) => {
  const ws = await import("/src/stores/worldStore.ts");
  const doc = (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().activeWorldDoc;
  const me = (await import("/src/lib/player.ts")).getPlayerSnapshot()?.playerId ?? "";
  return new Function("ws", "doc", "me", "args", `return (${fn})(ws, doc, me, ...args)`)(ws, doc, me, args);
}, fn.toString(), args);
const world = (h, fn, ...args) => store(h.page, "stores/worldStore", "useWorldStore", fn, ...args);
/** What a page shows (`objects`) and what its copy of the live world holds (`liveObjects`), for a few ids. */
const seen = (h, ids) => world(h, (s, ids) => Object.fromEntries(ids.map((id) => {
  const pick = (o) => (o ? { x: +o.x.toFixed(2), z: +o.z.toFixed(2), color: o.color } : null);
  return [id, { view: pick(s.objects.get(id)), live: pick(s.liveObjects.get(id)) }];
})), ids);

// A ground to dig: a small flat voxel world (the planner makes these; here it is set directly)
const TERRAIN = { kind: "voxel", size: [64, 8, 64], seed: 7, blocks: [{ id: "grass", name: "Grass", color: "#44aa77" }], features: [] };
await inWorld(O, (ws, doc, _me, t) => ws.setVoxelTerrain(doc, t), TERRAIN);
await until("the player's device has the ground too", () => world(A, (s) => s.voxelTerrain?.size?.[0] === 64), 20000);
await sleep(1500);
/** The top solid cell of a column, and digging it out (as the owner's dig tool does). */
const topOf = (h, gi, gk) => h.page.evaluate(async (gi, gk) => {
  const { terrainCellAt } = await import("/src/stores/worldVoxels.ts");
  const t = (await import("/src/stores/worldStore.ts")).useWorldStore.getState().voxelTerrain;
  for (let j = t.size[1] - 1; j >= 1; j--) if (terrainCellAt(t, gi, j, gk)) return j;
  return 0;
}, gi, gk);
const dig = (h, gi, j, gk) => inWorld(h, (ws, doc, _me, gi, j, gk) => ws.editTerrainCell(doc, ws.useWorldStore.getState().voxelTerrain, gi, j, gk, 0), gi, j, gk);
const dug = (h, gi, j, gk) => h.page.evaluate(async (key) => (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().activeWorldDoc.getMap("terrainEdits").has(key), `${gi},${j},${gk}`);
// World (0.5, -5.5) is in the middle of the stage; world (-26.5, -26.5) is far from it
const IN = [32, 26], OUT = [5, 5];
const jIn = await topOf(O, ...IN), jOut = await topOf(O, ...OUT);
const groundY = jIn + 1;
console.log("     ground: top cell", jIn, "→ surface y", groundY);
ok(jIn >= 1, "the ground has a surface to dig under the stage");
// A collect game nobody wins on score with a long clock, so there is time to edit the stage (slow at desktop size here); the owner ends it. It stands on the ground.
const up = (v) => [v[0], v[1] + groundY, v[2]];
const C = GAMES.collect;
const GAME = {
  ...C, settings: { ...C.settings, scoreToWin: 99, roundSeconds: 240 },
  arena: { ...C.arena, at: up(C.arena.at) }, zones: C.zones.map((z) => ({ ...z, at: up(z.at) })),
  lobby: { ...C.lobby, at: up(C.lobby.at), ring: { ...C.lobby.ring, at: up(C.lobby.ring.at) }, arrival: up(C.lobby.arrival) },
};
const RING = GAME.lobby.ring.at;
ok((await O.api("/api/player/world/game", { worldId: W, game: GAME })).status === 200, "the owner saves a game (stage 20 × 20 m at z = -6, on the ground)");

// ── 1. The stage as the owner built it ─────────────────────────────
const y = groundY + 0.5;
const [WALL, CRATE, LAMP] = await inWorld(O, (ws, doc, me, y) => [
  ws.placeShape(doc, { id: "cube", name: "Cube" }, { color: "#ff0000", size: 2 }, { x: 0, y: y + 0.5, z: -6 }, me),
  ws.placeShape(doc, { id: "cube", name: "Cube" }, { color: "#00ff00", size: 1 }, { x: 3, y, z: -8 }, me),
  ws.placeShape(doc, { id: "cube", name: "Cube" }, { color: "#ffff00", size: 1 }, { x: 4, y, z: 15 }, me),
], y);
await until("the player sees the stage's two things and the lobby's one (live, before any match)", async () => {
  const s = await seen(A, [WALL, CRATE, LAMP]);
  return s[WALL].view && s[CRATE].view && s[LAMP].view && (await world(A, (s) => s.arenaCopy === null));
}, 20000);
for (const h of [O, A]) ok(await h.lobby(), `${h.name}: the lobby is ready`);

// ── 2. A match starts: the player gets the arena's copy ────────────
const startMatch = async () => {
  await A.queue(RING);
  await until("the player is in the pool", () => A.match((s) => s.lobby?.queued === true), 20000);
  await A.send({ t: "play-now", level: 1 });
  return until("Play now with NPCs starts a match", () => A.match((s) => s.playing?.matchId ?? null), 30000);
};
const first = await startMatch();
await until("the player holds the match's arena copy", () => world(A, (s, id) => s.arenaCopy?.key === `play:${id}`, first), 10000);
ok((await A.match((s) => s.playing?.game?.version)) === (await A.match((s) => s.playing?.gameVersion)), "`start` carried the match's own game");
ok((await A.match((s) => s.arena?.objects.map((o) => o.id).sort().join())) === [WALL, CRATE].sort().join(), "the copy is the two things on the stage, not the lobby's", await A.match((s) => s.arena?.objects.length));
await until("the round is on", () => A.match((s) => s.snap?.phase === "playing"), 25000);
// Look at the stage from just inside its near edge
await A.walk(0, groundY, -1);
await sleep(1500);
const before = await seen(A, [WALL, CRATE, LAMP]);
const countBefore = await world(A, (s) => s.objects.size);
await shot(A, "01-playing-before-edits");

// ── 3. The owner changes the live stage mid-match ──────────────────
const NEW = await inWorld(O, (ws, doc, me, WALL, CRATE, LAMP, y) => {
  ws.moveObject(doc, WALL, { x: 6, y: y + 0.5, z: -10 }, 0.7);
  ws.recolorObject(doc, WALL, "#0000ff");
  ws.useWorldStore.getState().removeObject(doc, CRATE);
  ws.moveObject(doc, LAMP, { x: -4, y, z: 15 }, 0);
  return ws.placeShape(doc, { id: "sphere", name: "Sphere" }, { color: "#ff00ff", size: 2 }, { x: -3, y: y + 0.5, z: -6 }, me);
}, WALL, CRATE, LAMP, y);
ok(typeof NEW === "string", "the owner moved and recoloured the wall, deleted the crate, added a sphere, and moved the lobby's lamp");
const after = await until("those changes reached the player's device (its copy of the live world)", async () => {
  const s = await seen(A, [WALL, CRATE, LAMP, NEW]);
  return s[WALL].live?.x === 6 && s[WALL].live?.color === "#0000ff" && s[CRATE].live === null && s[NEW].live && s[LAMP].live?.x === -4 ? s : null;
}, 20000);
console.log("     the player's device:", JSON.stringify(after));
ok(JSON.stringify(after?.[WALL].view) === JSON.stringify(before[WALL].view), "the player still sees the wall where and how it was", JSON.stringify(after?.[WALL].view));
ok(after?.[CRATE].view && JSON.stringify(after[CRATE].view) === JSON.stringify(before[CRATE].view), "the deleted crate is still there for the player");
ok(after?.[NEW].view === null, "the added sphere is not there for the player");
ok(after?.[LAMP].view?.x === -4, "off the stage the live world shows: the lamp moved");
ok((await world(A, (s) => s.objects.size)) === countBefore, "the player draws and collides with the same number of things as before");
// The owner, in the lobby, sees their own work
const own = await seen(O, [WALL, CRATE, NEW]);
ok(own[WALL].view?.x === 6 && own[CRATE].view === null && own[NEW].view !== null && (await world(O, (s) => s.arenaCopy === null)), "the owner sees the live stage");
await sleep(1200);
await shot(A, "02-playing-after-edits");
await shot(O, "03-owner-live-stage");
{
  const rec = await recordOf(O, first);
  const wall = rec?.setup?.arena?.objects.find((o) => o.id === WALL);
  ok(wall?.x === 0 && wall?.color === "#ff0000" && rec.setup.arena.objects.some((o) => o.id === CRATE) && !rec.setup.arena.objects.some((o) => o.id === NEW), "the running match's record holds the arena as it started");
  ok(!JSON.stringify(rec?.setup?.arena ?? {}).includes(idO), "and not who placed things");
}

// ── 4. The ground under a running match is locked ──────────────────
ok(await O.page.evaluate(async (size, gi, j, gk) => (await import("/src/lib/arenaCopy.ts")).matchLocksCell(size, gi, j, gk), TERRAIN.size, IN[0], jIn, IN[1]), "the owner's app knows the arena's ground is locked (it shows the notice instead of digging)");
ok(!(await O.page.evaluate(async (size, gi, j, gk) => (await import("/src/lib/arenaCopy.ts")).matchLocksCell(size, gi, j, gk), TERRAIN.size, OUT[0], jOut, OUT[1])), "and that ground elsewhere is not");
await O.page.evaluate(async () => (await import("/src/lib/match.ts")).useMatchStore.setState({ error: null }));
await dig(O, IN[0], jIn, IN[1]); // past the app's own check, as an older or altered client would
await until("the server undoes a dig under the arena, for the owner too", async () => !(await dug(O, IN[0], jIn, IN[1])), 10000);
const why = await until("and says why", () => O.match((s) => s.error), 8000);
ok(/A match is running here/.test(why ?? ""), "the reason is the notice", why ?? "");
await dig(O, OUT[0], jOut, OUT[1]);
await sleep(1500);
ok(await dug(O, OUT[0], jOut, OUT[1]) && await until("a dig away from the arena goes through to everyone", () => dug(A, OUT[0], jOut, OUT[1]), 10000), "digging elsewhere still works");
ok(!(await dug(A, IN[0], jIn, IN[1])), "the player's ground under the arena is untouched");

// ── 5. The match ends: the live stage again ────────────────────────
ok((await A.match((s) => s.playing !== null && s.ended === null)), "the match was still running through all of that");
await O.send({ t: "host-end", matchId: first });
await until("the owner ends the match", () => A.match((s) => s.ended !== null), 20000);
await A.send({ t: "again", yes: false });
await until("the player is back in the lobby", () => A.match((s) => s.playing === null && s.ended === null), 40000);
const back = await until("and sees the live stage: wall moved and blue, crate gone, sphere there", async () => {
  const s = await seen(A, [WALL, CRATE, NEW]);
  return (await world(A, (s) => s.arenaCopy === null)) && s[WALL].view?.x === 6 && s[WALL].view?.color === "#0000ff" && s[CRATE].view === null && s[NEW].view !== null;
}, 15000);
ok(back, "the lobby shows the stage as it is now");
await A.stand(0, groundY, 6);
await sleep(1500);
await shot(A, "04-lobby-live-stage");
await dig(O, IN[0], jIn, IN[1]);
await sleep(2000);
ok(await dug(O, IN[0], jIn, IN[1]), "with no match running the owner digs the arena's ground");

// ── 6. The next match gets the new arena; the first record keeps the old ──
const second = await startMatch();
ok(second && second !== first, "a second match starts");
await until("its copy is the new stage", () => A.match((s, id, WALL, NEW, CRATE) => {
  if (s.arena?.matchId !== id) return false;
  const wall = s.arena.objects.find((o) => o.id === WALL);
  return wall?.x === 6 && wall.color === "#0000ff" && s.arena.objects.some((o) => o.id === NEW) && !s.arena.objects.some((o) => o.id === CRATE);
}, second, WALL, NEW, CRATE), 10000);
{
  const [r1, r2] = [await recordOf(O, first), await recordOf(O, second)];
  ok(r1?.setup.arena.objects.find((o) => o.id === WALL)?.x === 0 && r1.setup.arena.objects.some((o) => o.id === CRATE), "the first match's record still has the old arena");
  ok(r2?.setup.arena.objects.find((o) => o.id === WALL)?.x === 6 && r2.setup.arena.objects.length === 2, "the second match's record has the new one");
  ok(r1?.result && r1.setup.game.version === r2?.setup.game.version, "same game version, different arenas: each record says what it was played on");
}
await O.send({ t: "host-end", matchId: second });
await until("the owner ends the second match", () => A.match((s) => s.ended !== null), 20000);
await A.send({ t: "again", yes: false });
await until("back in the lobby", () => A.match((s) => s.playing === null && s.ended === null), 40000);

// ── 7. A replay of the first match shows the arena as it was ───────
await A.page.evaluate(async (id, w) => (await import("/src/lib/matchView.ts")).openReplay(id, w), first, W);
await until("the player, replaying the first match, sees its arena: wall back and red, the crate back, no sphere", async () => {
  const s = await seen(A, [WALL, CRATE, NEW]);
  return (await world(A, (s, id) => s.arenaCopy?.key === `replay:${id}`, first)) && s[WALL].view?.x === 0 && s[WALL].view?.color === "#ff0000" && s[CRATE].view !== null && s[NEW].view === null;
}, 20000);
await sleep(1500);
await shot(A, "05-replay-old-arena");
await A.page.evaluate(async () => (await import("/src/lib/matchView.ts")).closeReplay());
await until("closing the replay shows the live stage again", async () => (await world(A, (s) => s.arenaCopy === null)) && (await seen(A, [WALL]))[WALL].view?.x === 6, 10000);
// A builder in the lobby keeps the live stage while a replay plays (they may be working on it)
await O.page.evaluate(async (id, w) => (await import("/src/lib/matchView.ts")).openReplay(id, w), first, W);
await until("the owner's replay is open", () => O.view((s) => s.replay !== null), 20000);
ok(await world(O, (s) => s.arenaCopy === null), "a builder replaying from the lobby still sees the live stage");
await O.page.evaluate(async () => { const v = (await import("/src/lib/matchView.ts")).useViewStore; v.setState({ ghost: true }); });
await until("in ghost flight the builder sees the match's arena too", () => world(O, (s, id) => s.arenaCopy?.key === `replay:${id}`, first), 8000);
await O.page.evaluate(async () => (await import("/src/lib/matchView.ts")).closeReplay());

for (const h of [O, A]) ok(h.errors().length === 0, `${h.name}: no page errors`, JSON.stringify(h.errors().slice(0, 4)));
const code = done(`(${VP}; screenshots in /tmp/rig${process.env.RIG_N ?? 0}/arena-${VP}-*.png)`);
await b.close();
process.exit(code);

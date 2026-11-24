// Sandbox rig: the Game tab's Library against the REAL routes (Phase 10, slice 7). One
// owner with two worlds, and a second creator who brings the game into a world of theirs:
//   save from the Game tab → listed under Mine → bring into a second world of the same
//   owner (the game, its places, the stage's objects, the credit) → bring it again (the
//   objects are replaced, not doubled) → another creator finds it under Everyone's, brings
//   it, and sees the credit with the maker's name (never a raw id).
// check-game-setup.mjs covers the same screens at four sizes with faked routes.
//   RIG_N=8 scripts/verify/rig/up.sh && RIG_N=8 node scripts/verify/rig/check-library-live.mjs
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, waitFor, store, RIG_DIR, WEB } from "./browser.mjs";
import { checklist, player, RACE } from "./match-kit.mjs";

const VP = process.env.VP ?? "phone";
const { ok, until, done } = checklist();
const b = await launch();
const [po, pc] = await Promise.all([open(b, WEB, VP), open(b, WEB, VP, await b.createBrowserContext())]);
const [idO, idC] = await Promise.all([savedPlayer(po), savedPlayer(pc)]);
const W1 = await plantWorld(po, "Library Source");
const W2 = await plantWorld(po, "Library Target", { x: 420, y: 0, z: 300 });
const W3 = await plantWorld(pc, "Other Creator", { x: 300, y: 0, z: 420 });
const O = player(po, "owner", W1), C = player(pc, "creator", W3);
const NAME = `Rig Dash ${Date.now() % 100000}`;
const named = await O.api("/api/player/character/name", { name: "Juniper Rig" });
const maker = named.status === 200 ? named.data.name : null;
console.log("owner", idO, "named", maker, "| other creator", idC);

const objects = (page) => store(page, "stores/worldStore", "useWorldStore", (s) => [...s.objects.values()].map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, z: o.z, gameProp: o.gameProp ?? null, placedBy: o.placedBy })));
const openLibrary = async (h) => { await store(h.page, "stores/sheetStore", "useSheetStore", (s) => s.setSheet("game", true)); await h.click("#game-sub-library"); };
/** ConfirmButton: one tap arms it, the second does it. */
const bring = async (h, id) => { await h.click(`#game-lib-bring-${id}`); await sleep(300); await h.click(`#game-lib-bring-${id}`); };

// ── Save from the Game tab ─────────────────────────────────────────
ok((await O.api("/api/player/world/game", { worldId: W1, game: RACE })).status === 200, "the source world's game is saved");
await enterWorld(po, W1);
// Two things on the stage (inside the arena) and one outside it
await po.evaluate(async (me) => {
  const { useUniverseStore } = await import("/src/stores/universeStore.ts");
  const { placeShape } = await import("/src/stores/worldStore.ts");
  const doc = useUniverseStore.getState().activeWorldDoc;
  placeShape(doc, { id: "cube", name: "Cube" }, { color: "#ff8844", size: 1 }, { x: 2, y: 0.5, z: -6 }, me);
  placeShape(doc, { id: "sphere", name: "Sphere" }, { color: "#44aaff", size: 1 }, { x: -3, y: 0.5, z: -9 }, me);
  placeShape(doc, { id: "cube", name: "Cube" }, { color: "#ffffff", size: 1 }, { x: 0, y: 0.5, z: 16 }, me);
}, idO);
await until("three objects are in the source world", async () => (await objects(po)).length === 3, 10000);
await sleep(2500); // the server has them
await openLibrary(O);
ok(await O.has("#game-lib-name") && await O.has("#game-lib-save"), "the Library section is there");
await until("Mine starts empty", () => O.has("#game-lib-empty"), 10000);
await po.type("#game-lib-name", NAME);
await O.click("#game-lib-save");
await until("saved: the tab says so", async () => /Saved to the Library/.test(await O.text("#game-lib-done") ?? ""), 15000);
const mine = await until("Mine lists it (from the real route)", async () => { const t = await O.text("#game-lib-list"); return t && t.includes(NAME) ? t : null; }, 10000);
ok(/Race · v1 · by you/.test(mine ?? ""), "as a v1 race by you", mine);
await O.shot(`lib-${VP}-01-saved`);
const listed = (await O.api("/api/player/game-library")).data.games.find((g) => g.name === NAME);
ok(listed?.mine === true && listed.by === idO && listed.byName === maker, "GET /api/player/game-library agrees", JSON.stringify(listed));
// Saving again unchanged is the same version; after a change it is the next one
await O.click("#game-lib-save");
await until("saving again unchanged stays v1", async () => /v1\./.test(await O.text("#game-lib-done") ?? ""), 10000);

// ── Bring into a second world of the same owner ─────────────────────
await store(po, "stores/sheetStore", "useSheetStore", (s) => s.close());
await enterWorld(po, W2);
ok((await objects(po)).length === 0, "the second world is empty");
await O.stand(3, 0, -4);
await openLibrary(O);
await until("the second world's Library lists my game", async () => (await O.text("#game-lib-list") ?? "").includes(NAME), 10000);
await bring(O, listed.id);
await until("brought: the tab says it is this world's game now", async () => /is now this world/.test(await O.text("#game-lib-done") ?? ""), 15000);
const g2 = await until("the world's game arrives (meta.game)", () => store(po, "stores/worldStore", "useWorldStore", (s) => s.meta?.game && { arena: s.meta.game.arena, zones: s.meta.game.zones.length, lobby: s.meta.game.lobby?.at, credits: s.meta.game.credits, roster: s.meta.game.npcRoster.length }), 10000);
ok(g2?.arena.at[0] === 3 && g2.arena.at[2] === -4 && g2.zones === 3 && g2.roster === 2, "its arena is where the owner stands, zones and roster came along", JSON.stringify(g2?.arena));
ok(g2?.lobby?.[0] === 3 && g2.lobby[2] === 14, "the lobby kept its offset from the arena", JSON.stringify(g2?.lobby));
ok(g2?.credits.length === 1 && g2.credits[0].libraryId === listed.id && g2.credits[0].byName === maker, "the credit is on the game, with the maker's name", JSON.stringify(g2?.credits));
const placed = await until("the stage's two objects were placed (not the one outside)", async () => { const o = await objects(po); return o.length === 2 ? o : null; }, 10000);
// (They carry a server-only `gameProp` mark; the client's object store doesn't keep it. The second bring below shows it works.)
ok(placed?.some((o) => o.type === "cube" && Math.abs(o.x - 5) < 0.01 && Math.abs(o.z - (-4)) < 0.01), "at the same offsets from the arena", JSON.stringify(placed?.map((o) => [o.type, o.x, o.z])));
const credit = await until("the Credit section shows", () => O.text("#game-credits"), 10000);
ok(credit?.includes(NAME) && credit.includes(`by ${maker}`) && !credit.includes(idO), "Based on <game> v1 by <name>: a name, not an id", credit);
await O.shot(`lib-${VP}-02-brought`);

// Bringing it again must not stack a second copy of the objects
await O.stand(-2, 0, -5);
await bring(O, listed.id);
await until("brought again (somewhere else)", () => store(po, "stores/worldStore", "useWorldStore", (s) => s.meta?.game?.arena?.at[0] === -2), 15000);
await sleep(1500);
const again = await objects(po);
ok(again.length === 2, "still two objects: the first bring's were cleared", JSON.stringify(again.map((o) => [o.type, o.x, o.z])));
ok(again.some((o) => o.type === "cube" && Math.abs(o.x - 0) < 0.01), "and they moved with the arena");

// ── Another creator brings it ──────────────────────────────────────
await enterWorld(pc, W3);
await C.stand(0, 0, -6);
await openLibrary(C);
await C.click("#game-lib-all");
const theirs = await until("Everyone's lists it for another creator", async () => { const t = await C.text("#game-lib-list"); return t && t.includes(NAME) ? t : null; }, 10000);
ok(theirs?.includes(`by ${maker}`), "with the maker's name", theirs);
await C.shot(`lib-${VP}-03-everyones`);
await bring(C, listed.id);
await until("they bring it into their own world", async () => /is now this world/.test(await C.text("#game-lib-done") ?? ""), 15000);
const c3 = await until("credited there too", () => C.text("#game-credits"), 10000);
ok(c3?.includes(`by ${maker}`) && !c3.includes(idO), "the credit line names the maker", c3);
ok(await waitFor(async () => (await objects(pc)).length === 2, 10000), "the stage's objects came along, placed by the one who brought it");
ok((await objects(pc)).every((o) => o.placedBy === idC), "placedBy is the bringer");
// Saved on from there, the chain grows
await C.api("/api/player/world/game", { worldId: W3, game: { ...(await store(pc, "stores/worldStore", "useWorldStore", (s) => s.meta.game)), settings: { ...RACE.settings, roundSeconds: 240 } } });
const re = await C.api("/api/player/game-library", { worldId: W3, name: `${NAME} Remix` });
ok(re.status === 200 && re.data.game.credits.length === 1 && re.data.game.credits[0].libraryId === listed.id, "their own save of it carries the credit chain", JSON.stringify(re.data?.game?.credits ?? re.data));
ok((await C.api("/api/player/game-library/bring", { worldId: W2, libraryId: listed.id, at: [0, 0, 0] })).status === 403, "nobody brings a game into a world that isn't theirs");

for (const h of [O, C]) ok(h.errors().length === 0, `${h.name}: no page errors`, JSON.stringify(h.errors().slice(0, 4)));
const code = done(`(${VP}; screenshots in ${RIG_DIR}/lib-${VP}-*.png)`);
await b.close();
process.exit(code);

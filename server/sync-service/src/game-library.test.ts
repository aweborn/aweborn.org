/** The game Library (Phase 10, slice 7). Uses node:sqlite so it runs without native modules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { GameLibrary, LIBRARY_OBJECTS_MAX, relativeGame, placeGame, snapshotStage, placedObjects, saveLibraryGame, bringLibraryGame, type LibraryRouteDeps } from "./game-library.js";
import { cleanWorldName } from "./world-create.js";
import { WorldGames } from "./game.js";
import type { SqlDb } from "./build-requests.js";
import { parseGame, type Game } from "../../../shared/game.js";

const W = "11111111-2222-4333-8444-555555555555";
const W2 = "22222222-2222-4333-8444-555555555555";
const names = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));

function game(over: Record<string, unknown> = {}): Game {
  const p = parseGame({
    template: "race", version: 4,
    arena: { at: [10, 5, -20], size: [40, 20, 40] },
    zones: [
      { id: "s1", kind: "spawn", team: 1, at: [0, 5, -20], size: [4, 3, 4] },
      { id: "s2", kind: "spawn", team: 2, at: [20, 5, -20], size: [4, 3, 4] },
      { id: "goal", kind: "goal", at: [10, 5, -5], size: [4, 3, 4] },
    ],
    lobby: { at: [10, 30, -20], size: [12, 6, 12], ring: { at: [12, 30, -20], radius: 2 }, arrival: [10, 30, -17] },
    npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 3 } }],
    ...over,
  });
  assert.ok(p.ok);
  return p.value;
}
const stageObjects = [
  { id: "a", type: "block", x: 12, y: 6, z: -18, rotX: 0, rotY: 1.5, rotZ: 0, scaleX: 2, scaleY: 1, scaleZ: 1, material: "stone", color: "#aabbcc", placedBy: "cara", placedAt: 5 },
  { id: "b", type: "model", x: 0, y: 5, z: -30, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, material: "default", asset: "abc.glb", prompt: "a tower", placedBy: "ben", placedAt: 6, mind: { name: "Tom" } },
  { id: "c", type: "sign", x: 11, y: 6, z: -19, text: "hello", placedBy: "cara" },
  { id: "d", type: "block", x: 100, y: 6, z: -18, material: "stone", placedBy: "cara" }, // off the stage
  { id: "e", type: "sound", x: 9, y: 7, z: -21, asset: "s.mp3", media: "music", loop: true, volume: 0.5, material: "default", placedBy: "cara", carry: { by: "x", t: 1 } },
];
const fresh = () => {
  const db = new DatabaseSync(":memory:") as unknown as SqlDb;
  return { db, lib: new GameLibrary(db), games: new WorldGames(db) };
};

test("a game is stored relative to its arena, and comes back anywhere", () => {
  const g = game();
  const rel = relativeGame(g)!;
  assert.deepEqual(rel.arena!.at, [0, 0, 0]);
  assert.deepEqual(rel.zones.map((z) => z.at), [[-10, 0, 0], [10, 0, 0], [0, 0, 15]]);
  assert.deepEqual([rel.lobby!.at, rel.lobby!.ring.at, rel.lobby!.arrival], [[0, 25, 0], [2, 25, 0], [0, 25, 3]]);
  assert.equal(rel.version, 0);
  assert.deepEqual({ ...placeGame(rel, g.arena!.at), version: 4 }, g);
  assert.equal(relativeGame(game({ arena: null })), null);
});

test("the snapshot holds plain things on the stage: no minds, no signs, no placer", () => {
  const snap = snapshotStage(stageObjects, game());
  assert.deepEqual(snap, [
    { x: 2, y: 1, z: 2, type: "block", material: "stone", color: "#aabbcc", rotX: 0, rotY: 1.5, rotZ: 0, scaleX: 2, scaleY: 1, scaleZ: 1 },
    { x: -1, y: 2, z: -1, type: "sound", material: "default", asset: "s.mp3", media: "music", volume: 0.5, loop: true },
  ]);
  const many = Array.from({ length: 300 }, (_, i) => ({ type: "block", x: 10, y: 6 + i * 0.01, z: -20 }));
  assert.equal(snapshotStage(many, game()).length, LIBRARY_OBJECTS_MAX);
  const placed = placedObjects(snap, [50, 0, 50], "dana", 777);
  assert.deepEqual(placed.map((o) => [o.type, o.x, o.y, o.z, o.placedBy, o.placedAt]), [["block", 52, 1, 52, "dana", 777], ["sound", 49, 2, 49, "dana", 777]]);
  assert.ok(placed.every((o) => /^obj-[0-9a-f]{10}$/.test(String(o.id)) && o.mind === undefined));
  assert.equal(new Set(placed.map((o) => o.id)).size, 2);
  assert.deepEqual(placedObjects(snap, [5000, 0, 0], "dana", 1), []); // outside a world: left out
});

test("saving makes a Library game; saving again from the same world makes its next version", () => {
  const { lib } = fresh();
  const a = lib.save({ worldId: W, name: "Sky Race", by: "cara", mine: ["cara", "cara-2"], game: game(), objects: stageObjects, byName: "Cara" }, 1000)!;
  assert.deepEqual({ ...a, id: "" }, { id: "", name: "Sky Race", version: 1, template: "race", by: "cara", byName: "Cara", credits: [], updatedAt: 1000, mine: true });
  // Unchanged: the same version (a rename is fine)
  const same = lib.save({ worldId: W, name: "Sky Race 2", by: "cara", mine: ["cara"], game: game(), objects: stageObjects }, 2000)!;
  assert.deepEqual([same.id, same.version, same.name], [a.id, 1, "Sky Race 2"]);
  // Changed, by another character of the same account: the next version of the same game
  const b = lib.save({ worldId: W, name: "Sky Race 2", by: "cara-2", mine: ["cara", "cara-2"], game: game({ template: "collect" }), objects: [] }, 3000)!;
  assert.deepEqual([b.id, b.version, b.template, b.by], [a.id, 2, "collect", "cara"]);
  // Another account saving from the same world (a builder) makes their own
  const c = lib.save({ worldId: W, name: "Ben's cut", by: "ben", mine: ["ben"], game: game(), objects: [] }, 4000)!;
  assert.notEqual(c.id, a.id);
  // No arena, nothing to save
  assert.equal(lib.save({ worldId: W2, name: "Empty", by: "cara", mine: ["cara"], game: game({ arena: null }), objects: [] }), null);

  // Mine first, then others, newest first
  lib.save({ worldId: W2, name: "Dana's", by: "dana", mine: ["dana"], game: game(), objects: [] }, 5000);
  const list = lib.list(["cara", "cara-2"], names);
  assert.deepEqual(list.map((g) => [g.name, g.mine, g.byName, g.version]), [["Sky Race 2", true, "CARA", 2], ["Dana's", false, "DANA", 1], ["Ben's cut", false, "BEN", 1]]);
  assert.deepEqual(lib.list([], names).map((g) => g.name), ["Dana's", "Ben's cut", "Sky Race 2"]);
  assert.equal(lib.list(["cara"], names, 2).length, 2);
  const latest = lib.latest(a.id)!;
  assert.deepEqual([latest.version, latest.game.template, latest.savedBy, latest.objects.length], [2, "collect", "cara-2", 0]);
  assert.equal(lib.latest("nope"), null);
});

test("bringing translates the game to where it is put, places the objects and appends the credit", () => {
  const { lib, games } = fresh();
  const saved = lib.save({ worldId: W, name: "Sky Race", by: "cara", mine: ["cara"], game: game(), objects: stageObjects }, 1000)!;
  const b = lib.bring(saved.id, [-50, 2, 60], "dana", 9000)!;
  assert.deepEqual(b.game.arena, { at: [-50, 2, 60], size: [40, 20, 40] });
  assert.deepEqual(b.game.zones.map((z) => z.at), [[-60, 2, 60], [-40, 2, 60], [-50, 2, 75]]);
  assert.deepEqual([b.game.lobby!.at, b.game.lobby!.ring.at, b.game.lobby!.arrival], [[-50, 27, 60], [-48, 27, 60], [-50, 27, 63]]);
  assert.deepEqual(b.credits, [{ libraryId: saved.id, version: 1, by: "cara", name: "Sky Race" }]);
  assert.deepEqual(b.objects.map((o) => [o.type, o.x, o.y, o.z, o.placedBy]), [["block", -48, 3, 62, "dana"], ["sound", -51, 4, 59, "dana"]]);
  assert.equal(lib.bring("nope", [0, 0, 0], "dana"), null);

  // Through the world's game store: the placed game is valid as it is, and carries the credit
  const r = games.save(W2, b.game, "dana", 9000, b.credits);
  assert.ok(r.ok && r.changed);
  assert.deepEqual(r.game.credits, b.credits);
  assert.deepEqual(r.game.zones.map((z) => z.at), b.game.zones.map((z) => z.at));
  assert.deepEqual(r.game.lobby, b.game.lobby);
  assert.deepEqual(r.game.npcRoster, game().npcRoster);

  // Dana changes it and saves it to the Library as her own: the chain goes with it, and grows when it is brought again
  const mine = lib.save({ worldId: W2, name: "Sky Race Remix", by: "dana", mine: ["dana"], game: { ...r.game, template: "collect" }, objects: [] }, 9500)!;
  assert.deepEqual(mine.credits, b.credits);
  const again = lib.bring(mine.id, [0, 0, 0], "eli", 9900)!;
  assert.deepEqual(again.credits, [{ libraryId: saved.id, version: 1, by: "cara", name: "Sky Race" }, { libraryId: mine.id, version: 1, by: "dana", name: "Sky Race Remix" }]);
  assert.deepEqual(again.game.credits, []); // the stored game itself carries none: the caller sets the chain
});

test("the routes: owners only, a checked name, and the brought game lands in the world with its objects", () => {
  const { lib, games } = fresh();
  games.save(W, game(), "cara", 500);
  const placed: Record<string, unknown[]> = {};
  const deps: LibraryRouteDeps = {
    lib,
    isOwner: (worldId, id) => (worldId === W && id === "cara") || (worldId === W2 && id === "dana"),
    game: (worldId) => games.get(worldId),
    objects: (worldId) => (worldId === W ? stageObjects : []),
    cleanName: cleanWorldName,
    saveGame: (worldId, g, by, credits) => {
      const r = games.save(worldId, g, by, 9000, credits);
      return r.ok ? { ok: true, game: r.game, warnings: r.warnings } : { ok: false, message: r.message };
    },
    placeObjects: (worldId, objects) => { placed[worldId] = objects; },
    name: (id) => id.toUpperCase(),
  };
  const cara = { playerId: "cara", mine: ["cara"] };
  // Saving
  assert.deepEqual(saveLibraryGame(deps, { playerId: "dana", mine: ["dana"] }, W, "Sky Race").body.error, "not_owner");
  assert.equal(saveLibraryGame(deps, { playerId: "dana", mine: ["dana"] }, W, "Sky Race").status, 403);
  assert.equal(saveLibraryGame(deps, cara, null, "Sky Race").status, 400);
  for (const bad of ["ab", "x".repeat(41), "   ", 7, undefined]) assert.equal(saveLibraryGame(deps, cara, W, bad).body.error, "bad_name");
  assert.equal(saveLibraryGame(deps, { playerId: "dana", mine: ["dana"] }, W2, "Nothing here").body.error, "no_game");
  const ok = saveLibraryGame(deps, cara, W, "  Sky   Race ", 1000);
  assert.equal(ok.status, 200);
  const saved = ok.body.game as { id: string; name: string; version: number; byName: string };
  assert.deepEqual([saved.name, saved.version, saved.byName], ["Sky Race", 1, "CARA"]);
  assert.equal((saveLibraryGame(deps, cara, W, "Sky Race", 2000).body.game as { version: number }).version, 1);

  // Bringing
  assert.equal(bringLibraryGame(deps, { playerId: "cara" }, W2, saved.id, [0, 0, 0]).status, 403);
  assert.equal(bringLibraryGame(deps, { playerId: "dana" }, W2, saved.id, [0, "x", 0]).status, 400);
  assert.equal(bringLibraryGame(deps, { playerId: "dana" }, W2, "nope", [0, 0, 0]).status, 404);
  assert.deepEqual(placed, {});
  const b = bringLibraryGame(deps, { playerId: "dana" }, W2, saved.id, [-50, 2, 60], 9000);
  assert.equal(b.status, 200);
  const brought = games.get(W2)!;
  assert.deepEqual(b.body.game, brought);
  assert.deepEqual(brought.arena!.at, [-50, 2, 60]);
  // The credit carries the maker's name as the server resolves it, so clients never show a raw id
  assert.deepEqual(brought.credits, [{ libraryId: saved.id, version: 1, by: "cara", name: "Sky Race", byName: "CARA" }]);
  assert.equal(b.body.placed, 2);
  // Each placed object is marked as this Library game's prop (so the next bring can clear them)
  assert.ok(placed[W2].every((o) => (o as { gameProp?: string }).gameProp === saved.id));
  assert.deepEqual(placed[W2].map((o) => [(o as { x: number }).x, (o as { placedBy: string }).placedBy]), [[-48, "dana"], [-51, "dana"]]);
  // Cara's world is untouched
  assert.deepEqual(games.get(W)!.arena!.at, [10, 5, -20]);
  // Put at the world's rim, the game is clamped in and the objects follow the arena
  const rim = bringLibraryGame(deps, { playerId: "dana" }, W2, saved.id, [900, 2, 0], 9500);
  assert.equal((rim.body.game as Game).arena!.at[0], 200);
  assert.equal((placed[W2][0] as { x: number }).x, 202);
});

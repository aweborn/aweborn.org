/** Phase 10, slice 1: the game record validates, clamps and repairs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_LIMITS, GAME_TEMPLATES, TEMPLATE_DEFAULTS, boundsOf, boxesOverlap, defaultSettings, gameMissing, inBox, newGame,
  parseGame, sameGame, stageOf, type Game,
} from "./game.ts";

const ARENA = { at: [0, 0, 0], size: [40, 20, 40] };
const LOBBY = { at: [0, 0, 40], size: [12, 6, 12], ring: { at: [0, 0, 42], radius: 2 }, arrival: [0, 0, 38] };
const full = () => ({
  template: "race",
  settings: { teams: 2 },
  arena: ARENA,
  zones: [
    { id: "Red Start", kind: "spawn", team: 1, at: [-15, 0, 0], size: [4, 3, 4] },
    { kind: "spawn", team: 2, at: [15, 0, 0], size: [4, 3, 4] },
    { kind: "goal", at: [0, 0, -15], size: [6, 3, 6] },
    { kind: "keep-out", at: [0, 0, 5], size: [3, 3, 3], ret: "instant" },
  ],
  lobby: LOBBY,
});
const ok = (raw: unknown): { value: Game; warnings: string[] } => {
  const p = parseGame(raw);
  assert.ok(p.ok, p.ok ? "" : p.errors.join("; "));
  return p;
};

test("a full game parses cleanly and is ready", () => {
  const { value: g, warnings } = ok(full());
  assert.deepEqual(warnings, []);
  assert.equal(g.template, "race");
  assert.deepEqual(g.zones.map((z) => z.id), ["red-start", "spawn-2", "goal-3", "keep-out-4"]);
  assert.equal(g.zones[3].ret, "instant");
  assert.equal(g.zones[2].team, undefined);
  assert.deepEqual(g.npcRoster, []);
  assert.deepEqual(gameMissing(g), []);
  // Parsing what it produced changes nothing (stored games re-read the same)
  assert.deepEqual(ok(g).value, g);
});

test("only a non-object or an unknown template fails", () => {
  assert.equal(parseGame(null).ok, false);
  assert.equal(parseGame([]).ok, false);
  assert.equal(parseGame({ template: "deathmatch" }).ok, false);
  for (const template of GAME_TEMPLATES) {
    const { value } = ok({ template });
    assert.deepEqual(value.settings, defaultSettings(template));
    assert.equal(value.arena, null);
    assert.equal(value.lobby, null);
  }
});

test("settings clamp to the limits and repair nonsense", () => {
  const { value: g } = ok({
    template: "race",
    settings: {
      teams: 99, players: { min: 500, max: 1000 }, rounds: 0, roundSeconds: 5, scoreToWin: -3,
      traits: { speedMul: 50, gravityMul: Number.NaN, fly: "yes" }, edge: "lava", edgeSeconds: 600,
    },
  });
  const s = g.settings;
  assert.equal(s.teams, GAME_LIMITS.teams);
  assert.equal(s.players.max, GAME_LIMITS.players);
  assert.equal(s.players.min, GAME_LIMITS.players);
  assert.equal(s.rounds, 1);
  assert.equal(s.roundSeconds, GAME_LIMITS.roundSeconds[0]);
  assert.equal(s.scoreToWin, 1);
  assert.deepEqual(s.traits, { speedMul: 3, gravityMul: 1, fly: true });
  assert.equal(s.edge, "soft");
  assert.equal(s.edgeSeconds, GAME_LIMITS.edgeSeconds[1]);
});

test("a match never holds fewer players than teams, and min never passes max", () => {
  const { value: g } = ok({ template: "capture-the-flag", settings: { teams: 4, players: { min: 9, max: 2 } } });
  assert.equal(g.settings.players.max, 4);
  assert.equal(g.settings.players.min, 4);
});

test("defaults: one round of 5 to 10 minutes, a soft edge of 10 s", () => {
  const s = defaultSettings("race");
  assert.equal(s.rounds, 1);
  assert.ok(s.roundSeconds >= 300 && s.roundSeconds <= 600);
  assert.equal(s.edge, "soft");
  assert.equal(s.edgeSeconds, 10);
  assert.equal(TEMPLATE_DEFAULTS["build-together"].teams, 1);
});

test("the arena is clamped into the world", () => {
  const { value: g } = ok({ template: "race", arena: { at: [9999, -9999, 0], size: [1, 9999, 5000] } });
  assert.deepEqual(g.arena, { at: [GAME_LIMITS.maxXZ, GAME_LIMITS.y[0], 0], size: [GAME_LIMITS.arenaSize[0], GAME_LIMITS.arenaHeight[1], GAME_LIMITS.arenaSize[1]] });
  const bad = ok({ template: "race", arena: { at: ["x", 0, 0], size: [10, 10, 10] } });
  assert.equal(bad.value.arena, null);
  assert.equal(bad.warnings.length, 1);
});

test("zones are moved and shrunk to lie inside the arena", () => {
  const { value: g } = ok({ template: "race", arena: ARENA, zones: [{ kind: "goal", at: [500, 90, -500], size: [100, 100, 100] }] });
  const a = boundsOf(g.arena!), z = boundsOf(g.zones[0]);
  assert.ok(z.minX >= a.minX && z.maxX <= a.maxX && z.minY >= a.minY && z.maxY <= a.maxY && z.minZ >= a.minZ && z.maxZ <= a.maxZ);
});

test("zones need an arena, a kind and a place; ids stay unique; the cap holds", () => {
  const noArena = ok({ template: "race", zones: [{ kind: "goal", at: [0, 0, 0], size: [2, 2, 2] }] });
  assert.deepEqual(noArena.value.zones, []);
  assert.equal(noArena.warnings.length, 1);

  const messy = ok({
    template: "race", arena: ARENA,
    zones: [{ kind: "moat", at: [0, 0, 0] }, { kind: "goal" }, "nope", { id: "a", kind: "goal", at: [0, 0, 0] }, { id: "a", kind: "goal", at: [1, 0, 0] }],
  });
  assert.deepEqual(messy.value.zones.map((z) => z.id), ["a", "a-2"]);
  assert.equal(messy.warnings.length, 3);

  const many = ok({ template: "race", arena: ARENA, zones: Array.from({ length: 50 }, () => ({ kind: "keep-out", at: [0, 0, 0] })) });
  assert.equal(many.value.zones.length, GAME_LIMITS.zones);
});

test("one spawn per team, and a team that no longer exists folds into the last one", () => {
  const { value: g, warnings } = ok({
    template: "race", settings: { teams: 2 }, arena: ARENA,
    zones: [{ kind: "spawn", team: 1, at: [0, 0, 0] }, { kind: "spawn", team: 1, at: [5, 0, 0] }, { kind: "spawn", team: 7, at: [9, 0, 0] }],
  });
  assert.deepEqual(g.zones.map((z) => z.team), [1, 2]);
  assert.equal(warnings.length, 1);
  // A goal keeps a team only if that team exists; keep-outs never have one
  const g2 = ok({ template: "capture-the-flag", arena: ARENA, zones: [{ kind: "goal", team: 2, at: [0, 0, 0] }, { kind: "goal", team: 5, at: [1, 0, 0] }, { kind: "keep-out", team: 1, at: [2, 0, 0] }] }).value;
  assert.deepEqual(g2.zones.map((z) => z.team), [2, undefined, undefined]);
  assert.equal(g2.zones[2].ret, "soft");
});

test("the lobby's ring and arrival point always sit inside it", () => {
  const { value: g } = ok({ template: "race", lobby: { at: [0, 10, 40], size: [10, 6, 10], ring: { at: [900, 0, 900], radius: 50 }, arrival: [-900, 99, -900] } });
  const l = g.lobby!;
  assert.ok(inBox(l, ...l.ring.at));
  assert.ok(inBox(l, ...l.arrival));
  assert.equal(l.ring.radius, 5);
  // Missing ring / arrival: the middle of the lobby's floor
  const plain = ok({ template: "race", lobby: { at: [0, 10, 40], size: [10, 6, 10] } }).value.lobby!;
  assert.deepEqual(plain.ring.at, [0, 10, 40]);
  assert.deepEqual(plain.arrival, [0, 10, 40]);
});

test("a lobby on the stage is kept, with a warning, and the game isn't ready", () => {
  const { value: g, warnings } = ok({ ...full(), lobby: { at: [0, 0, 0], size: [12, 6, 12] } });
  assert.ok(boxesOverlap(g.lobby!, g.arena!));
  assert.equal(warnings.length, 1);
  assert.ok(gameMissing(g).includes("Move the lobby off the stage."));
  // A theater box above the arena's ceiling is fine
  const above = ok({ ...full(), lobby: { at: [0, 20, 0], size: [12, 6, 12] } });
  assert.deepEqual(above.warnings, []);
});

test("gameMissing lists what a match still needs", () => {
  assert.deepEqual(gameMissing(newGame("race")), ["Mark the arena.", "Mark the lobby.", "Add a spawn zone for team 1.", "Add a spawn zone for team 2.", "Add a goal zone."]);
  assert.deepEqual(gameMissing(newGame("build-together")), ["Mark the arena.", "Mark the lobby.", "Add a spawn zone."]);
});

test("sameGame ignores the version; stageOf reads a stored arena without trusting it", () => {
  const a = ok(full()).value;
  assert.ok(sameGame(a, { ...a, version: 9 }));
  assert.ok(!sameGame(a, { ...a, template: "collect" }));
  assert.deepEqual(stageOf(a), { minX: -20, maxX: 20, minY: 0, maxY: 20, minZ: -20, maxZ: 20 });
  assert.equal(stageOf(undefined), null);
  assert.equal(stageOf({ arena: null }), null);
  assert.equal(stageOf({ arena: { at: [0, 0], size: [1, 1, 1] } }), null);
  assert.equal(stageOf({ arena: { at: [0, "0", 0], size: [1, 1, 1] } }), null);
});

test("the version passes through as a whole number (the server sets it)", () => {
  assert.equal(ok({ template: "race", version: 4 }).value.version, 4);
  assert.equal(ok({ template: "race", version: -2 }).value.version, 0);
  assert.equal(ok({ template: "race", version: "7" }).value.version, 0);
});

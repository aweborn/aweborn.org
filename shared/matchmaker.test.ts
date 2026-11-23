/** The matchmaker: balance, units, links, determinism, min/max, NPC fill. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formMatch, fillWithNpcs, type PoolUnit } from "./matchmaker.js";
import { defaultSettings, newGame, type Game } from "./game.js";
import { NPC_VERSION } from "./npc.js";

const solo = (...ids: string[]): PoolUnit[] => ids.map((id) => ({ players: [{ id, name: id.toUpperCase() }] }));
const S = (over: Partial<ReturnType<typeof defaultSettings>> = {}) => ({ ...defaultSettings("race"), ...over });
const teamOf = (r: NonNullable<ReturnType<typeof formMatch>>, id: string) => r.slots.find((s) => s.id === id)!.team;
const heads = (r: NonNullable<ReturnType<typeof formMatch>>, teams: number) => Array.from({ length: teams }, (_, t) => r.slots.filter((s) => s.team === t + 1).length);

test("seven players in two teams are 4 v 3, slots numbered from 0", () => {
  const r = formMatch(solo("a", "b", "c", "d", "e", "f", "g"), S(), 7)!;
  assert.equal(r.slots.length, 7);
  assert.deepEqual(heads(r, 2).sort(), [3, 4]);
  assert.deepEqual(r.slots.map((s) => s.slot), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(r.slots.every((s) => s.kind === "human" && s.name === s.id.toUpperCase()));
  assert.deepEqual(r.formed, { policy: "random-balanced", seed: 7, links: [], together: [] });
});

test("the same seed gives the same roster; another seed gives another", () => {
  const pool = solo("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l");
  const a = formMatch(pool, S(), 42)!;
  assert.deepEqual(formMatch(pool, S(), 42), a);
  const different = [1, 2, 3, 4, 5].some((seed) => JSON.stringify(formMatch(pool, S(), seed)!.slots) !== JSON.stringify(a.slots));
  assert.ok(different);
});

test("at most max, at least min", () => {
  const twelve = solo("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l");
  assert.equal(formMatch(twelve, S(), 1)!.slots.length, 8);
  assert.equal(formMatch(solo("a"), S(), 1), null);
  assert.equal(formMatch([], S(), 1, { min: 1 }), null);
  assert.equal(formMatch(solo("a"), S(), 1, { min: 1 }), null); // two teams, one player: a team would be empty
  const one = formMatch(solo("a"), S(), 1, { min: 1, policy: "play-now", allowEmptyTeams: true })!;
  assert.equal(one.slots.length, 1);
  assert.equal(one.formed.policy, "play-now");
});

test("a unit stays on one team, and is never split to fit", () => {
  for (let seed = 0; seed < 30; seed++) {
    const pool: PoolUnit[] = [{ players: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "z", name: "Z" }], together: true }, ...solo("a", "b", "c", "d")];
    const r = formMatch(pool, S(), seed)!;
    assert.equal(teamOf(r, "x"), teamOf(r, "y"));
    assert.equal(teamOf(r, "x"), teamOf(r, "z"));
    assert.deepEqual(heads(r, 2).sort(), [3, 4]);
    assert.deepEqual(r.formed.together, [["x", "y", "z"]]);
  }
  // Three pairs and max 5: only two pairs fit
  const pairs: PoolUnit[] = [["a", "b"], ["c", "d"], ["e", "f"]].map((p) => ({ players: p.map((id) => ({ id, name: id })) }));
  const r = formMatch(pairs, S({ players: { min: 2, max: 5 } }), 3)!;
  assert.equal(r.slots.length, 4);
  // A team of two alone can't play a two-team game against nobody
  assert.equal(formMatch([pairs[0]], S(), 3), null);
  assert.equal(formMatch([pairs[0]], S(), 3, { allowEmptyTeams: true })!.slots.length, 2);
  // A unit bigger than the match is left out
  assert.equal(formMatch([{ players: ["a", "b", "c"].map((id) => ({ id, name: id })) }], S({ players: { min: 1, max: 2 } }), 3), null);
});

test("`with` links share a team, `against` links don't, and both are logged", () => {
  for (let seed = 0; seed < 30; seed++) {
    const r = formMatch(solo("a", "b", "c", "d", "e", "f", "g"), S(), seed, {
      links: [{ a: "a", b: "b", kind: "with" }, { a: "b", b: "c", kind: "with" }, { a: "d", b: "e", kind: "against" }, { a: "a", b: "zz", kind: "against" }],
    })!;
    assert.equal(teamOf(r, "a"), teamOf(r, "b"));
    assert.equal(teamOf(r, "b"), teamOf(r, "c"));
    assert.notEqual(teamOf(r, "d"), teamOf(r, "e"));
    assert.deepEqual(heads(r, 2).sort(), [3, 4]);
    assert.equal(r.formed.links.length, 3); // the link to someone who isn't playing isn't logged
  }
});

test("one team: everyone on team 1, `against` is ignored", () => {
  const r = formMatch(solo("a", "b", "c"), S({ teams: 1 }), 5, { links: [{ a: "a", b: "b", kind: "against" }] })!;
  assert.ok(r.slots.every((s) => s.team === 1));
});

const withRoster = (over: Partial<Game> = {}): Game => ({
  ...newGame("race"),
  npcRoster: [
    { id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 2 } },
    { id: "nova", name: "Nova", behavior: "chase", levels: { min: 4, max: 5 } },
  ],
  ...over,
});

test("NPCs fill to max, balanced, cycling the roster, level clamped per entry", () => {
  const g = withRoster();
  const start = formMatch(solo("a"), g.settings, 1, { min: 1, allowEmptyTeams: true })!.slots;
  const all = fillWithNpcs(start, g, 3, 9);
  assert.equal(all.length, 8);
  assert.deepEqual([all.filter((s) => s.team === 1).length, all.filter((s) => s.team === 2).length], [4, 4]);
  const npcs = all.filter((s) => s.kind === "npc");
  assert.equal(npcs.length, 7);
  assert.equal(new Set(npcs.map((s) => s.id)).size, 7);
  assert.deepEqual(all.map((s) => s.slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const s of npcs) {
    assert.match(s.id, /^npc:(bolt|nova):\d+$/);
    assert.equal(s.npc!.version, NPC_VERSION);
    assert.equal(s.npc!.level, s.npc!.rosterId === "bolt" ? 2 : 4);
    assert.match(s.name, s.npc!.rosterId === "bolt" ? /^Bolt( \d)?$/ : /^Nova( \d)?$/);
  }
  assert.ok(npcs.some((s) => s.npc!.rosterId === "bolt") && npcs.some((s) => s.npc!.rosterId === "nova"));
  assert.deepEqual(fillWithNpcs(start, g, 3, 9), all); // deterministic
  assert.equal(start.length, 1); // the input is not changed
});

test("NPCs fill to min and give every empty team one", () => {
  const g = withRoster({ settings: { ...defaultSettings("race"), teams: 3, players: { min: 2, max: 9 } } });
  const start = formMatch(solo("a"), g.settings, 1, { min: 1, allowEmptyTeams: true })!.slots;
  const few = fillWithNpcs(start, g, 1, 2, "min");
  assert.equal(few.length, 3);
  assert.deepEqual([1, 2, 3].map((t) => few.filter((s) => s.team === t).length), [1, 1, 1]);
  assert.deepEqual(fillWithNpcs(start, newGame("race"), 1, 2), start); // no roster, no NPCs
});

test("fillWithNpcs cycles the roster evenly and numbers a roster NPC used more than once", () => {
  const game: Game = { ...newGame("race"), settings: { ...defaultSettings("race"), teams: 2, players: { min: 2, max: 6 } }, npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }, { id: "pip", name: "Pip", behavior: "auto", levels: { min: 1, max: 5 } }] };
  for (let seed = 0; seed < 8; seed++) {
    const out = fillWithNpcs([{ slot: 0, team: 1, kind: "human", id: "a", name: "A" }], game, 3, seed);
    const names = out.filter((s) => s.kind === "npc").map((s) => s.name);
    assert.equal(names.length, 5);
    assert.equal(new Set(names).size, 5, names.join());
    assert.deepEqual([...names].sort(), [...(names[0] === "Bolt" ? ["Bolt", "Bolt 2", "Bolt 3", "Pip", "Pip 2"] : ["Bolt", "Bolt 2", "Pip", "Pip 2", "Pip 3"])].sort());
    assert.equal(new Set(out.map((s) => s.id)).size, out.length);
  }
});

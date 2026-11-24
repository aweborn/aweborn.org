import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsOf, inBounds, parseGame, type Game, type GameTemplate } from "./game.ts";
import { MATCH_SIM_VERSION, spawnPoint, type MatchItem, type MatchSetup, type MatchSlot, type MatchState } from "./match.ts";
import { NPC_LEVELS, NPC_VERSION, NPC_WALK_SPEED, initNpc, npcSpeed, stepNpc, type NpcMind } from "./npc.ts";

// A 40 × 40 stage at the world's middle, team 1 spawning west, team 2 east.
const ARENA = { at: [0, 0, 0], size: [40, 20, 40] };
const SPAWNS = [
  { kind: "spawn", team: 1, at: [-15, 0, 0], size: [6, 3, 6] },
  { kind: "spawn", team: 2, at: [15, 0, 0], size: [6, 3, 6] },
];

function game(template: GameTemplate, zones: unknown[] = [], settings: Record<string, unknown> = {}): Game {
  const p = parseGame({ template, arena: ARENA, zones: [...SPAWNS, ...zones], settings: { teams: 2, ...settings } });
  assert.ok(p.ok);
  return p.value;
}

type SlotSpec = { team: number; kind?: "human" | "npc"; behavior?: string; level?: number };
function setupOf(g: Game, specs: SlotSpec[], seed = 7): MatchSetup {
  const slots: MatchSlot[] = specs.map((s, i) => {
    const kind = s.kind ?? "npc";
    return {
      slot: i, team: s.team, kind, id: kind === "npc" ? `npc:n:${i}` : `p${i}`, name: kind === "npc" ? "Bolt" : "Player",
      ...(kind === "npc" ? { npc: { rosterId: "n", behavior: s.behavior ?? "auto", level: s.level ?? 5, version: NPC_VERSION } } : {}),
    };
  });
  return { matchId: "m", worldId: "w", game: g, seed, simVersion: MATCH_SIM_VERSION, slots, formed: { policy: "play-now", seed, links: [], together: [] } };
}

/** A hand-made referee state: everyone at their spawn, playing (the referee is not called here). */
function stateOf(setup: MatchSetup, items: MatchItem[] = [], over: Partial<MatchState> = {}): MatchState {
  return {
    tick: 0, phase: "playing", round: 1, left: 9999,
    scores: [0, 0], rounds: [0, 0],
    players: setup.slots.map((s) => {
      const [x, y, z] = spawnPoint(setup, s.slot);
      return { slot: s.slot, x, y, z, fresh: true, out: false, left: false, outsideTicks: 0, keepOutTicks: 0, carrying: null, score: 0, returns: 0, zones: [] };
    }),
    items, hill: 0, vars: [0, 0, 0], rng: 1, winner: null,
    ...over,
  };
}

const item = (id: string, kind: MatchItem["kind"], x: number, z: number, team?: number): MatchItem =>
  ({ id, kind, x, y: 0, z, home: [x, 0, z], heldBy: null, active: true, ...(team ? { team } : {}) });

/** Put a slot where its mind says (what the server's sampling does), without touching the old state. */
function place(state: MatchState, slot: number, m: NpcMind): MatchState {
  return { ...state, tick: state.tick + 1, players: state.players.map((p) => (p.slot === slot ? { ...p, x: m.x, y: m.y, z: m.z } : p)) };
}

/**
 * Step one NPC for up to `ticks`, feeding its position back like the server does.
 * `referee` stands in for the rule step (take a pickup, hand over a flag); `until` stops early.
 */
function run(setup: MatchSetup, start: MatchState, slot: number, ticks: number, opts: {
  until?: (m: NpcMind, s: MatchState) => boolean;
  referee?: (s: MatchState, m: NpcMind) => MatchState;
  each?: (m: NpcMind, s: MatchState) => void;
} = {}): { mind: NpcMind; state: MatchState; ticks: number } {
  let mind = initNpc(setup, slot), state = start;
  for (let t = 1; t <= ticks; t++) {
    mind = stepNpc(setup, state, slot, mind);
    state = place(state, slot, mind);
    if (opts.referee) state = opts.referee(state, mind);
    opts.each?.(mind, state);
    if (opts.until?.(mind, state)) return { mind, state, ticks: t };
  }
  return { mind, state, ticks };
}

const near = (m: { x: number; z: number }, x: number, z: number, r = 1.5): boolean => Math.hypot(m.x - x, m.z - z) <= r;
const inZone = (g: Game, id: string, m: NpcMind): boolean => inBounds(boundsOf(g.zones.find((z) => z.id === id)!), m.x, m.y, m.z);

const RACE_GOAL = { id: "finish", kind: "goal", at: [0, 0, 12], size: [4, 3, 4] };
const WALL = { id: "wall", kind: "keep-out", at: [-6, 0, 0], size: [4, 6, 12] };

test("initNpc starts at the slot's spawn with a seed of its own", () => {
  const setup = setupOf(game("race", [RACE_GOAL]), [{ team: 1 }, { team: 1 }, { team: 2 }]);
  const a = initNpc(setup, 0), b = initNpc(setup, 1);
  assert.deepEqual([a.x, a.y, a.z], spawnPoint(setup, 0));
  assert.equal(a.goal, null);
  assert.notEqual(a.rng, b.rng);
  assert.deepEqual(initNpc(setup, 0), a);
  assert.notEqual(initNpc({ ...setup, seed: 8 }, 0).rng, a.rng);
});

test("the same setup and states give the same moves", () => {
  const setup = setupOf(game("collect"), [{ team: 1, level: 1 }, { team: 2, level: 2 }], 99);
  const items = [item("a", "pickup", 3, 4), item("b", "pickup", -8, -9), item("c", "pickup", 10, 12)];
  const trail = (): string => {
    const path: number[] = [];
    run(setup, stateOf(setup, items), 0, 300, { each: (m) => path.push(m.x, m.z, m.wait, m.rng) });
    return JSON.stringify(path);
  };
  assert.equal(trail(), trail());
});

test("a different seed changes what a low-level NPC does", () => {
  const g = game("survive");
  const path = (seed: number): string => {
    const setup = setupOf(g, [{ team: 1, level: 1 }], seed);
    const p: number[] = [];
    run(setup, stateOf(setup), 0, 200, { each: (m) => p.push(m.x, m.z) });
    return JSON.stringify(p);
  };
  assert.notEqual(path(1), path(2));
});

test("stepNpc does not change its arguments", () => {
  const setup = setupOf(game("collect"), [{ team: 1, level: 2 }]);
  const state = stateOf(setup, [item("a", "pickup", 3, 4)]);
  let mind = initNpc(setup, 0);
  for (let i = 0; i < 30; i++) {
    const before = JSON.stringify([setup, state, mind]);
    const next = stepNpc(setup, state, 0, mind);
    assert.equal(JSON.stringify([setup, state, mind]), before);
    assert.notEqual(next, mind);
    mind = next;
  }
});

test("race: reaches the goal zone", () => {
  const g = game("race", [RACE_GOAL]);
  const setup = setupOf(g, [{ team: 1 }]);
  const r = run(setup, stateOf(setup), 0, 200, { until: (m) => inZone(g, "finish", m) });
  assert.ok(inZone(g, "finish", r.mind), `stopped at ${r.mind.x},${r.mind.z}`);
  assert.equal(r.mind.goal?.why, "goal");
});

test("race: ignores another team's goal", () => {
  const g = game("race", [{ id: "theirs", kind: "goal", team: 2, at: [-12, 0, 8], size: [4, 3, 4] }, { id: "ours", kind: "goal", team: 1, at: [10, 0, -10], size: [4, 3, 4] }]);
  const setup = setupOf(g, [{ team: 1 }]);
  const r = run(setup, stateOf(setup), 0, 300, { until: (m) => inZone(g, "ours", m), each: (m) => assert.ok(!inZone(g, "theirs", m)) });
  assert.ok(inZone(g, "ours", r.mind));
});

test("race: walks around a keep-out that is in the way", () => {
  const g = game("race", [WALL, { id: "finish", kind: "goal", at: [5, 0, 0], size: [4, 3, 4] }]);
  const setup = setupOf(g, [{ team: 1 }]);
  const r = run(setup, stateOf(setup), 0, 300, { until: (m) => inZone(g, "finish", m), each: (m) => assert.ok(!inZone(g, "wall", m)) });
  assert.ok(inZone(g, "finish", r.mind), `stopped at ${r.mind.x},${r.mind.z}`);
});

test("collect: fetches the nearest pickup, then the next", () => {
  const setup = setupOf(game("collect"), [{ team: 1 }]);
  const items = [item("far", "pickup", 12, 10), item("near", "pickup", -10, 6)];
  const taken: string[] = [];
  // The referee's part: a touched pickup is gone
  const referee = (s: MatchState, m: NpcMind): MatchState => ({
    ...s,
    items: s.items.map((i) => {
      if (!i.active || !near(m, i.x, i.z)) return i;
      taken.push(i.id);
      return { ...i, active: false };
    }),
  });
  run(setup, stateOf(setup, items), 0, 400, { referee, until: () => taken.length === 2 });
  assert.deepEqual(taken, ["near", "far"]);
});

test("capture the flag: takes the enemy flag and carries it home", () => {
  const g = game("capture-the-flag", [{ id: "base-1", kind: "goal", team: 1, at: [-15, 0, 10], size: [4, 3, 4] }, { id: "base-2", kind: "goal", team: 2, at: [15, 0, -10], size: [4, 3, 4] }]);
  const setup = setupOf(g, [{ team: 1 }, { team: 2, kind: "human" }]);
  const flags = [item("flag-1", "flag", -15, 10, 1), item("flag-2", "flag", 15, -10, 2)];
  let tookAt = 0;
  // The referee's part: touching the enemy flag picks it up, and it travels with the carrier
  const referee = (s: MatchState, m: NpcMind): MatchState => {
    const f = s.items.find((i) => i.id === "flag-2")!;
    if (f.heldBy === null && !near(m, f.x, f.z)) return s;
    if (!tookAt) tookAt = s.tick;
    return {
      ...s,
      items: s.items.map((i) => (i.id === "flag-2" ? { ...i, heldBy: 0, x: m.x, z: m.z } : i)),
      players: s.players.map((p) => (p.slot === 0 ? { ...p, carrying: "flag-2" } : p)),
    };
  };
  const r = run(setup, stateOf(setup, flags), 0, 600, { referee, until: (m, s) => s.players[0].carrying !== null && inZone(g, "base-1", m) });
  assert.ok(tookAt > 0, "never reached the flag");
  assert.ok(inZone(g, "base-1", r.mind), `stopped at ${r.mind.x},${r.mind.z}`);
  assert.equal(r.mind.goal?.why, "carry");
});

test("capture the flag: without a base zone the flag goes to the spawn zone", () => {
  const g = game("capture-the-flag", [{ id: "base-2", kind: "goal", team: 2, at: [15, 0, -10], size: [4, 3, 4] }]);
  const setup = setupOf(g, [{ team: 1 }, { team: 2, kind: "human" }]);
  const held = { ...item("flag-2", "flag", 0, 0, 2), heldBy: 0 };
  const state = stateOf(setup, [held]);
  const start = { ...state, players: state.players.map((p) => (p.slot === 0 ? { ...p, x: 0, z: 0, carrying: "flag-2" } : p)) };
  const r = run(setup, start, 0, 300, { until: (m) => m.wait > 0 && near(m, -15, 0, 0.5) });
  assert.ok(near(r.mind, -15, 0, 0.5), `stopped at ${r.mind.x},${r.mind.z}`);
});

test("capture the flag: every other NPC on a team guards the base", () => {
  const g = game("capture-the-flag", [{ id: "base-1", kind: "goal", team: 1, at: [-15, 0, 10], size: [4, 3, 4] }]);
  const setup = setupOf(g, [{ team: 1 }, { team: 1 }, { team: 2, kind: "human" }]);
  const state = stateOf(setup, [item("flag-2", "flag", 15, -10, 2)]);
  const runner = run(setup, state, 0, 100), keeper = run(setup, state, 1, 300);
  assert.equal(runner.mind.goal?.why, "flag");
  assert.equal(keeper.mind.goal?.why, "guard");
  assert.ok(near(keeper.mind, -15, 10, 3));
});

test("king of the hill: gets onto the hill and stays there", () => {
  const g = game("king-of-the-hill", [{ id: "hill", kind: "goal", at: [0, 0, -6], size: [6, 3, 6] }]);
  const setup = setupOf(g, [{ team: 1, level: 3 }]);
  const arrive = run(setup, stateOf(setup), 0, 300, { until: (m) => inZone(g, "hill", m) });
  assert.ok(inZone(g, "hill", arrive.mind));
  // Level 3 slips now and then: most of the next minute is still spent on the hill
  let on = 0, mind = arrive.mind, state = arrive.state;
  for (let t = 0; t < 600; t++) {
    mind = stepNpc(setup, state, 0, mind);
    state = place(state, 0, mind);
    if (inZone(g, "hill", mind)) on++;
  }
  assert.ok(on > 400, `on the hill ${on} of 600 ticks`);
});

test("king of the hill: a level 5 NPC never steps off once it holds the hill", () => {
  const g = game("king-of-the-hill", [{ id: "hill", kind: "goal", at: [0, 0, -6], size: [6, 3, 6] }]);
  for (const behavior of ["auto", "guard", "fetch"]) {
    const setup = setupOf(g, [{ team: 1, level: 5, behavior }]);
    let held = false;
    run(setup, stateOf(setup), 0, 800, { each: (m) => { if (inZone(g, "hill", m)) held = true; else assert.ok(!held, `${behavior} left the hill`); } });
    assert.ok(held, `${behavior} never got there`);
  }
});

test("survive: wanders near the middle", () => {
  const setup = setupOf(game("survive", [], { teams: 1 }), [{ team: 1, level: 4 }]);
  const spots = new Set<string>();
  const r = run(setup, stateOf(setup), 0, 600, { each: (m, s) => { if (s.tick > 150) { assert.ok(near(m, 0, 0, 12), `${m.x},${m.z}`); spots.add(`${m.x},${m.z}`); } } });
  assert.equal(r.mind.y, spawnPoint(setup, 0)[1]);
  assert.ok(spots.size > 20, "stood still instead of wandering");
});

test("build together: fetches a piece and carries it to the goal", () => {
  const g = game("build-together", [{ id: "site", kind: "goal", at: [8, 0, 8], size: [4, 3, 4] }], { teams: 1 });
  const setup = setupOf(g, [{ team: 1 }]);
  const referee = (s: MatchState, m: NpcMind): MatchState => {
    const p = s.items[0];
    if (p.heldBy === null && !near(m, p.x, p.z)) return s;
    return { ...s, items: [{ ...p, heldBy: 0, x: m.x, z: m.z }], players: s.players.map((x) => ({ ...x, carrying: "piece-1" })) };
  };
  const r = run(setup, stateOf(setup, [item("piece-1", "piece", -4, -10)]), 0, 600, { referee, until: (m, s) => s.items[0].heldBy === 0 && inZone(g, "site", m) });
  assert.equal(r.state.items[0].heldBy, 0);
  assert.ok(inZone(g, "site", r.mind));
});

test("build together: with no goal zone the piece goes to the arena's middle, and placed pieces are left alone", () => {
  const setup = setupOf(game("build-together", [], { teams: 1 }), [{ team: 1 }]);
  const held = { ...item("piece-1", "piece", -10, -10), heldBy: 0 };
  const carrying = run(setup, stateOf(setup, [held]), 0, 300, { until: (m) => near(m, 0, 0, 1) });
  assert.ok(near(carrying.mind, 0, 0, 1));
  const done = run(setup, stateOf(setup, [item("piece-1", "piece", 1, 1)]), 0, 50);
  assert.equal(done.mind.goal?.why, "wander");
});

test("chase: heads for the nearest opponent, and for the objective when there is none", () => {
  const g = game("king-of-the-hill", [{ id: "hill", kind: "goal", at: [0, 0, -6], size: [6, 3, 6] }]);
  const setup = setupOf(g, [{ team: 1, behavior: "chase" }, { team: 2, kind: "human" }, { team: 1, kind: "human" }]);
  const state = stateOf(setup);
  const foe = { ...state, players: state.players.map((p) => (p.slot === 1 ? { ...p, x: 5, z: 12 } : p)) };
  const r = run(setup, foe, 0, 300, { until: (m) => near(m, 5, 12, 0.5) });
  assert.ok(near(r.mind, 5, 12, 0.5));
  assert.equal(r.mind.goal?.why, "chase");
  const gone = { ...state, players: state.players.map((p) => (p.slot === 1 ? { ...p, left: true } : p)) };
  assert.equal(run(setup, gone, 0, 20).mind.goal?.why, "hill");
});

test("guard: patrols close to its own spawn", () => {
  const setup = setupOf(game("collect"), [{ team: 2, behavior: "guard", level: 4 }]);
  const spots = new Set<string>();
  run(setup, stateOf(setup, [item("a", "pickup", 0, 0)]), 0, 400, { each: (m, s) => { if (s.tick > 100) { assert.ok(near(m, 15, 0, 4.5), `${m.x},${m.z}`); spots.add(`${m.x},${m.z}`); } } });
  assert.ok(spots.size > 10);
});

test("follow: stays about two metres from the nearest human teammate", () => {
  const setup = setupOf(game("collect"), [{ team: 1, behavior: "follow" }, { team: 1, kind: "human" }, { team: 2, kind: "human" }]);
  let state = stateOf(setup), mind = initNpc(setup, 0);
  // The human walks east across the stage at a slow walk
  for (let t = 0; t < 250; t++) {
    state = { ...state, players: state.players.map((p) => (p.slot === 1 ? { ...p, x: -12 + t * 0.1, z: 8 } : p)) };
    mind = stepNpc(setup, state, 0, mind);
    state = place(state, 0, mind);
  }
  const lead = state.players[1];
  const d = Math.hypot(mind.x - lead.x, mind.z - lead.z);
  assert.ok(d >= 1 && d <= 3.5, `ended ${d.toFixed(2)} m away`);
  assert.ok(mind.x < lead.x, "should trail behind the way they walk");
});

test("follow: with no human teammate it plays the objective", () => {
  const setup = setupOf(game("collect"), [{ team: 1, behavior: "follow" }, { team: 2, kind: "human" }]);
  assert.equal(run(setup, stateOf(setup, [item("a", "pickup", 3, 4)]), 0, 10).mind.goal?.why, "pickup");
});

test("never leaves the arena or enters a keep-out, whatever the seed, level and behaviour", () => {
  const zones = [
    WALL,
    { id: "pit", kind: "keep-out", at: [6, 0, 7], size: [5, 6, 3] },
    { id: "edge", kind: "keep-out", at: [0, 0, -18], size: [10, 6, 4] },
    { id: "hill", kind: "goal", at: [10, 0, -8], size: [5, 3, 5] },
  ];
  const templates: GameTemplate[] = ["race", "collect", "capture-the-flag", "king-of-the-hill", "survive", "build-together"];
  const behaviors = ["auto", "chase", "guard", "fetch", "follow"];
  let runs = 0;
  for (const template of templates) {
    const g = game(template, zones);
    const arena = boundsOf(g.arena!);
    const walls = g.zones.filter((z) => z.kind === "keep-out").map(boundsOf);
    for (let seed = 1; seed <= 4; seed++) {
      const level = ((seed + runs) % 5) + 1, behavior = behaviors[(seed + runs) % behaviors.length];
      runs++;
      const setup = setupOf(g, [{ team: 1, level, behavior }, { team: 2, level: 1, behavior: "chase" }, { team: 2, kind: "human" }], seed * 1013);
      // Things to go for in every corner, some of them inside or right beside a keep-out
      const items = [item("p1", "pickup", -6, 0), item("p2", "pickup", 19.8, 19.8), item("p3", "pickup", -3.9, 5), item("f2", "flag", 6, 9, 2), item("f1", "flag", -19, -19, 1), item("b1", "piece", 0, -15.9)];
      for (const slot of [0, 1]) {
        const y = spawnPoint(setup, slot)[1];
        run(setup, stateOf(setup, items), slot, 1500, {
          each: (m) => {
            const where = `${template} seed ${seed} level ${level} ${behavior} slot ${slot} at ${m.x},${m.z}`;
            assert.ok(m.x >= arena.minX + 0.49 && m.x <= arena.maxX - 0.49 && m.z >= arena.minZ + 0.49 && m.z <= arena.maxZ - 0.49, `left the arena: ${where}`);
            assert.ok(!walls.some((w) => inBounds(w, m.x, m.y, m.z)), `in a keep-out: ${where}`);
            assert.equal(m.y, y);
          },
        });
      }
    }
  }
  assert.equal(runs, 24);
});

test("a step is never longer than the level's walking speed allows", () => {
  for (const level of [1, 3, 5]) {
    const setup = setupOf(game("race", [WALL, RACE_GOAL]), [{ team: 1, level }]);
    let last = initNpc(setup, 0);
    run(setup, stateOf(setup), 0, 200, { each: (m) => { assert.ok(Math.hypot(m.x - last.x, m.z - last.z) <= npcSpeed(level) / 10 + 0.011); last = m; } });
  }
  assert.equal(npcSpeed(5), NPC_WALK_SPEED);
  assert.ok(Math.abs(npcSpeed(1) - NPC_WALK_SPEED * 0.6) < 1e-9);
  assert.equal(npcSpeed(5, 2), NPC_WALK_SPEED * 2);
});

test("level 5 reaches the goal sooner than level 1", () => {
  const g = game("race", [RACE_GOAL]);
  const time = (level: number): number => {
    const setup = setupOf(g, [{ team: 1, level }]);
    const r = run(setup, stateOf(setup), 0, 2000, { until: (m) => inZone(g, "finish", m) });
    assert.ok(inZone(g, "finish", r.mind), `level ${level} never arrived`);
    return r.ticks;
  };
  const slow = time(1), fast = time(5);
  assert.ok(fast < slow, `level 5 took ${fast} ticks, level 1 took ${slow}`);
});

test("lower levels wait longer between decisions and slip more", () => {
  for (const k of ["speed", "wait", "slip"] as const) assert.equal(NPC_LEVELS[k].length, 5);
  for (let i = 1; i < 5; i++) {
    assert.ok(NPC_LEVELS.wait[i] < NPC_LEVELS.wait[i - 1]);
    assert.ok(NPC_LEVELS.slip[i] < NPC_LEVELS.slip[i - 1]);
    assert.ok(NPC_LEVELS.speed[i] > NPC_LEVELS.speed[i - 1]);
  }
  const g = game("race", [RACE_GOAL]);
  const slips = (level: number): number => {
    const setup = setupOf(g, [{ team: 1, level }]);
    let n = 0, mind = initNpc(setup, 0);
    const state = stateOf(setup);
    for (let t = 0; t < 2000; t++) {
      mind = stepNpc(setup, place(state, 0, mind), 0, mind);
      if (mind.wait === NPC_LEVELS.wait[level - 1] && mind.goal?.why === "slip") n++;
    }
    return n;
  };
  assert.ok(slips(1) > 10);
  assert.equal(slips(5), 0);
  const first = stepNpc(setupOf(g, [{ team: 1, level: 1 }]), stateOf(setupOf(g, [{ team: 1, level: 1 }])), 0, initNpc(setupOf(g, [{ team: 1, level: 1 }]), 0));
  assert.equal(first.wait, 12);
});

test("stands still during the countdown, the break, and when out or gone", () => {
  const setup = setupOf(game("race", [RACE_GOAL]), [{ team: 1 }]);
  const start = initNpc(setup, 0);
  const still = (state: MatchState): void => {
    let mind = start;
    for (let t = 0; t < 30; t++) mind = stepNpc(setup, state, 0, mind);
    assert.deepEqual(mind, start);
  };
  const base = stateOf(setup);
  still({ ...base, phase: "countdown" });
  still({ ...base, phase: "break" });
  still({ ...base, phase: "finished" });
  still({ ...base, players: [{ ...base.players[0], out: true }] });
  still({ ...base, players: [{ ...base.players[0], left: true }] });
  assert.notDeepEqual(stepNpc(setup, base, 0, start), start);
});

test("snaps to where the referee put it after a return", () => {
  const g = game("race", [RACE_GOAL]);
  const setup = setupOf(g, [{ team: 1, level: 1 }]);
  const mid = run(setup, stateOf(setup), 0, 40);
  const [sx, sy, sz] = spawnPoint(setup, 0);
  assert.ok(!near(mid.mind, sx, sz, 3));
  // The referee sends it back to spawn; the countdown shows the snap alone
  const back = { ...mid.state, phase: "countdown" as const, players: [{ ...mid.state.players[0], x: sx, y: sy, z: sz, returns: 1 }] };
  const snapped = stepNpc(setup, back, 0, mid.mind);
  assert.deepEqual([snapped.x, snapped.y, snapped.z, snapped.goal, snapped.wait], [sx, sy, sz, null, 0]);
  // While playing it snaps and sets off again from there
  const going = stepNpc(setup, { ...back, phase: "playing" }, 0, mid.mind);
  assert.ok(near(going, sx, sz, 0.5));
  // A small disagreement (a tick of lag) is not a return
  const lag = { ...mid.state, players: [{ ...mid.state.players[0], x: mid.mind.x - 1 }] };
  assert.ok(Math.abs(stepNpc(setup, lag, 0, mid.mind).x - mid.mind.x) < 1);
});

test("minds are plain JSON: a round trip changes nothing", () => {
  const setup = setupOf(game("collect"), [{ team: 1, level: 2 }, { team: 2, kind: "human" }], 31);
  const items = [item("a", "pickup", 3, 4), item("b", "pickup", -8, -9)];
  let plain = initNpc(setup, 0), viaJson = initNpc(setup, 0), state = stateOf(setup, items);
  for (let t = 0; t < 200; t++) {
    plain = stepNpc(setup, state, 0, plain);
    viaJson = JSON.parse(JSON.stringify(stepNpc(setup, state, 0, viaJson))) as NpcMind;
    assert.deepEqual(viaJson, plain);
    assert.deepEqual(Object.keys(plain).sort(), ["goal", "rng", "wait", "x", "y", "z"]);
    state = place(state, 0, plain);
  }
});

test("a slot with no NPC details plays auto at a middle level", () => {
  const g = game("race", [RACE_GOAL]);
  const setup = setupOf(g, [{ team: 1, kind: "human" }]);
  const r = run(setup, stateOf(setup), 0, 400, { until: (m) => inZone(g, "finish", m) });
  assert.ok(inZone(g, "finish", r.mind));
});

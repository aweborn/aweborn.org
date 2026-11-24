import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGame, type Game } from "./game.js";
import { BURST_S, SLACK_M, SPEED_MARGIN, checkSample, rejectionsIn, sanityLimits, sanityStart, type SanityState } from "./match-sanity.js";
import { SPRINT_SPEED } from "./sim/interior.js";

function game(settings: Record<string, unknown> = {}): Game {
  const p = parseGame({ template: "race", version: 1, settings, arena: { at: [0, 0, 0], size: [40, 20, 40] }, zones: [] });
  assert.ok(p.ok);
  return p.value;
}
/** Feed positions ten times a second; returns how many were refused and the final state. */
function walk(limits: ReturnType<typeof sanityLimits>, from: SanityState, steps: number, step: (i: number) => { x: number; y: number; z: number }, everyMs = 100) {
  let st = from;
  let refused = 0;
  for (let i = 1; i <= steps; i++) {
    const v = checkSample(limits, st, step(i), from.at + i * everyMs);
    st = v.state;
    if (!v.ok) refused++;
  }
  return { st, refused };
}

test("honest movement passes: sprinting for a minute, with jitter, never trips the check", () => {
  const limits = sanityLimits(game());
  const start = sanityStart(limits, { x: 0, y: 0, z: 0 }, 1000);
  // Flat-out sprint along a zigzag, sampled every 100 ms
  const even = walk(limits, start, 600, (i) => ({ x: (SPRINT_SPEED * i) / 10, y: 0, z: Math.sin(i / 5) }));
  assert.equal(even.refused, 0);
  // The same sprint seen through a bad connection: every third second arrives all at once
  let st = start;
  let refused = 0;
  for (let i = 1; i <= 600; i++) {
    if (Math.floor(i / 10) % 3 === 1 && i % 10 !== 9) continue; // nothing new seen for most of that second
    const v = checkSample(limits, st, { x: (SPRINT_SPEED * i) / 10, y: 0, z: 0 }, 1000 + i * 100);
    st = v.state;
    if (!v.ok) refused++;
  }
  assert.equal(refused, 0);
});

test("a teleport is refused, and nothing is spent on it", () => {
  const limits = sanityLimits(game());
  const start = sanityStart(limits, { x: -15, y: 0, z: 0 }, 0);
  const jump = checkSample(limits, start, { x: 0, y: 0, z: 15 }, 100);
  assert.equal(jump.ok, false);
  assert.equal(jump.ok === false && jump.why, "speed");
  assert.deepEqual([jump.state.x, jump.state.y, jump.state.z], [-15, 0, 0]);
  // Still free to walk on from where they really are
  assert.equal(checkSample(limits, jump.state, { x: -14.5, y: 0, z: 0.3 }, 200).ok, true);
  // The most that is believed in one go is one burst, and it has to be earned back
  const burst = SPRINT_SPEED * SPEED_MARGIN * BURST_S + SLACK_M;
  const blink = checkSample(limits, start, { x: -15 + burst - 0.01, y: 0, z: 0 }, 100);
  assert.equal(blink.ok, true);
  assert.equal(checkSample(limits, blink.state, { x: -15 + 2 * burst - 0.02, y: 0, z: 0 }, 200).ok, false);
});

test("a speed hack is refused over time: twice sprint speed runs out of allowance within two seconds", () => {
  const limits = sanityLimits(game());
  const start = sanityStart(limits, { x: 0, y: 0, z: 0 }, 0);
  const fast = walk(limits, start, 30, (i) => ({ x: (2 * SPRINT_SPEED * i) / 10, y: 0, z: 0 }));
  assert.ok(fast.refused > 0);
  // And the ground actually covered is no more than sprinting plus one burst
  assert.ok(fast.st.x <= SPRINT_SPEED * SPEED_MARGIN * 3 + SPRINT_SPEED * SPEED_MARGIN * BURST_S + SLACK_M + 1e-6);
});

test("the speed trait scales the limit", () => {
  const slow = sanityLimits(game({ traits: { speedMul: 0.5 } }));
  const fast = sanityLimits(game({ traits: { speedMul: 2 } }));
  assert.equal(slow.side, SPRINT_SPEED * 0.5 * SPEED_MARGIN);
  const step = (i: number) => ({ x: (SPRINT_SPEED * i) / 10, y: 0, z: 0 });
  assert.ok(walk(slow, sanityStart(slow, { x: 0, y: 0, z: 0 }, 0), 50, step).refused > 0);
  assert.equal(walk(fast, sanityStart(fast, { x: 0, y: 0, z: 0 }, 0), 50, (i) => ({ x: (2 * SPRINT_SPEED * i) / 10, y: 0, z: 0 })).refused, 0);
});

test("up and down have their own limits: jumps and falls pass, flying up without the jetpack doesn't", () => {
  const noFly = sanityLimits(game({ traits: { fly: false } }));
  const fly = sanityLimits(game());
  assert.ok(fly.up > noFly.up);
  // A long fall (30 m in 2.5 s) is fine either way
  assert.equal(walk(noFly, sanityStart(noFly, { x: 0, y: 30, z: 0 }, 0), 25, (i) => ({ x: 0, y: 30 - 4.9 * (i / 10) ** 2, z: 0 })).refused, 0);
  // Rising at 20 m/s: the jetpack can, legs can't
  const rise = (i: number) => ({ x: 0, y: 2 * i, z: 0 });
  assert.equal(walk(fly, sanityStart(fly, { x: 0, y: 0, z: 0 }, 0), 40, rise).refused, 0);
  assert.ok(walk(noFly, sanityStart(noFly, { x: 0, y: 0, z: 0 }, 0), 40, rise).refused > 0);
  // A jump (5 m/s up) with the jetpack off
  assert.equal(walk(noFly, sanityStart(noFly, { x: 0, y: 0, z: 0 }, 0), 5, (i) => ({ x: 0, y: 0.5 * i - 0.049 * i * i, z: 0 })).refused, 0);
});

test("a walled arena: a sample outside the box is refused however slowly it got there; other edges don't check the box", () => {
  const walled = sanityLimits(game({ edge: "wall" }));
  assert.ok(walled.wall);
  const st = sanityStart(walled, { x: 19.5, y: 0, z: 0 }, 0);
  const out = checkSample(walled, st, { x: 21, y: 0, z: 0 }, 100);
  assert.equal(out.ok === false && out.why, "wall");
  assert.equal(checkSample(walled, st, { x: 20.2, y: 0, z: 0 }, 100).ok, true); // rounding and the body's width
  // Starting from a spot outside the wall is brought inside, so "go back" never points outside
  assert.equal(sanityStart(walled, { x: 30, y: 0, z: 0 }, 0).x, 20.5);
  const soft = sanityLimits(game({ edge: "soft" }));
  assert.equal(soft.wall, null);
  assert.equal(checkSample(soft, sanityStart(soft, { x: 19.5, y: 0, z: 0 }, 0), { x: 21, y: 0, z: 0 }, 100).ok, true);
});

test("odd gravity: the axes an honest fall could cross at any speed are not checked", () => {
  const side = sanityLimits(game(), { x: 6, y: -9.8, z: 0 });
  assert.equal(side.side, Infinity);
  assert.equal(checkSample(side, sanityStart(side, { x: 0, y: 0, z: 0 }, 0), { x: 300, y: 0, z: 0 }, 100).ok, true);
  const up = sanityLimits(game(), { x: 0, y: 3, z: 0 });
  assert.equal(up.up, Infinity);
  assert.equal(up.down, Infinity);
  assert.notEqual(up.side, Infinity);
  // Heavy gravity raises the fall limit
  assert.ok(sanityLimits(game(), { x: 0, y: -30, z: 0 }).down > sanityLimits(game()).down);
});

test("rejectionsIn lists the refused samples a record holds", () => {
  const frames = [
    { t: 3, s: [], c: [{ type: "reject" as const, slot: 1, why: "speed" as const, at: [0, 0, 15] as [number, number, number] }] },
    { t: 4, s: [0, 1, 2, 3] },
    { t: 9, s: [], c: [{ type: "leave" as const, slot: 0 }, { type: "reject" as const, slot: 0, why: "wall" as const, at: [30, 0, 0] as [number, number, number] }] },
  ];
  assert.deepEqual(rejectionsIn({ frames }), [{ tick: 3, slot: 1, why: "speed", at: [0, 0, 15] }, { tick: 9, slot: 0, why: "wall", at: [30, 0, 0] }]);
});

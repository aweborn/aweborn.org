import { test } from "node:test";
import assert from "node:assert/strict";
import { clockSample, addSample, bestOffset, CLOCK_SAMPLES, CLOCK_SAMPLE_TTL_MS, type ClockSample } from "./clock.ts";

test("a phone whose clock is 90 s slow measures +90 s, within half its round trip", () => {
  const skew = 90_000;
  // Server at 1,000,000; phone thinks it's 910,000. One-way delay 40 ms each way.
  const sentLocal = 910_000;
  const serverAt = 1_000_040; // server stamps when the ping arrives (+40 ms)
  const receivedLocal = sentLocal + 80;
  const s = clockSample(sentLocal, serverAt, receivedLocal)!;
  assert.equal(s.rtt, 80);
  assert.ok(Math.abs(s.offset - skew) <= s.rtt / 2, `offset ${s.offset}`);
});

test("the lowest round trip wins (it's the most accurate), and junk is refused", () => {
  let w: ClockSample[] = [];
  w = addSample(w, { offset: 500, rtt: 400, at: 1 });
  w = addSample(w, { offset: 120, rtt: 30, at: 2 });
  w = addSample(w, { offset: 300, rtt: 200, at: 3 });
  assert.equal(bestOffset(w), 120);
  assert.equal(bestOffset([]), 0);
  assert.equal(clockSample(10, 5, 5), null, "negative round trip");
  assert.equal(clockSample(0, Number.NaN, 5), null);
});

test("the window is bounded and old samples expire (drift gets re-measured)", () => {
  let w: ClockSample[] = [];
  for (let i = 0; i < 40; i++) w = addSample(w, { offset: i, rtt: 100 - i, at: i * 1000 });
  assert.equal(w.length, CLOCK_SAMPLES);
  w = addSample(w, { offset: 7, rtt: 999, at: 40_000 + CLOCK_SAMPLE_TTL_MS });
  assert.deepEqual(w.map((s) => s.offset), [7], "only the fresh sample is left");
});


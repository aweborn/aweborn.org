import { test } from "node:test";
import assert from "node:assert/strict";
import { clampTzOffset, localHour, solarFactor, starSize, sunHeight, isNature, DEFAULT_NATURE, SOLAR_MAX, SOLAR_MIN } from "./sky.ts";

const NOON_UTC = Date.UTC(2026, 9, 27, 12, 0, 0);

test("local hour follows the UTC offset and wraps", () => {
  assert.equal(localHour(0, NOON_UTC), 12);
  assert.equal(localHour(-240, NOON_UTC), 8); // New York (EDT)
  assert.equal(localHour(540, NOON_UTC), 21); // Tokyo
  assert.equal(localHour(-720, Date.UTC(2026, 9, 27, 6)), 18);
});

test("solar factor: 1.1 at local noon, 0.9 at midnight, 1 at dawn/dusk, always clamped", () => {
  assert.ok(Math.abs(solarFactor(0, NOON_UTC) - 1.1) < 1e-9);
  assert.ok(Math.abs(solarFactor(720, NOON_UTC) - 0.9) < 1e-9); // +12:00 → midnight
  assert.ok(Math.abs(solarFactor(-360, NOON_UTC) - 1) < 1e-9); // 06:00
  for (let m = -1000; m <= 1000; m += 37) {
    const f = solarFactor(m, NOON_UTC + m * 1234);
    assert.ok(f >= SOLAR_MIN && f <= SOLAR_MAX);
  }
  assert.equal(clampTzOffset(5000), 840);
  assert.equal(clampTzOffset(Number.NaN), 0);
  assert.ok(Math.abs(sunHeight(12) - 1) < 1e-9);
});

test("star size grows with log(amount) and stays bounded", () => {
  assert.ok(starSize(1) < starSize(100));
  assert.ok(starSize(100) < starSize(10_000));
  assert.ok(starSize(1e12) <= 5);
  assert.ok(starSize(0) > 0);
});

test("every purpose has a default Form 990 nature", () => {
  for (const n of Object.values(DEFAULT_NATURE)) assert.ok(isNature(n));
  assert.equal(isNature("toString"), false);
});

/** Flight telemetry (9D): downsampled, batched, bounded by retention. */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { FlightTelemetry, SAMPLE_MS, RETENTION_MS } from "./telemetry.js";
import { initialFlightState } from "../../../shared/sim/flight.js";

test("keeps one sample per 2 s when moving, none when parked; prunes old rows", () => {
  let now = 1_000_000_000_000;
  const tel = new FlightTelemetry(new Database(":memory:"), () => now);
  const s = initialFlightState();
  for (let i = 0; i < 200; i++) { // 10 s of bundles at 20 Hz, moving 1 u per bundle
    s.px += 1;
    tel.note("p1", s, false, now);
    now += 50;
  }
  for (let i = 0; i < 200; i++) { tel.note("p1", s, false, now); now += 50; } // parked: nothing new
  tel.note("p1", s, true, now); // mode switch counts
  const path = tel.path("p1", 0, now);
  // 5 while moving, 1 catching the last stretch once parked, 1 for the mode switch
  assert.equal(path.length, 10_000 / SAMPLE_MS + 2);
  assert.equal(path.at(-1)!.mode, "neutral");
  now += RETENTION_MS + 1;
  tel.flush();
  assert.equal(tel.path("p1", 0, now).length, 0);
});

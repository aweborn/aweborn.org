import { test } from "node:test";
import assert from "node:assert/strict";
import { initialFlightState } from "./flight.js";
import {
  encodeInputBundle, decodeInputBundle, encodeCorrection, decodeCorrection, encodeReset, decodeReset,
} from "./wire.js";

const state = { ...initialFlightState(1.5, -2, 60), vx: 3, dampen: 0.25 };

test("input bundle round-trips (frames, leash, state)", () => {
  const frames = [{ bits: 0x2001, yaw: -127, pitch: 5 }, { bits: 0, yaw: 0, pitch: 127 }];
  const b = decodeInputBundle(encodeInputBundle({ firstSeq: 4_000_000_000, epoch: 7, leashRadius: 250, state, frames }));
  assert.ok(b);
  assert.equal(b.firstSeq, 4_000_000_000);
  assert.equal(b.epoch, 7);
  assert.equal(b.leashRadius, 250);
  assert.deepEqual(b.frames, frames);
  assert.deepEqual(b.state, { ...state, slingId: null });
  const none = decodeInputBundle(encodeInputBundle({ firstSeq: 0, epoch: 0, leashRadius: null, state, frames }));
  assert.equal(none?.leashRadius, null);
});

test("malformed payloads decode to null", () => {
  const ok = encodeInputBundle({ firstSeq: 0, epoch: 0, leashRadius: null, state, frames: [{ bits: 0, yaw: 0, pitch: 0 }] });
  assert.equal(decodeInputBundle(ok.slice(0, ok.length - 1)), null);
  const nan = encodeReset({ nextSeq: 1, state: { ...state, px: NaN } });
  assert.equal(decodeReset(nan), null);
  assert.equal(decodeCorrection(new Uint8Array(3)), null);
});

test("correction and reset round-trip", () => {
  assert.deepEqual(decodeCorrection(encodeCorrection({ ackSeq: 9, epoch: 2, state })), { ackSeq: 9, epoch: 2, state: { ...state, slingId: null } });
  assert.deepEqual(decodeReset(encodeReset({ nextSeq: 12, state })), { nextSeq: 12, state: { ...state, slingId: null } });
});

/** One screen steers (M9): newest or actually-flown screen drives, the rest follow. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Steering } from "./steering.js";

test("a lone screen drives silently; a second screen takes over", () => {
  const s = new Steering<object>();
  const phone = {}, laptop = {};
  assert.deepEqual(s.join(phone, "p"), []);
  assert.equal(s.isFollower(phone, "p"), false);
  assert.deepEqual(s.join(laptop, "p"), [[laptop, true], [phone, false]]);
  assert.equal(s.isFollower(phone, "p"), true);
  assert.equal(s.isFollower(laptop, "p"), false);
});

test("flying a follower takes the controls back; flying the driver is a no-op", () => {
  const s = new Steering<object>();
  const phone = {}, laptop = {};
  s.join(phone, "p");
  s.join(laptop, "p");
  assert.deepEqual(s.active(laptop, "p"), []);
  assert.deepEqual(s.active(phone, "p"), [[phone, true], [laptop, false]]);
  assert.equal(s.stats().takeovers, 1);
});

test("the driver leaving hands over to the newest remaining screen", () => {
  const s = new Steering<object>();
  const a = {}, b = {}, c = {};
  s.join(a, "p");
  s.join(b, "p");
  s.join(c, "p");
  assert.deepEqual(s.leave(a, "p"), []); // a follower leaving changes nothing
  assert.deepEqual(s.leave(c, "p"), [[b, true]]);
  assert.deepEqual(s.leave(b, "p"), []);
  assert.deepEqual(s.stats(), { players: 0, multiScreen: 0, takeovers: 0 });
});

test("different players never affect each other; guests are never followers", () => {
  const s = new Steering<object>();
  const a = {}, b = {};
  s.join(a, "p1");
  assert.deepEqual(s.join(b, "p2"), []);
  assert.equal(s.isFollower(a, "p1"), false);
  assert.equal(s.isFollower(b, null), false);
  assert.deepEqual(s.active(a, "p2"), []); // not one of p2's screens
});

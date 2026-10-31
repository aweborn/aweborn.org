/** Auto-pairing (Network-less A2): same world + same public IP → introduced to the group's hub. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshIntro, MESH_GROUP_MAX } from "./mesh-intro.js";

test("same world and IP: the newcomer is told to offer to the hub; repeats are free", () => {
  const m = new MeshIntro<object>();
  const a = {}, b = {};
  assert.deepEqual(m.place(a, "1.2.3.4", "w1"), []);
  assert.deepEqual(m.place(b, "1.2.3.4", "w1"), [[b, m.token(a)]]);
  assert.deepEqual(m.place(b, "1.2.3.4", "w1"), []); // 10 Hz presence: nothing new
  assert.equal(m.stats().groups, 1);
});

test("different IP, different world, or space: no intro", () => {
  const m = new MeshIntro<object>();
  const a = {}, b = {}, c = {}, d = {};
  m.place(a, "1.2.3.4", "w1");
  assert.deepEqual(m.place(b, "5.6.7.8", "w1"), []);
  assert.deepEqual(m.place(c, "1.2.3.4", "w2"), []);
  assert.deepEqual(m.place(d, "1.2.3.4", null), []);
});

test("signaling is relayed only inside the group, within a budget", () => {
  let t = 0;
  const m = new MeshIntro<object>(() => t);
  const a = {}, b = {}, x = {};
  m.place(a, "ip", "w");
  m.place(b, "ip", "w");
  m.place(x, "other", "w");
  assert.equal(m.relayTarget(b, m.token(a)), a);
  assert.equal(m.relayTarget(x, m.token(a)), null);
  assert.equal(m.relayTarget(b, "nope"), null);
  assert.equal(m.relayTarget(b, m.token(b)), null);
  for (let i = 0; i < 40; i++) m.relayTarget(b, m.token(a));
  assert.equal(m.relayTarget(b, m.token(a)), null); // over budget
  t += 11_000;
  assert.equal(m.relayTarget(b, m.token(a)), a);
});

test("the hub leaving introduces everyone left to the next hub", () => {
  const m = new MeshIntro<object>();
  const a = {}, b = {}, c = {};
  m.place(a, "ip", "w");
  m.place(b, "ip", "w");
  m.place(c, "ip", "w");
  assert.deepEqual(m.leave(a), [[c, m.token(b)]]);
  assert.deepEqual(m.leave(c), []); // not the hub
  assert.deepEqual(m.leave(b), []);
  assert.deepEqual(m.stats().screens, 0);
});

test("a full group stops introducing", () => {
  const m = new MeshIntro<object>();
  const all = Array.from({ length: MESH_GROUP_MAX + 2 }, () => ({}));
  const intros = all.map((k) => m.place(k, "ip", "w").length);
  assert.deepEqual(intros, [0, ...Array(MESH_GROUP_MAX - 1).fill(1), 0, 0]);
});


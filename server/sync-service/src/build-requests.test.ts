/**
 * Asking to build (2026-11-07). Uses node:sqlite so it runs without native modules.
 * Run: node --import tsx --test src/build-requests.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { BuildRequests, type SqlDb } from "./build-requests.js";
import { BUILD_REQUEST_LIMITS as L } from "../../../shared/build-requests.js";

const W = "11111111-2222-4333-8444-555555555555";
const W2 = "22222222-2222-4333-8444-555555555555";
const T0 = 1_800_000_000_000;
const fresh = () => new BuildRequests(new DatabaseSync(":memory:") as unknown as SqlDb);

test("an ask waits in the creator's and every builder's inbox, even while they're away", () => {
  const br = fresh();
  assert.deepEqual(br.ask(W, "dee", "acct-dee", ["cara", "ben"], T0), { ok: true, status: "open", askedAt: T0 });
  assert.deepEqual(br.inbox(["cara"], T0 + 1), [{ worldId: W, requester: "dee", askedAt: T0 }]);
  assert.deepEqual(br.inbox(["ben"], T0 + 1), [{ worldId: W, requester: "dee", askedAt: T0 }]);
  // One person's characters see it once
  assert.equal(br.inbox(["cara", "ben"], T0 + 1).length, 1);
  assert.deepEqual(br.inbox(["zed"], T0 + 1), []);
  assert.deepEqual(br.status(W, "acct-dee", T0 + 1), { status: "open", askedAt: T0 });
});

test("asking again while open changes nothing but who asked", () => {
  const br = fresh();
  br.ask(W, "dee", "acct-dee", ["cara"], T0);
  assert.deepEqual(br.ask(W, "dee-alt", "acct-dee", ["cara"], T0 + 5000), { ok: true, status: "open", askedAt: T0 });
  assert.deepEqual(br.inbox(["cara"], T0 + 6000), [{ worldId: W, requester: "dee-alt", askedAt: T0 }]);
  assert.equal(br.openAsk(W, "dee-alt", T0 + 6000)?.accountId, "acct-dee");
});

test("a new builder sees asks already waiting; a removed one stops seeing them", () => {
  const br = fresh();
  br.ask(W, "dee", "acct-dee", ["cara"], T0);
  br.syncOwners(W, ["cara", "ben"], T0 + 1);
  assert.equal(br.inbox(["ben"], T0 + 2).length, 1);
  br.syncOwners(W, ["cara"], T0 + 3);
  assert.equal(br.inbox(["ben"], T0 + 4).length, 0);
  assert.equal(br.inbox(["cara"], T0 + 4).length, 1);
});

test("declining clears every inbox and holds a cooldown before asking again", () => {
  const br = fresh();
  br.ask(W, "dee", "acct-dee", ["cara", "ben"], T0);
  br.decline(W, "acct-dee", "ben", T0 + 10);
  assert.deepEqual(br.inbox(["cara"], T0 + 11), []);
  const retryAt = T0 + 10 + L.declineCooldownMs;
  assert.deepEqual(br.status(W, "acct-dee", T0 + 11), { status: "declined", askedAt: T0, retryAt });
  const again = br.ask(W, "dee", "acct-dee", ["cara"], T0 + 12);
  assert.equal(again.ok === false && again.error, "declined_recently");
  assert.equal(br.ask(W, "dee", "acct-dee", ["cara"], retryAt).ok, true);
});

test("approving (resolve) removes the ask everywhere", () => {
  const br = fresh();
  br.ask(W, "dee", "acct-dee", ["cara", "ben"], T0);
  br.resolve(W, "acct-dee");
  assert.deepEqual(br.inbox(["cara", "ben"], T0 + 1), []);
  assert.deepEqual(br.status(W, "acct-dee", T0 + 1), { status: "none" });
  assert.equal(br.openAsk(W, "dee", T0 + 1), null);
});

test("withdrawing clears inboxes, and re-asking right away is held off", () => {
  const br = fresh();
  br.ask(W, "dee", "acct-dee", ["cara"], T0);
  assert.equal(br.withdraw(W, "acct-dee", T0 + 1), true);
  assert.deepEqual(br.inbox(["cara"], T0 + 2), []);
  const quick = br.ask(W, "dee", "acct-dee", ["cara"], T0 + 2);
  assert.equal(quick.ok === false && quick.error, "slow_down");
  assert.equal(br.ask(W, "dee", "acct-dee", ["cara"], T0 + 1 + L.withdrawCooldownMs).ok, true);
  assert.equal(br.withdraw(W2, "acct-dee", T0), false);
});

test("limits: asks per account per day, open asks per world", () => {
  const br = fresh();
  for (let i = 0; i < L.asksPerDay; i++) {
    const w = `${String(i).padStart(8, "0")}-2222-4333-8444-555555555555`;
    assert.equal(br.ask(w, "dee", "acct-dee", ["cara"], T0 + i).ok, true);
  }
  const over = br.ask(W, "dee", "acct-dee", ["cara"], T0 + 100);
  assert.equal(over.ok === false && over.error, "slow_down");
  assert.equal(br.ask(W, "dee", "acct-dee", ["cara"], T0 + 24 * 3600_000 + 100).ok, true);

  const busy = fresh();
  for (let i = 0; i < L.openPerWorld; i++) assert.equal(busy.ask(W, `p${i}`, `acct-${i}`, ["cara"], T0).ok, true);
  const full = busy.ask(W, "late", "acct-late", ["cara"], T0);
  assert.equal(full.ok === false && full.error, "world_full");
  busy.decline(W, "acct-0", "cara", T0 + 1);
  assert.equal(busy.ask(W, "late", "acct-late", ["cara"], T0 + 2).ok, true);
});

test("unanswered asks fade, and the sweep forgets them", () => {
  const br = fresh();
  br.ask(W, "dee", "acct-dee", ["cara"], T0);
  const later = T0 + L.expireMs + 1;
  assert.deepEqual(br.inbox(["cara"], later), []);
  assert.deepEqual(br.status(W, "acct-dee", later), { status: "none" });
  assert.equal(br.sweep(later), 1);
  assert.equal(br.ask(W, "dee", "acct-dee", ["cara"], later).ok, true);
});

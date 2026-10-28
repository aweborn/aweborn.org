import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ManaLedger } from "./mana.js";
import { CardOrders, ORDERS_PER_HOUR, PENDING_TTL_MS } from "./cards.js";
import { cardCreativeBase, clampQuantity, isCardOrderId, CARD_MAX_QUANTITY } from "../../../shared/cards.js";

const WORLD = "11111111-2222-4333-8444-555555555555";

function setup(opts: { unsafe?: boolean } = {}) {
  const db = new Database(":memory:");
  const mana = new ManaLedger(db);
  let now = 1_800_000_000_000;
  const mails: { to: string; subject: string; text: string }[] = [];
  const cards = new CardOrders(db, {
    mana,
    world: (id) => (id === WORLD ? { id, name: "Moss Hill", resolvedAt: 1 } : null),
    nameOf: (p) => (p === "named" ? "Alex" : null),
    check: async () => (opts.unsafe ? { ok: false, message: "no" } : { ok: true }),
    email: async (to, subject, text) => { mails.push({ to, subject, text }); },
    now: () => now,
  });
  return { db, mana, cards, mails, tick: (ms: number) => { now += ms; } };
}

test("helpers: order ids, quantity, creative split", () => {
  assert.ok(isCardOrderId("o" + "a".repeat(24)));
  assert.ok(!isCardOrderId("o123") && !isCardOrderId("O" + "a".repeat(24)));
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(99), CARD_MAX_QUANTITY);
  assert.equal(clampQuantity("3"), 1);
  // $9 card, net ≈ $8.44 after Stripe: creative counts after est. $1 card + $4 order
  assert.equal(cardCreativeBase(8.44, 1), 3.44);
  assert.equal(cardCreativeBase(3, 1), 0);
});

test("checkout: needs a real world, clamps input, and checks the printed name", async () => {
  const { cards } = setup();
  assert.deepEqual(await cards.create("p", { worldId: "nope" }), { ok: false, status: 400, error: "bad_world" });
  assert.equal((await cards.create("p", { worldId: "22222222-2222-4333-8444-555555555555" }) as { status: number }).status, 404);
  const r = await cards.create("p", { worldId: WORLD, quantity: 50, arrival: "weird" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(isCardOrderId(r.order.id));
  assert.equal(r.order.quantity, CARD_MAX_QUANTITY);
  assert.equal(r.order.arrival, "enter");
  assert.equal(r.order.status, "pending");
  assert.equal(r.order.worldName, "Moss Hill");

  const blocked = await setup({ unsafe: true }).cards.create("p", { worldId: WORLD });
  assert.equal((blocked as { status: number }).status, 422);
});

test("checkout: per-player limits on open checkouts", async () => {
  const { cards } = setup();
  for (let i = 0; i < 3; i++) assert.ok((await cards.create("p", { worldId: WORLD })).ok);
  assert.equal((await cards.create("p", { worldId: WORLD }) as { status: number }).status, 429);
  assert.ok((await cards.create("other", { worldId: WORLD })).ok, "other players aren't affected");
  assert.ok(ORDERS_PER_HOUR >= 3);
});

test("paid: money into the pool as a card sale, idempotent, email + public view without private fields", async () => {
  const { cards, mana, mails } = setup();
  const r = await cards.create("named", { worldId: WORLD, quantity: 2, showName: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  const info = cards.checkoutInfo(r.order.id);
  assert.deepEqual(info && { q: info.quantity, unit: info.unitCents }, { q: 2, unit: 900 });

  const before = mana.state();
  const paid = await cards.markPaid({ orderId: r.order.id, ref: "pi_1", netDollars: 17.18, email: "buyer@example.com" });
  assert.ok(paid.ok && !paid.duplicate);
  const after = mana.state();
  assert.ok(after.pool > before.pool);
  assert.equal(after.lastCard?.worldId, WORLD);
  assert.equal(after.lastCard?.name, "Alex");
  assert.ok(after.lastDonationAt === before.lastDonationAt, "a card isn't a gift wave");

  const again = await cards.markPaid({ orderId: r.order.id, ref: "pi_1", netDollars: 17.18 });
  assert.ok(again.ok && again.duplicate);
  assert.equal(mana.state().pool, after.pool, "no double count");
  assert.equal((await cards.markPaid({ orderId: r.order.id, ref: "pi_2", netDollars: 1 }) as { status: number }).status, 409);

  assert.equal(cards.checkoutInfo(r.order.id), null, "paid orders can't be charged again");
  assert.equal(mails.length, 1);
  assert.match(mails[0].text, /order\.html\?o=o[0-9a-f]{24}/);
  const pub = cards.publicView(r.order.id)!;
  assert.equal(pub.status, "paid");
  const text = JSON.stringify(pub);
  assert.ok(!text.includes("buyer@") && !text.includes("named") && !text.includes("pi_1"));
});

test("no name shown unless the buyer opted in", async () => {
  const { cards, mana } = setup();
  const r = await cards.create("named", { worldId: WORLD });
  if (!r.ok) return assert.fail();
  await cards.markPaid({ orderId: r.order.id, ref: "pi_x", netDollars: 8.44 });
  assert.equal(mana.state().lastCard?.name, null);
});

test("fulfillment: approve → printing (cost drawn) → shipped (email); bad moves refused", async () => {
  const { cards, mana, mails } = setup();
  const r = await cards.create("p", { worldId: WORLD });
  if (!r.ok) return assert.fail();
  const id = r.order.id;
  assert.equal((cards.advance(id, { status: "approved" }) as { status: number }).status, 409, "not paid yet");
  await cards.markPaid({ orderId: id, ref: "pi_f", netDollars: 8.44, email: "b@example.com" });
  assert.equal((cards.advance(id, { status: "shipped" }) as { status: number }).status, 409, "must be approved and printed first");
  assert.ok(cards.advance(id, { status: "approved" }).ok);
  const pool = mana.state().pool;
  const printing = cards.advance(id, { status: "printing", costDollars: 1.65 });
  assert.ok(printing.ok);
  assert.ok(mana.state().pool < pool);
  assert.ok(mana.state().drawnByPurpose.cards > 0);
  const shipped = cards.advance(id, { status: "shipped", costDollars: 1.5, tracking: "9400 1234" });
  assert.ok(shipped.ok && shipped.order.costDollars === 3.15 && shipped.order.shippedAt);
  assert.equal(mails.length, 2);
  assert.match(mails[1].text, /9400 1234/);
  assert.equal((cards.advance(id, { status: "printing", costDollars: -1 }) as { status: number }).status, 409);
});

test("refund marks the order; unfinished checkouts are swept", async () => {
  const { cards, tick } = setup();
  const a = await cards.create("p", { worldId: WORLD });
  const b = await cards.create("p", { worldId: WORLD });
  if (!a.ok || !b.ok) return assert.fail();
  await cards.markPaid({ orderId: a.order.id, ref: "pi_r", netDollars: 8.44 });
  assert.ok(cards.markRefunded("pi_r"));
  assert.ok(!cards.markRefunded("pi_r"));
  assert.ok(!cards.markRefunded("pi_gift"), "gifts aren't orders");
  assert.equal(cards.publicView(a.order.id)!.status, "refunded");
  tick(PENDING_TTL_MS + 1);
  assert.equal(cards.sweep(), 1);
  assert.equal(cards.publicView(b.order.id)!.status, "cancelled");
  assert.equal(cards.checkoutInfo(b.order.id), null);
  // Paid after the sweep (slow webhook): still counts
  const late = await cards.markPaid({ orderId: b.order.id, ref: "pi_late", netDollars: 8.44 });
  assert.ok(late.ok && late.order.status === "paid");
});

test("admin list hides abandoned checkouts by default", async () => {
  const { cards } = setup();
  const a = await cards.create("p", { worldId: WORLD });
  await cards.create("p", { worldId: WORLD });
  if (!a.ok) return assert.fail();
  await cards.markPaid({ orderId: a.order.id, ref: "pi_l", netDollars: 8.44 });
  assert.deepEqual(cards.list().map((o) => o.id), [a.order.id]);
  assert.equal(cards.list("pending").length, 1);
});

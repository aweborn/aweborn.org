import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ManaLedger } from "./mana.js";
import { CardOrders, ORDERS_PER_HOUR, PENDING_TTL_MS } from "./cards.js";
import { cardCreativeBase, clampQuantity, isCardOrderId, jpegSize, cardPhotoFits, CARD_MAX_QUANTITY, CARD_PHOTO } from "../../../shared/cards.js";

const WORLD = "11111111-2222-4333-8444-555555555555";
const GHOST = "33333333-2222-4333-8444-555555555555";

/** A minimal JPEG header (SOI, APP0, SOF0, EOI): enough for the size check; the server never decodes pixels. */
function fakeJpeg(width: number, height: number, pad = 0): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return Buffer.concat([Buffer.from([0xff, 0xd8, ...app0, ...sof0]), Buffer.alloc(pad), Buffer.from([0xff, 0xd9])]);
}
const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString("base64")}`;

function setup(opts: { unsafe?: boolean } = {}) {
  const db = new Database(":memory:");
  const mana = new ManaLedger(db);
  let now = 1_800_000_000_000;
  const mails: { to: string; subject: string; text: string }[] = [];
  const cards = new CardOrders(db, {
    mana,
    world: (id) => (id === WORLD ? { id, name: "Moss Hill", resolvedAt: 1 }
      : id === GHOST ? { id, name: "Far Mist", resolvedAt: 1, solidified: false } : null),
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

test("checkout: an order of a Ghost world prints its Dreamt edition (Phase 08)", async () => {
  const { cards } = setup();
  const solid = await cards.create("p", { worldId: WORLD });
  const ghost = await cards.create("p", { worldId: GHOST });
  assert.ok(solid.ok && solid.order.edition === "solid");
  assert.ok(ghost.ok && ghost.order.edition === "dreamt");
  if (ghost.ok) assert.equal(cards.publicView(ghost.order.id)?.edition, "dreamt");
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
  // Every card lands inside (Alex, 2026-10-13): an old client asking to land beside still gets "enter".
  const land = await cards.create("p", { worldId: WORLD, arrival: "land" });
  assert.ok(land.ok && land.order.arrival === "enter");

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

test("photo art: JPEG size check, the art window's shape", () => {
  assert.deepEqual(jpegSize(fakeJpeg(1100, 900)), { width: 1100, height: 900 });
  assert.equal(jpegSize(Buffer.from("not a jpeg at all")), null);
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), null, "no frame header");
  assert.ok(cardPhotoFits(1100, 900) && cardPhotoFits(550, 450));
  assert.ok(!cardPhotoFits(1100, 1100), "square isn't 11:9");
  assert.ok(!cardPhotoFits(440, 360), "too small to print");
});

test("photo art: stored with the order, served by its id, refused when wrong", async () => {
  const { cards } = setup();
  const r = await cards.create("p", { worldId: WORLD, photo: dataUrl(fakeJpeg(1100, 900, 2000)) });
  if (!r.ok) return assert.fail(JSON.stringify(r));
  assert.equal(r.order.art, "photo");
  assert.deepEqual(cards.photo(r.order.id) && { w: cards.photo(r.order.id)!.width, h: cards.photo(r.order.id)!.height }, { w: 1100, h: 900 });
  assert.equal(cards.photo("nope"), null);

  const plain = await cards.create("p", { worldId: WORLD });
  if (!plain.ok) return assert.fail();
  assert.equal(plain.order.art, "card");
  assert.equal(cards.photo(plain.order.id), null);

  const other = setup().cards;
  for (const photo of [
    "data:image/png;base64,iVBORw0KGgo=",
    dataUrl(Buffer.from("hello")),
    dataUrl(fakeJpeg(1000, 1000)),
    dataUrl(fakeJpeg(1100, 900, CARD_PHOTO.maxBytes + 10)),
    "data:image/jpeg;base64,!!!",
  ]) {
    const bad = await other.create("q", { worldId: WORLD, photo });
    assert.equal((bad as { error: string }).error, "bad_photo", photo.slice(0, 40));
  }
  assert.equal(other.list("pending").length, 0, "a refused photo makes no order");
});

test("photo art: dropped when the order can't print anymore", async () => {
  const { cards, tick } = setup();
  const photo = dataUrl(fakeJpeg(1100, 900));
  const cancelled = await cards.create("p", { worldId: WORLD, photo });
  const refunded = await cards.create("p", { worldId: WORLD, photo });
  const swept = await cards.create("p", { worldId: WORLD, photo });
  if (!cancelled.ok || !refunded.ok || !swept.ok) return assert.fail();
  assert.ok(cards.advance(cancelled.order.id, { status: "cancelled" }).ok);
  assert.equal(cards.photo(cancelled.order.id), null);
  await cards.markPaid({ orderId: refunded.order.id, ref: "pi_photo", netDollars: 8.44 });
  assert.ok(cards.photo(refunded.order.id), "paid orders keep it for printing");
  cards.markRefunded("pi_photo");
  assert.equal(cards.photo(refunded.order.id), null);
  tick(PENDING_TTL_MS + 1);
  cards.sweep();
  assert.equal(cards.photo(swept.order.id), null);
  // Paid after the sweep: prints the World Index picture instead
  const late = await cards.markPaid({ orderId: swept.order.id, ref: "pi_late_photo", netDollars: 8.44 });
  assert.ok(late.ok && late.order.art === "card");
});

test("orders made before photo art migrate (art = card)", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE card_orders (
    id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_name TEXT NOT NULL, quantity INTEGER NOT NULL, arrival TEXT NOT NULL, status TEXT NOT NULL,
    player_id TEXT, show_name INTEGER NOT NULL DEFAULT 0, public_name TEXT, email TEXT, payment_ref TEXT UNIQUE, net_cents INTEGER,
    cost_cents INTEGER NOT NULL DEFAULT 0, tracking TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    paid_at INTEGER, shipped_at INTEGER);
    INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, status, created_at, updated_at)
    VALUES ('o${"a".repeat(24)}', '${WORLD}', 'Old', 1, 'enter', 'paid', 1, 1);`);
  const cards = new CardOrders(db, {
    mana: new ManaLedger(db), world: () => null, nameOf: () => null, check: async () => ({ ok: true }), email: async () => {},
  });
  assert.equal(cards.publicView("o" + "a".repeat(24))!.art, "card");
});

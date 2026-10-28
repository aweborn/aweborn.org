/**
 * Card orders (Rough Draft M6; Phase 08 8D): "Get this card" for any world.
 *
 *   player  POST /api/player/cards/checkout { worldId, quantity, arrival, showName, photo? } → { orderId }
 *           (photo: a photo-mode shot as a data:image/jpeg URL, M6b)
 *           then the browser asks the payment Lambda for a Stripe Checkout URL
 *           (POST $VITE_API_ENDPOINT/create-card-checkout { orderId }).
 *   Lambda  GET  /api/cards/checkout-info/:id   (Bearer inflow/admin) → what to charge for (pending orders only)
 *   webhook POST /api/cards/paid { orderId, ref, netDollars, email?, at? }  (Bearer inflow/admin)
 *   public  GET  /cards/orders/:id                → status page data (no email, player or payment ids)
 *           GET  /cards/orders/:id/photo          → the order's photo art (image/jpeg), if it has one
 *   admin   GET  /api/admin/cards?status=         → orders, newest first
 *           POST /api/admin/cards/:id { status, costDollars?, tracking?, note? }
 *           POST /api/admin/cards/event { worldIds | setId, quantity, note, netDollars?, email? }
 *           (M6e: bulk / event orders, see createEvent)
 *
 * Money: a paid order is a `card` inflow (full net into the pool; the
 * creative share only gets what's left after estimated production +
 * shipping, `shared/cards.ts`). Printing and shipping are drawn as `cards`
 * when an admin records their real cost. A Stripe refund (the existing
 * /api/mana/refund path) marks the order refunded.
 *
 * Printed cards are permanent, so a person approves every order before it
 * prints (`paid → approved`), after the automatic safety check of the world
 * name at checkout. A photo is seen by that person too (no automatic image
 * check yet). The Stripe Lambda holds the shipping address; we keep
 * only the buyer's email, to tell them about their order (Privacy).
 */
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { ManaLedger } from "./mana.js";
import {
  CARD_NEXT, CARD_ORDER_STATUSES, CARD_PHOTO, CARD_PRICE_CENTS, cardCreativeBase, cardOrderUrl, cardPhotoFits, clampQuantity,
  isCardOrderId, jpegSize,
  type CardArrival, type CardArt, type CardEdition, type CardOrderPublic, type CardOrderStatus,
} from "../../../shared/cards.js";
import { ORIGIN_WORLD_ID, isWorldId } from "../../../shared/crdt-schema.js";

/** Pending checkouts older than this are cancelled (Stripe sessions expire after 24 h). */
export const PENDING_TTL_MS = 25 * 60 * 60 * 1000;
/** Per player: orders started per hour, and open (unpaid) checkouts at once. */
export const ORDERS_PER_HOUR = 6;
export const OPEN_PENDING_MAX = 3;
/** Event orders (M6e): worlds per event, cards per world, invoiced money per event. */
export const EVENT_LIMITS = { maxWorlds: 100, maxPerWorld: 10_000, maxNetDollars: 100_000 } as const;

interface OrderRow {
  id: string; world_id: string; world_name: string; quantity: number; arrival: string; art: string; edition: string; status: string;
  player_id: string | null; show_name: number; public_name: string | null; email: string | null;
  payment_ref: string | null; net_cents: number | null; cost_cents: number; tracking: string | null; note: string | null;
  event_id: string | null;
  created_at: number; updated_at: number; paid_at: number | null; shipped_at: number | null;
}

export interface CardOrderAdmin extends CardOrderPublic {
  playerId: string | null; publicName: string | null; email: string | null; paymentRef: string | null;
  netDollars: number | null; costDollars: number; tracking: string | null; note: string | null; updatedAt: number;
  /** Set on event (bulk) orders, shared by every world of that event. */
  eventId: string | null;
}

export interface CardDeps {
  mana: ManaLedger;
  /** The world as it is now (null = gone). */
  world: (id: string) => { id: string; name: string; resolvedAt: number; solidified?: boolean } | null;
  /** The buyer's character name, if they have one (for the opt-in swell line). */
  nameOf: (playerId: string) => string | null;
  /** Safety check of what will be printed. */
  check: (playerId: string, texts: string[], ref: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Order notices (never throws). */
  email: (to: string, subject: string, text: string) => Promise<void>;
  now?: () => number;
}

type Fail = { ok: false; status: number; error: string; message?: string };

const newOrderId = (): string => `o${randomBytes(12).toString("hex")}`;
const cleanEmail = (v: unknown): string | null =>
  typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;

const PHOTO_PREFIX = "data:image/jpeg;base64,";
/** Upload body limit for a checkout with a photo (base64 is 4/3 of the bytes, plus the JSON around it). */
export const CHECKOUT_BODY_LIMIT = Math.ceil(CARD_PHOTO.maxBytes * 4 / 3) + 4096;

/** A photo-mode shot from the checkout body, checked: a JPEG, the art window's shape, not too big. */
function readPhoto(v: unknown): { ok: true; jpeg: Buffer; width: number; height: number } | { ok: false; message: string } {
  if (typeof v !== "string" || !v.startsWith(PHOTO_PREFIX)) return { ok: false, message: "The photo has to be a JPEG from photo mode." };
  const b64 = v.slice(PHOTO_PREFIX.length);
  if (b64.length > Math.ceil(CARD_PHOTO.maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { ok: false, message: "That photo is too big. Take it again." };
  }
  const jpeg = Buffer.from(b64, "base64");
  const size = jpegSize(jpeg);
  if (!size) return { ok: false, message: "The photo has to be a JPEG from photo mode." };
  if (!cardPhotoFits(size.width, size.height)) return { ok: false, message: "That photo doesn't fit the card. Take it again in photo mode." };
  return { ok: true, jpeg, ...size };
}

function toPublic(r: OrderRow): CardOrderPublic {
  return {
    id: r.id, worldId: r.world_id, worldName: r.world_name, quantity: r.quantity, arrival: r.arrival as CardArrival,
    art: (r.art ?? "card") as CardArt, edition: (r.edition === "dreamt" ? "dreamt" : "solid") as CardEdition,
    status: r.status as CardOrderStatus, createdAt: r.created_at, paidAt: r.paid_at, shippedAt: r.shipped_at,
  };
}

function toAdmin(r: OrderRow): CardOrderAdmin {
  return {
    ...toPublic(r), playerId: r.player_id, publicName: r.public_name, email: r.email, paymentRef: r.payment_ref,
    netDollars: r.net_cents === null ? null : r.net_cents / 100, costDollars: r.cost_cents / 100,
    tracking: r.tracking, note: r.note, updatedAt: r.updated_at, eventId: r.event_id ?? null,
  };
}

export class CardOrders {
  private readonly now: () => number;

  constructor(private readonly db: Database.Database, private readonly deps: CardDeps) {
    this.now = deps.now ?? Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS card_orders (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_name TEXT NOT NULL,
      quantity INTEGER NOT NULL, arrival TEXT NOT NULL, status TEXT NOT NULL,
      player_id TEXT, show_name INTEGER NOT NULL DEFAULT 0, public_name TEXT, email TEXT,
      payment_ref TEXT UNIQUE, net_cents INTEGER, cost_cents INTEGER NOT NULL DEFAULT 0,
      tracking TEXT, note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, paid_at INTEGER, shipped_at INTEGER);
      CREATE INDEX IF NOT EXISTS card_orders_status ON card_orders(status, created_at);
      CREATE INDEX IF NOT EXISTS card_orders_player ON card_orders(player_id, created_at);
      CREATE TABLE IF NOT EXISTS card_order_photos (
        order_id TEXT PRIMARY KEY, jpeg BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL);`);
    // M6b: art choice (older rows are the World Index picture)
    const cols = db.prepare("PRAGMA table_info(card_orders)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "art")) db.exec("ALTER TABLE card_orders ADD COLUMN art TEXT NOT NULL DEFAULT 'card'");
    // M6d: the world's look when ordered (older rows: solid; build-batch --ghost still overrides)
    if (!cols.some((c) => c.name === "edition")) db.exec("ALTER TABLE card_orders ADD COLUMN edition TEXT NOT NULL DEFAULT 'solid'");
    // M6e: event (bulk) orders share an event id
    if (!cols.some((c) => c.name === "event_id")) db.exec("ALTER TABLE card_orders ADD COLUMN event_id TEXT");
  }

  private dropPhoto(id: string): void {
    this.db.prepare("DELETE FROM card_order_photos WHERE order_id = ?").run(id);
  }

  /** The photo art of an order, while it can still print (null if none). */
  photo(id: string): { jpeg: Buffer; width: number; height: number } | null {
    if (!isCardOrderId(id)) return null;
    return (this.db.prepare("SELECT jpeg, width, height FROM card_order_photos WHERE order_id = ?").get(id) as
      { jpeg: Buffer; width: number; height: number } | undefined) ?? null;
  }

  private row(id: string): OrderRow | undefined {
    return this.db.prepare("SELECT * FROM card_orders WHERE id = ?").get(id) as OrderRow | undefined;
  }

  private set(id: string, fields: Partial<OrderRow>): void {
    const keys = Object.keys(fields);
    this.db.prepare(`UPDATE card_orders SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => (fields as Record<string, unknown>)[k] as string | number | null), this.now(), id);
  }

  /** Cancel checkouts nobody finished (cheap: indexed, bounded by time), and drop their photos. */
  sweep(): number {
    const cutoff = this.now() - PENDING_TTL_MS;
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM card_order_photos WHERE order_id IN (SELECT id FROM card_orders WHERE status = 'pending' AND created_at < ?)").run(cutoff);
      return this.db.prepare("UPDATE card_orders SET status = 'cancelled', updated_at = ? WHERE status = 'pending' AND created_at < ?")
        .run(this.now(), cutoff).changes;
    })();
  }

  /** Start an order for a world (any world that exists, Card Invariant #3). */
  async create(playerId: string, body: unknown): Promise<{ ok: true; order: CardOrderPublic } | Fail> {
    const b = (body ?? {}) as { worldId?: unknown; quantity?: unknown; arrival?: unknown; showName?: unknown; photo?: unknown };
    const worldId = typeof b.worldId === "string" ? b.worldId.toLowerCase() : "";
    if (!isWorldId(worldId)) return { ok: false, status: 400, error: "bad_world" };
    const w = this.deps.world(worldId);
    if (!w || !(w.resolvedAt > 0)) return { ok: false, status: 404, error: "no_world", message: "That world isn't in the universe anymore." };
    // Every card lands inside (Alex, 2026-10-13: "like a game pack, tap and you're in"); the printed
    // URL is just /w/<id>, so there is nothing to choose. The column stays for older rows.
    const arrival: CardArrival = "enter";
    const quantity = clampQuantity(b.quantity);
    const photo = b.photo === undefined || b.photo === null ? null : readPhoto(b.photo);
    if (photo && !photo.ok) return { ok: false, status: 400, error: "bad_photo", message: photo.message };

    this.sweep();
    const now = this.now();
    const recent = this.db.prepare("SELECT COUNT(*) AS n, SUM(status = 'pending') AS open FROM card_orders WHERE player_id = ? AND created_at > ?")
      .get(playerId, now - 60 * 60 * 1000) as { n: number; open: number | null };
    if (recent.n >= ORDERS_PER_HOUR || (recent.open ?? 0) >= OPEN_PENDING_MAX) {
      return { ok: false, status: 429, error: "slow_down", message: "You have a few checkouts open already. Finish one, or try again in a bit." };
    }
    // Printed forever: the name goes through the same check as everything players make
    const safe = await this.deps.check(playerId, [w.name], `card:${worldId}`);
    if (!safe.ok) return { ok: false, status: 422, error: "unsafe", message: "This world's name can't be printed. Rename the world first." };

    const showName = b.showName === true;
    const id = newOrderId();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, art, edition, status, player_id, show_name, public_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
        .run(id, worldId, w.name.slice(0, 60), quantity, arrival, photo?.ok ? "photo" : "card", w.solidified === false ? "dreamt" : "solid",
          playerId, showName ? 1 : 0,
          showName ? this.deps.nameOf(playerId) : null, now, now);
      if (photo?.ok) {
        this.db.prepare("INSERT INTO card_order_photos (order_id, jpeg, width, height, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(id, photo.jpeg, photo.width, photo.height, now);
      }
    })();
    return { ok: true, order: toPublic(this.row(id)!) };
  }

  /**
   * An event (bulk) order, made by an admin (Phase 08 "Bulk order path for
   * events"): one order row per world, all sharing an event id, created
   * straight as `approved` (the admin choosing the worlds is the person
   * check), so `build-batch.mjs --orders` prints them with everything else.
   * Origin is allowed here (events are where Origin cards go). No Stripe:
   * if the organiser paid (invoice, cash), `netDollars` is that money, booked
   * once as a `card` inflow with the usual creative base. No player row, no
   * per-player limit: admin only.
   */
  createEvent(body: unknown): { ok: true; eventId: string; orders: CardOrderAdmin[] } | Fail {
    const b = (body ?? {}) as { worldIds?: unknown; quantity?: unknown; note?: unknown; netDollars?: unknown; email?: unknown };
    const raw = Array.isArray(b.worldIds) ? b.worldIds : [];
    const ids = [...new Set(raw.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : "")))];
    if (ids.length === 0) return { ok: false, status: 400, error: "no_worlds", message: "Add at least one world." };
    if (ids.length > EVENT_LIMITS.maxWorlds) return { ok: false, status: 400, error: "too_many_worlds", message: `At most ${EVENT_LIMITS.maxWorlds} worlds per event.` };
    const quantity = typeof b.quantity === "number" && Number.isInteger(b.quantity) ? b.quantity : NaN;
    if (!(quantity >= 1 && quantity <= EVENT_LIMITS.maxPerWorld)) {
      return { ok: false, status: 400, error: "bad_quantity", message: `Cards per world: 1 to ${EVENT_LIMITS.maxPerWorld.toLocaleString("en-US")}.` };
    }
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    if (!note) return { ok: false, status: 400, error: "no_note", message: "Name the event (who it's for), so the order makes sense later." };
    const net = b.netDollars === undefined || b.netDollars === null || b.netDollars === "" ? 0 : b.netDollars;
    if (typeof net !== "number" || !Number.isFinite(net) || net < 0 || net > EVENT_LIMITS.maxNetDollars) {
      return { ok: false, status: 400, error: "bad_amount", message: `Money received: 0 to $${EVENT_LIMITS.maxNetDollars.toLocaleString("en-US")}.` };
    }
    const email = b.email === undefined || b.email === null || b.email === "" ? null : cleanEmail(b.email);
    if (b.email && !email) return { ok: false, status: 400, error: "bad_email", message: "That email doesn't look right." };

    const worlds: { id: string; name: string; dreamt: boolean }[] = [];
    const bad: string[] = [];
    for (const id of ids) {
      const w = isWorldId(id) ? this.deps.world(id) : null;
      if (!w || (id !== ORIGIN_WORLD_ID && !(w.resolvedAt > 0))) bad.push(id);
      else worlds.push({ id, name: w.name.slice(0, 60), dreamt: w.solidified === false });
    }
    if (bad.length) return { ok: false, status: 404, error: "no_world", message: `Not in the universe: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}` };

    const eventId = `e${randomBytes(8).toString("hex")}`;
    const now = this.now();
    const total = quantity * worlds.length;
    const orderIds: string[] = [];
    this.db.transaction(() => {
      if (net > 0) {
        this.deps.mana.recordInflow({
          source: "card", netDollars: net, creativeBaseDollars: cardCreativeBase(net, total),
          ref: `event:${eventId}`, note: `card:${worlds[0].id} x${total} event: ${note.slice(0, 80)}`, at: now,
        });
      }
      const insert = this.db.prepare(`INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, art, edition, status, player_id, show_name,
          email, net_cents, note, event_id, created_at, updated_at, paid_at)
        VALUES (?, ?, ?, ?, 'enter', 'card', ?, 'approved', NULL, 0, ?, ?, ?, ?, ?, ?, ?)`);
      for (const w of worlds) {
        const id = newOrderId();
        orderIds.push(id);
        // The money is split evenly across the event's worlds (for the admin view; the pool got it once).
        insert.run(id, w.id, w.name, quantity, w.dreamt ? "dreamt" : "solid", email,
          net > 0 ? Math.round((net * 100) / worlds.length) : null, note, eventId, now, now, net > 0 ? now : null);
      }
    })();
    return { ok: true, eventId, orders: orderIds.map((id) => toAdmin(this.row(id)!)) };
  }

  /** What the payment Lambda charges for. Only unpaid, live orders. */
  checkoutInfo(id: string): { id: string; quantity: number; worldId: string; worldName: string; arrival: CardArrival; unitCents: number } | null {
    if (!isCardOrderId(id)) return null;
    const r = this.row(id);
    if (!r || r.status !== "pending" || this.now() - r.created_at > PENDING_TTL_MS) return null;
    return { id: r.id, quantity: r.quantity, worldId: r.world_id, worldName: r.world_name, arrival: r.arrival as CardArrival, unitCents: CARD_PRICE_CENTS };
  }

  /**
   * Payment landed (Stripe webhook). Idempotent on the payment ref. The
   * money enters the pool even if the order was swept meanwhile: it was paid.
   */
  async markPaid(input: { orderId: unknown; ref: unknown; netDollars: unknown; email?: unknown; at?: unknown }): Promise<{ ok: true; duplicate: boolean; order: CardOrderPublic } | Fail> {
    const { orderId, ref, netDollars } = input;
    if (!isCardOrderId(orderId) || typeof ref !== "string" || !ref || ref.length > 200) return { ok: false, status: 400, error: "bad_request" };
    if (typeof netDollars !== "number" || !Number.isFinite(netDollars) || netDollars < 0 || netDollars > 10_000) return { ok: false, status: 400, error: "bad_amount" };
    const r = this.row(orderId);
    if (!r) return { ok: false, status: 404, error: "unknown_order" };
    if (r.payment_ref) {
      if (r.payment_ref === ref) return { ok: true, duplicate: true, order: toPublic(r) };
      return { ok: false, status: 409, error: "already_paid" };
    }
    if (r.status !== "pending" && r.status !== "cancelled") return { ok: false, status: 409, error: `order_${r.status}` };
    const at = typeof input.at === "number" && Number.isFinite(input.at) ? input.at : this.now();
    const email = cleanEmail(input.email);
    this.db.transaction(() => {
      this.deps.mana.recordInflow({
        source: "card",
        netDollars,
        creativeBaseDollars: cardCreativeBase(netDollars, r.quantity),
        ref,
        note: `card:${r.world_id} x${r.quantity}`,
        publicName: r.public_name ?? undefined,
        at,
      });
      this.set(r.id, {
        status: "paid", payment_ref: ref, net_cents: Math.round(netDollars * 100), email, paid_at: at,
        // Paid after the sweep dropped its photo: print the World Index picture (the admin sees it)
        ...(r.art === "photo" && !this.photo(r.id) ? { art: "card" } : {}),
      });
    })();
    const order = toPublic(this.row(r.id)!);
    if (email) {
      void this.deps.email(email, `Your Aweborn card${r.quantity > 1 ? "s" : ""} of ${r.world_name}`,
        `Thank you! We've got your order for ${r.quantity} card${r.quantity > 1 ? "s" : ""} of ${r.world_name}.\n\n` +
        `Every card is checked by a person before it's printed, then it goes in the mail. Follow it here:\n${cardOrderUrl(r.id)}\n\n` +
        `What you paid already swelled the universe's pool, so everyone can make a little more.\n\nAweborn`);
    }
    return { ok: true, duplicate: false, order };
  }

  /** A Stripe refund or lost dispute named this payment (no-op for gifts). */
  markRefunded(paymentRef: string): boolean {
    const r = this.db.prepare("SELECT id, status FROM card_orders WHERE payment_ref = ?").get(paymentRef) as { id: string; status: string } | undefined;
    if (!r || r.status === "refunded") return false;
    this.set(r.id, { status: "refunded" });
    this.dropPhoto(r.id);
    return true;
  }

  publicView(id: string): CardOrderPublic | null {
    if (!isCardOrderId(id)) return null;
    const r = this.row(id);
    return r ? toPublic(r) : null;
  }

  list(status?: string, limit = 200): CardOrderAdmin[] {
    const rows = (CARD_ORDER_STATUSES.includes(status as CardOrderStatus)
      ? this.db.prepare("SELECT * FROM card_orders WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
      : this.db.prepare("SELECT * FROM card_orders WHERE status != 'pending' AND status != 'cancelled' OR paid_at IS NOT NULL ORDER BY created_at DESC LIMIT ?").all(limit)) as OrderRow[];
    return rows.map(toAdmin);
  }

  /**
   * Admin moves an order along. `printing` and `shipped` take the real cost
   * (dollars), drawn from the pool as `cards` (a gold star toward the real world).
   */
  advance(id: string, body: unknown): { ok: true; order: CardOrderAdmin } | Fail {
    const b = (body ?? {}) as { status?: unknown; costDollars?: unknown; tracking?: unknown; note?: unknown };
    const r = isCardOrderId(id) ? this.row(id) : undefined;
    if (!r) return { ok: false, status: 404, error: "not_found" };
    const next = b.status as CardOrderStatus;
    if (!CARD_NEXT[r.status as CardOrderStatus]?.includes(next)) return { ok: false, status: 409, error: "bad_transition", message: `${r.status} → ${String(next)}` };
    const cost = typeof b.costDollars === "number" && Number.isFinite(b.costDollars) && b.costDollars >= 0 && b.costDollars <= 5000 ? b.costDollars : 0;
    if ((next === "printing" || next === "shipped") && b.costDollars !== undefined && cost !== b.costDollars) return { ok: false, status: 400, error: "bad_cost" };
    const tracking = typeof b.tracking === "string" ? b.tracking.trim().slice(0, 120) || null : r.tracking;
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : r.note;
    const now = this.now();
    this.db.transaction(() => {
      if (cost > 0) {
        this.deps.mana.recordDraw({
          purpose: "cards", fn: "program", dollars: cost,
          ref: `card-${next}:${r.id}`,
          note: next === "printing" ? `printing ${r.quantity} card(s)` : `shipping ${r.quantity} card(s)`,
        });
      }
      this.set(r.id, {
        status: next, tracking, note,
        cost_cents: r.cost_cents + Math.round(cost * 100),
        ...(next === "shipped" ? { shipped_at: now } : {}),
      });
      if (next === "cancelled") this.dropPhoto(r.id); // never printing: don't keep the photo
    })();
    if (next === "shipped" && r.email) {
      void this.deps.email(r.email, `Your Aweborn card${r.quantity > 1 ? "s are" : " is"} in the mail`,
        `Your ${r.quantity > 1 ? `${r.quantity} cards` : "card"} of ${r.world_name} ${r.quantity > 1 ? "are" : "is"} on the way.` +
        (tracking ? `\nTracking: ${tracking}` : "") +
        `\n\nTap a card on your phone to step inside the world. Order: ${cardOrderUrl(r.id)}\n\nAweborn`);
    }
    return { ok: true, order: toAdmin(this.row(r.id)!) };
  }
}

/**
 * Card orders (Rough Draft M6; Phase 08 8D "Print-Your-World").
 *
 * Shared by the server (orders, money) and the client (Get this card).
 * A card is a link to one world, printed on an NFC card: $9 each.
 *
 * Money (Phase 05 formula v3): the full net of a card sale enters the pool;
 * only what's left after production + shipping counts toward the creative
 * share. Real costs are known at fulfillment (then drawn as `cards`), so the
 * creative split at payment uses an estimate.
 */

/** Price of one card, in cents (Alex, 2026-10-27: $9). The Stripe price must match. */
export const CARD_PRICE_CENTS = 900;
/** Most cards in one in-game order (events order in bulk through the admin). */
export const CARD_MAX_QUANTITY = 10;
/**
 * Estimated cost to make and send an order, for the creative split only:
 * DTB quote Oct 15 ≈ $0.96–1.65 a card at 50–100, plus a padded envelope +
 * postage. Real costs are drawn at fulfillment. (Defaults: tune with Alex.)
 */
export const CARD_COST_ESTIMATE = { perCardDollars: 1.0, perOrderDollars: 4.0 } as const;

/** Where a tap lands: beside the world (sighted) or inside it (visited). */
export type CardArrival = "land" | "enter";
export const CARD_ARRIVALS: readonly CardArrival[] = ["land", "enter"];

export type CardOrderStatus =
  | "pending"   // checkout started, not paid
  | "paid"      // money in; waiting for a person to check the card before printing
  | "approved"  // checked: name + art are fine to print forever
  | "printing"  // sent to the printer (cost drawn)
  | "shipped"   // in the mail
  | "cancelled" // never paid, or stopped before printing
  | "refunded"; // money went back

export const CARD_ORDER_STATUSES: readonly CardOrderStatus[] = ["pending", "paid", "approved", "printing", "shipped", "cancelled", "refunded"];

/** What an admin may move an order to from each status. */
export const CARD_NEXT: Record<CardOrderStatus, readonly CardOrderStatus[]> = {
  pending: ["cancelled"],
  paid: ["approved", "cancelled"],
  approved: ["printing", "cancelled"],
  printing: ["shipped"],
  shipped: [],
  cancelled: [],
  refunded: [],
};

/** An order id: "o" + 24 hex (96 random bits), the only key to its status page. */
export const isCardOrderId = (s: unknown): s is string => typeof s === "string" && /^o[0-9a-f]{24}$/.test(s);

export const clampQuantity = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(CARD_MAX_QUANTITY, Math.max(1, Math.trunc(n))) : 1;

/** Dollars from a sale that count toward the creative share (never below 0 or above the net). */
export function cardCreativeBase(netDollars: number, quantity: number): number {
  const cost = CARD_COST_ESTIMATE.perOrderDollars + CARD_COST_ESTIMATE.perCardDollars * quantity;
  return Math.max(0, Math.min(netDollars, Math.round((netDollars - cost) * 100) / 100));
}

/** The public status page of an order. */
export const cardOrderUrl = (id: string, site = "https://aweborn.org"): string => `${site}/order.html?o=${id}`;

/** What the status page shows (no email, no player, no payment ids). */
export interface CardOrderPublic {
  id: string;
  worldId: string;
  worldName: string;
  quantity: number;
  arrival: CardArrival;
  status: CardOrderStatus;
  createdAt: number;
  paidAt: number | null;
  shippedAt: number | null;
}

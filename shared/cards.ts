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

/**
 * The picture in the card's art window (55 × 45 mm, 11:9):
 *   card   the world's World Index picture (its orb in space), rendered at print time
 *   photo  a photo-mode shot the buyer framed in-game (M6b), uploaded with the order
 */
export type CardArt = "card" | "photo";
export const CARD_ARTS: readonly CardArt[] = ["card", "photo"];

/**
 * Photo art: a JPEG cropped to the art window. 1100 × 900 is ~508 dpi on the
 * 55 mm window; 550 px wide (~254 dpi) is the least we print. The upload is
 * base64 in JSON, so keep it under ~600 KB.
 */
export const CARD_PHOTO = { width: 1100, height: 900, minWidth: 550, maxBytes: 600_000 } as const;

/** True if a photo is the art window's shape (11:9) and sharp enough to print. */
export function cardPhotoFits(width: number, height: number): boolean {
  return width >= CARD_PHOTO.minWidth && width <= 4000 && height > 0 && Math.abs(width / height - 11 / 9) < 0.01;
}

/** Width × height of a baseline/progressive JPEG (from its SOF marker), or null if it isn't one. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // no length
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    // SOF0..SOF15, except DHT (C4), JPG (C8), DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (m === 0xda || m === 0xd9) return null; // scan/end before any frame header
    i += 2 + len;
  }
  return null;
}

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
  art: CardArt;
  status: CardOrderStatus;
  createdAt: number;
  paidAt: number | null;
  shippedAt: number | null;
}

/**
 * Asking to build (Alex, 2026-11-07): a saved player asks a world's creator to make
 * them a builder (co-creator). The ask waits in the inbox of the creator and every
 * builder, online or not, until one of them approves or declines it. Builders may
 * approve asks and add builders themselves; only the creator removes one.
 *
 * Shared so the client shows the same limits the server enforces (sync-service
 * `build-requests.ts`).
 */

export const BUILD_REQUEST_LIMITS = {
  /** Open asks one world holds at once (its owners decline to make room). */
  openPerWorld: 20,
  /** Asks one account may make per rolling day, across all worlds. */
  asksPerDay: 10,
  /** After a decline, the same account may ask that world again after this long. */
  declineCooldownMs: 7 * 24 * 3600_000,
  /** After withdrawing an ask, the same world can be asked again after this long (no ask/withdraw pinging). */
  withdrawCooldownMs: 3600_000,
  /** An ask nobody answers fades after this long. */
  expireMs: 30 * 24 * 3600_000,
  /** Most asks one inbox lists. */
  inboxMax: 100,
} as const;

/** One ask waiting for you (you're the creator or a builder of its world). */
export interface BuildRequestView {
  worldId: string;
  worldName: string;
  worldColor: string;
  /** The asking character (their playerId); approving makes it a builder. */
  requester: string;
  /** Their chosen name, if they picked one (otherwise show their wanderer tag). */
  requesterName?: string;
  askedAt: number;
}

/** Where your own ask for one world stands. */
export type MyBuildRequestStatus = "none" | "open" | "declined" | "builder";

export interface MyBuildRequest {
  status: MyBuildRequestStatus;
  askedAt?: number;
  /** When a declined ask may be made again. */
  retryAt?: number;
}

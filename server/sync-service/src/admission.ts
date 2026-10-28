/**
 * Aweborn — Mana Flow & Admission (Phase 05)
 *
 * Decides whether a player may manifest something right now, then holds the
 * estimate in the ledger. Everything here is per rolling 24 h:
 *
 *   G    = min(creative, max(creative / τ, p_solo))      the universe's flow
 *   p_i  = base(progress_i) × solar_i                    personal cap, solar ∈ [0.9, 1.1]
 *   R    = G − creation spend in the window              flow still left today
 *   h_j  = p_j − spend_j                                 each active player's headroom
 *   s_i  = max-min fair (water-filling) share of R among players active in the
 *          last 30 min, each capped at h_j
 *   admit if est ≤ s_i and est ≤ creative − reserved
 *
 * One player alone gets min(p_i − spend_i, R). With many players the global
 * flow binds first and is shared evenly; whatever a light user doesn't need is
 * redistributed to the others. Every paid call goes through here, planner chat
 * turns included (Alex, 2026-10-16).
 *
 * Admission is synchronous on a single Node thread, so there's no queue to
 * order yet; `priority()` is the hook for when requests start to wait.
 */

import { MANA_CAPS, MANA_PARAMS, baseCap, type PlayerProgress } from "../../../shared/crdt-schema.js";
import { clampTzOffset, solarFactor } from "../../../shared/sky.js";
import type { ManaLedger } from "./mana.js";

/** A player's reported timezone may change at most this often (travel is fine; hourly flipping for noon caps isn't). */
export const TZ_CHANGE_MS = 12 * 3600_000;

export const REPLENISH_MESSAGE = "The world must be replenished…";
/** Guests explore and build freely; making from thought draws on the shared pool (Alex, 2026-10-20). */
export const SIGN_IN_MESSAGE = "Making from thought draws on the shared mana pool. Sign in to channel it.";

export interface DrawRequest {
  playerId: string;
  /** Idempotency key for the hold (one per provider call / manifest item). */
  ref: string;
  /** Estimated cost in mana (real compute × K). */
  estimate: number;
  progress: PlayerProgress;
  /** Solar modifier for the player's local time; clamped to [0.9, 1.1]. */
  solar?: number;
}

export type DrawDecision =
  | { ok: true; ref: string; estimate: number; remainingToday: number }
  | {
      ok: false;
      reason: "sign_in_required" | "not_unlocked" | "personal_cap" | "universe_flow" | "insufficient_creative" | "duplicate" | "bad_amount";
      message: string;
      /** What this player could still draw right now (mana). */
      remainingToday: number;
    };

export class ManaAdmission {
  /** playerId → last activity (ms). */
  private lastSeen = new Map<string, number>();
  /** Players whose current session is anonymous (unsaved): no generative allowance until they sign in. */
  private guests = new Set<string>();

  constructor(
    private ledger: ManaLedger,
    private now: () => number = Date.now,
  ) {}

  /** Set from each authenticated request: an unsaved player can't draw until they sign in. */
  setGuest(playerId: string, isGuest: boolean): void {
    if (isGuest) this.guests.add(playerId);
    else this.guests.delete(playerId);
  }

  /** Whether this player's current session is unsaved (anonymous). */
  isGuest(playerId: string): boolean {
    return this.guests.has(playerId);
  }

  /** playerId → reported UTC offset (minutes east) and when it last changed. Memory only. */
  private tz = new Map<string, { offset: number; at: number }>();

  /**
   * The client reports its UTC offset (the `aw_tz` cookie). The first report
   * counts at once; a different offset is accepted at most every 12 h.
   */
  setTimezone(playerId: string, offsetMin: number, at = this.now()): void {
    const offset = clampTzOffset(offsetMin);
    const cur = this.tz.get(playerId);
    if (cur && (cur.offset === offset || at - cur.at < TZ_CHANGE_MS)) return;
    if (!cur && this.tz.size > 100_000) this.tz.clear(); // crude bound; the next request re-reports
    this.tz.set(playerId, { offset, at });
  }

  /** Solar modifier for this player now (1 when they haven't reported a timezone). */
  solarFor(playerId: string, at = this.now()): number {
    const t = this.tz.get(playerId);
    return t ? solarFactor(t.offset, at) : 1;
  }

  /** A player's personal cap per 24 h (before solar). Unsaved players get MANA_CAPS.guest (0). */
  capFor(playerId: string, progress: PlayerProgress, solar = 1): number {
    const base = this.guests.has(playerId) ? Math.min(MANA_CAPS.guest, baseCap(progress)) : baseCap(progress);
    return base * clamp(solar, 0.9, 1.1);
  }

  /** Called on connect and on every message: activity puts a player in the fair split. */
  markActive(playerId: string, at = this.now()): void {
    this.lastSeen.set(playerId, at);
  }

  /** Players active in the last 30 minutes (prunes the rest). */
  activePlayers(at = this.now()): string[] {
    const cutoff = at - MANA_CAPS.activeMs;
    const out: string[] = [];
    for (const [id, seen] of this.lastSeen) {
      if (seen < cutoff) this.lastSeen.delete(id);
      else out.push(id);
    }
    return out;
  }

  /** The universe's flow per rolling 24 h. */
  globalFlow(): number {
    const creative = this.ledger.state().creative;
    return Math.min(creative, Math.max(creative / MANA_PARAMS.tauDays, MANA_CAPS.pSolo));
  }

  /** Hook for ordering waiting requests. Formula deferred; everyone is equal. */
  priority(_req: DrawRequest): number {
    return 0;
  }

  /**
   * What `playerId` may draw right now. Other active players are assumed to
   * be at their explorer cap: we don't know their progress, and assuming the
   * common case keeps a newcomer from starving them.
   */
  shareFor(playerId: string, personalCap: number, at = this.now()): number {
    const { total, byPlayer } = this.ledger.creationSpendSince(at - MANA_CAPS.windowMs);
    const remainingFlow = Math.max(0, this.globalFlow() - total);
    const headroom = (id: string, cap: number) => Math.max(0, cap - (byPlayer.get(id) ?? 0));

    this.markActive(playerId, at);
    const others = this.activePlayers(at).filter((id) => id !== playerId);
    const mine = headroom(playerId, personalCap);
    const caps = [mine, ...others.map((id) => headroom(id, MANA_CAPS.explorer))];
    return waterFill(remainingFlow, caps)[0];
  }

  /**
   * Read-only view for a player's mana tracker: the same numbers admission
   * uses, without holding anything. `available` is what they could draw now.
   */
  status(playerId: string, progress: PlayerProgress, solar = this.solarFor(playerId), at = this.now()) {
    const cap = this.capFor(playerId, progress, solar);
    const { total, byPlayer } = this.ledger.creationSpendSince(at - MANA_CAPS.windowMs);
    const spent = byPlayer.get(playerId) ?? 0;
    const available = cap > 0 ? this.shareFor(playerId, cap, at) : 0;
    const flow = this.globalFlow();
    return {
      cap: round3(cap),
      spent: round3(spent),
      available: round3(available),
      flow: round3(flow),
      flowSpent: round3(total),
      activePlayers: this.activePlayers(at).length,
      windowMs: MANA_CAPS.windowMs,
      solar: round3(clamp(solar, 0.9, 1.1)),
    };
  }

  /** Admit and hold, or refuse gently. */
  requestDraw(req: DrawRequest): DrawDecision {
    const at = this.now();
    if (!(req.estimate > 0) || !Number.isFinite(req.estimate)) {
      return { ok: false, reason: "bad_amount", message: REPLENISH_MESSAGE, remainingToday: 0 };
    }
    if (this.guests.has(req.playerId)) {
      return { ok: false, reason: "sign_in_required", message: SIGN_IN_MESSAGE, remainingToday: 0 };
    }
    const solar = clamp(req.solar ?? this.solarFor(req.playerId, at), 0.9, 1.1);
    const cap = this.capFor(req.playerId, req.progress, solar);
    if (cap <= 0) {
      return { ok: false, reason: "not_unlocked", message: "Making with mana opens at chapter 5 (Maker). See the steps in Your journey.", remainingToday: 0 };
    }

    const share = this.shareFor(req.playerId, cap, at);
    const spent = this.ledger.creationSpendSince(at - MANA_CAPS.windowMs).byPlayer.get(req.playerId) ?? 0;
    // Tiny tolerance for float rounding of shares.
    if (req.estimate > share + 1e-6) {
      const personalLeft = Math.max(0, cap - spent);
      const reason = req.estimate > personalLeft + 1e-6 ? "personal_cap" : "universe_flow";
      return { ok: false, reason, message: REPLENISH_MESSAGE, remainingToday: round3(share) };
    }

    const held = this.ledger.reserve(req.ref, req.estimate, req.playerId, at);
    if (!held.ok) {
      return { ok: false, reason: held.reason, message: REPLENISH_MESSAGE, remainingToday: round3(share) };
    }
    return { ok: true, ref: held.ref, estimate: held.estimate, remainingToday: round3(share - held.estimate) };
  }
}

/**
 * Max-min fair split of `total` among claimants with individual caps.
 * Returns each claimant's share in input order; Σ shares = min(total, Σ caps).
 */
export function waterFill(total: number, caps: number[]): number[] {
  const order = caps.map((c, i) => [Math.max(0, c), i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(caps.length).fill(0);
  let left = Math.max(0, total);
  let k = order.length;
  for (const [cap, i] of order) {
    const fair = left / k;
    const give = Math.min(cap, fair);
    out[i] = give;
    left -= give;
    k -= 1;
  }
  return out;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 1));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

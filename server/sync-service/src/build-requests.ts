/**
 * Asking to build (2026-11-07): see shared/build-requests.ts for the rules.
 *
 * Two tables in universe.db (so the hourly/S3 backups cover them):
 *   build_requests       one row per (world, asking account): open, declined or withdrawn
 *   build_request_inbox  fan-out on write: one row per (owner character, world, ask)
 *
 * The inbox makes "what's waiting for me" one indexed lookup by character, however
 * many worlds exist (no scan of the universe per player). It is rebuilt for a world
 * whenever its creator/builders change (`syncOwners`), so a new builder sees the
 * asks already waiting and a removed one stops seeing them.
 *
 * Pure SQL over a minimal db interface (better-sqlite3 in the service, node:sqlite in
 * tests). Every method is synchronous, so a sequence of statements can't interleave
 * with another request.
 */
import { BUILD_REQUEST_LIMITS as L, type MyBuildRequest } from "../../../shared/build-requests.js";

export interface SqlDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

type Status = "open" | "declined" | "withdrawn";
interface Row {
  world_id: string;
  account_id: string;
  requester: string;
  asked_at: number;
  status: Status;
  decided_at: number | null;
}

export type AskResult =
  | { ok: true; status: "open"; askedAt: number }
  | { ok: false; error: "declined_recently"; message: string; retryAt: number }
  | { ok: false; error: "world_full" | "slow_down"; message: string };

export interface InboxRow {
  worldId: string;
  requester: string;
  askedAt: number;
}

export class BuildRequests {
  constructor(private readonly db: SqlDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS build_requests (
        world_id TEXT NOT NULL,
        account_id TEXT NOT NULL,     -- the asking account (one ask per person per world)
        requester TEXT NOT NULL,      -- the character that asked (made the builder on approval)
        asked_at INTEGER NOT NULL,
        status TEXT NOT NULL,         -- open | declined | withdrawn
        decided_at INTEGER,
        decided_by TEXT,              -- character who declined
        PRIMARY KEY (world_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS build_requests_account ON build_requests (account_id, asked_at);
      CREATE INDEX IF NOT EXISTS build_requests_world ON build_requests (world_id, status);
      CREATE TABLE IF NOT EXISTS build_request_inbox (
        owner_id TEXT NOT NULL,       -- a creator or builder character
        world_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        PRIMARY KEY (owner_id, world_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS build_request_inbox_world ON build_request_inbox (world_id);
    `);
  }

  private row(worldId: string, accountId: string): Row | undefined {
    return this.db.prepare("SELECT * FROM build_requests WHERE world_id = ? AND account_id = ?").get(worldId, accountId) as Row | undefined;
  }

  private isLive(r: Row, now: number): boolean {
    return r.status === "open" && now - r.asked_at < L.expireMs;
  }

  /** Where this account's ask for this world stands (the route answers "builder" itself). */
  status(worldId: string, accountId: string, now = Date.now()): MyBuildRequest {
    const r = this.row(worldId, accountId);
    if (!r) return { status: "none" };
    if (this.isLive(r, now)) return { status: "open", askedAt: r.asked_at };
    if (r.status === "declined") {
      const retryAt = (r.decided_at ?? r.asked_at) + L.declineCooldownMs;
      if (now < retryAt) return { status: "declined", askedAt: r.asked_at, retryAt };
    }
    return { status: "none" };
  }

  /**
   * Ask to build. `owners` are the world's creator and builders right now (their
   * inboxes get it). Asking again while open is a no-op that keeps the original time.
   */
  ask(worldId: string, requester: string, accountId: string, owners: readonly string[], now = Date.now()): AskResult {
    const r = this.row(worldId, accountId);
    if (r && this.isLive(r, now)) {
      // Same person, maybe another of their characters: the newest asker is who gets made a builder
      if (r.requester !== requester) this.db.prepare("UPDATE build_requests SET requester = ? WHERE world_id = ? AND account_id = ?").run(requester, worldId, accountId);
      return { ok: true, status: "open", askedAt: r.asked_at };
    }
    if (r?.status === "declined") {
      const retryAt = (r.decided_at ?? r.asked_at) + L.declineCooldownMs;
      if (now < retryAt) return { ok: false, error: "declined_recently", message: "They said not yet. You can ask again later.", retryAt };
    }
    if (r?.status === "withdrawn" && now < (r.decided_at ?? r.asked_at) + L.withdrawCooldownMs) {
      return { ok: false, error: "slow_down", message: "You just took that back. Try again in a little while." };
    }
    const today = (this.db.prepare("SELECT COUNT(*) AS n FROM build_requests WHERE account_id = ? AND asked_at > ?").get(accountId, now - 24 * 3600_000) as { n: number }).n;
    if (today >= L.asksPerDay) return { ok: false, error: "slow_down", message: "You’ve asked a lot today. Try again tomorrow." };
    const open = (this.db.prepare("SELECT COUNT(*) AS n FROM build_requests WHERE world_id = ? AND status = 'open' AND asked_at > ?").get(worldId, now - L.expireMs) as { n: number }).n;
    if (open >= L.openPerWorld) return { ok: false, error: "world_full", message: "This world has a lot of asks waiting. Try again in a few days." };

    this.db.prepare(`INSERT INTO build_requests (world_id, account_id, requester, asked_at, status, decided_at, decided_by)
      VALUES (?, ?, ?, ?, 'open', NULL, NULL)
      ON CONFLICT (world_id, account_id) DO UPDATE SET requester = excluded.requester, asked_at = excluded.asked_at,
        status = 'open', decided_at = NULL, decided_by = NULL`).run(worldId, accountId, requester, now);
    this.fanOut(worldId, accountId, owners);
    return { ok: true, status: "open", askedAt: now };
  }

  /** The asker takes it back. Kept (as withdrawn) so it still counts toward their day. */
  withdraw(worldId: string, accountId: string, now = Date.now()): boolean {
    const r = this.row(worldId, accountId);
    if (!r || !this.isLive(r, now)) return false;
    this.db.prepare("UPDATE build_requests SET status = 'withdrawn', decided_at = ? WHERE world_id = ? AND account_id = ?").run(now, worldId, accountId);
    this.db.prepare("DELETE FROM build_request_inbox WHERE world_id = ? AND account_id = ?").run(worldId, accountId);
    return true;
  }

  /** The open ask this character made for this world (to approve or decline it). */
  openAsk(worldId: string, requester: string, now = Date.now()): { accountId: string; askedAt: number } | null {
    const r = this.db.prepare("SELECT * FROM build_requests WHERE world_id = ? AND requester = ? AND status = 'open'").get(worldId, requester) as Row | undefined;
    return r && this.isLive(r, now) ? { accountId: r.account_id, askedAt: r.asked_at } : null;
  }

  /** An owner said no: the asker may try again after the cooldown. */
  decline(worldId: string, accountId: string, by: string, now = Date.now()): void {
    this.db.prepare("UPDATE build_requests SET status = 'declined', decided_at = ?, decided_by = ? WHERE world_id = ? AND account_id = ? AND status = 'open'").run(now, by, worldId, accountId);
    this.db.prepare("DELETE FROM build_request_inbox WHERE world_id = ? AND account_id = ?").run(worldId, accountId);
  }

  /** They're a builder now (approved, or added directly): the ask is done. */
  resolve(worldId: string, accountId: string): void {
    this.db.prepare("DELETE FROM build_requests WHERE world_id = ? AND account_id = ?").run(worldId, accountId);
    this.db.prepare("DELETE FROM build_request_inbox WHERE world_id = ? AND account_id = ?").run(worldId, accountId);
  }

  /** The world's owners changed: rebuild its inbox rows for every open ask. */
  syncOwners(worldId: string, owners: readonly string[], now = Date.now()): void {
    this.db.prepare("DELETE FROM build_request_inbox WHERE world_id = ?").run(worldId);
    const asks = this.db.prepare("SELECT account_id FROM build_requests WHERE world_id = ? AND status = 'open' AND asked_at > ?").all(worldId, now - L.expireMs) as { account_id: string }[];
    for (const a of asks) this.fanOut(worldId, a.account_id, owners);
  }

  private fanOut(worldId: string, accountId: string, owners: readonly string[]): void {
    const ins = this.db.prepare("INSERT OR IGNORE INTO build_request_inbox (owner_id, world_id, account_id) VALUES (?, ?, ?)");
    for (const o of new Set(owners)) if (o) ins.run(o, worldId, accountId);
  }

  /** Open asks waiting for any of these characters (one person's), newest first. */
  inbox(ownerIds: readonly string[], now = Date.now()): InboxRow[] {
    const ids = [...new Set(ownerIds)].filter(Boolean).slice(0, 50);
    if (!ids.length) return [];
    const rows = this.db.prepare(`SELECT DISTINCT r.world_id, r.requester, r.asked_at FROM build_request_inbox i
        JOIN build_requests r ON r.world_id = i.world_id AND r.account_id = i.account_id
        WHERE i.owner_id IN (${ids.map(() => "?").join(", ")}) AND r.status = 'open' AND r.asked_at > ?
        ORDER BY r.asked_at DESC LIMIT ?`).all(...ids, now - L.expireMs, L.inboxMax) as { world_id: string; requester: string; asked_at: number }[];
    return rows.map((r) => ({ worldId: r.world_id, requester: r.requester, askedAt: r.asked_at }));
  }

  /** Forget asks that faded or whose cooldown ended (run now and then). */
  sweep(now = Date.now()): number {
    const stale = now - L.expireMs;
    const done = now - Math.max(L.declineCooldownMs, 24 * 3600_000);
    this.db.prepare(`DELETE FROM build_request_inbox WHERE (world_id, account_id) IN (
        SELECT world_id, account_id FROM build_requests WHERE status = 'open' AND asked_at <= ?)`).run(stale);
    const before = (this.db.prepare("SELECT COUNT(*) AS n FROM build_requests").get() as { n: number }).n;
    this.db.prepare(`DELETE FROM build_requests WHERE (status = 'open' AND asked_at <= ?)
        OR (status != 'open' AND COALESCE(decided_at, asked_at) <= ?)`).run(stale, done);
    return before - (this.db.prepare("SELECT COUNT(*) AS n FROM build_requests").get() as { n: number }).n;
  }
}

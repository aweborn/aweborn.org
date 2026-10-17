/**
 * Aweborn — Universal Mana Pool & Ledger (Phase 05, formula v3)
 *
 * The pool is the treasury: every dollar in becomes `K` mana, every dollar out
 * is a categorized draw. Players only ever draw from the creative share
 * (`α` of each unrestricted inflow). The high-water line (all money ever in +
 * awe reach) only rises and sets the Living Frontier.
 *
 * The append-only SQLite ledger is the source of truth; the in-memory totals
 * (and the Universe CRDT's `mana` map) are rebuilt from it on boot. Amounts
 * are stored as integer milli-mana so sub-cent compute (0.2 mana for an
 * orchestration call) adds up exactly.
 *
 * Budget shortfall (Alex, 2026-10-14): bills always get paid. When a
 * non-creative draw would leave the pool below the creative share, the
 * creative share shrinks to the pool, in the open (its own ledger row and
 * shooting star), as disclosed on giving.html and in the Terms.
 */

import type Database from "better-sqlite3";
import type * as Y from "yjs";
import {
  MANA_PARAMS,
  frontierRadiusFor,
  type ManaFunction,
  type ManaPurpose,
  type ManaState,
} from "../../../shared/crdt-schema.js";

/** 1 mana = 1,000 milli-mana (stored unit). */
const MM = 1000;
const toMm = (mana: number) => Math.round(mana * MM);
const toMana = (mm: number) => mm / MM;

export type InflowSource = "gift" | "card" | "grant" | "founding" | "other";
export type LedgerKind = "inflow" | "draw" | "shortfall" | "reserve" | "settle" | "release" | "awe";

export const MANA_FUNCTIONS: readonly ManaFunction[] = ["program", "management", "fundraising"];
export const MANA_PURPOSES: readonly ManaPurpose[] = ["creations", "research", "cards", "servers", "compensation", "other"];
export const INFLOW_SOURCES: readonly InflowSource[] = ["gift", "card", "grant", "founding", "other"];

/** A ledger row as returned to callers (mana, not milli-mana). */
export interface LedgerEntry {
  id: number;
  at: number;
  kind: LedgerKind;
  /** Always ≥ 0; the kind says which way it moves. */
  amount: number;
  /** Signed change to the creative share caused by this row. */
  creativeDelta: number;
  source: InflowSource | null;
  restricted: boolean;
  fn: ManaFunction | null;
  purpose: ManaPurpose | null;
  playerId: string | null;
  ref: string | null;
  note: string | null;
}

/** What anyone can see (GET /mana/ledger). */
export type PublicLedgerEntry = Omit<LedgerEntry, "playerId" | "ref">;

export interface InflowInput {
  source: InflowSource;
  /** Net dollars received (after processor fees). */
  netDollars: number;
  /**
   * Dollars that count toward the creative share. Defaults to `netDollars`
   * for unrestricted gifts; card sales pass net minus production + shipping;
   * restricted grants are forced to 0.
   */
  creativeBaseDollars?: number;
  restricted?: boolean;
  /** External id (Stripe payment intent, grant id…). Makes the call idempotent. */
  ref?: string;
  note?: string;
  at?: number;
}

export interface DrawInput {
  /** Non-creative draws only; creations go through reserve → settle. */
  purpose: Exclude<ManaPurpose, "creations">;
  fn: ManaFunction;
  dollars: number;
  ref?: string;
  note?: string;
  at?: number;
}

export type ReserveResult =
  | { ok: true; ref: string; estimate: number }
  | { ok: false; reason: "insufficient_creative" | "duplicate" | "bad_amount" };

interface Totals {
  pool: number;
  creative: number;
  reserved: number;
  highWater: number;
  totalIn: number;
  shortfall: number;
  drawnBy: Record<ManaFunction, number>;
  drawnByPurpose: Record<ManaPurpose, number>;
  lastDonationAt: number;
}

function zeroTotals(): Totals {
  return {
    pool: 0,
    creative: 0,
    reserved: 0,
    highWater: 0,
    totalIn: 0,
    shortfall: 0,
    drawnBy: { program: 0, management: 0, fundraising: 0 },
    drawnByPurpose: { creations: 0, research: 0, cards: 0, servers: 0, compensation: 0, other: 0 },
    lastDonationAt: 0,
  };
}

interface Row {
  id: number;
  at: number;
  kind: LedgerKind;
  amount_mm: number;
  creative_mm: number;
  source: string | null;
  restricted: number;
  fn: string | null;
  purpose: string | null;
  player_id: string | null;
  ref: string | null;
  note: string | null;
}

export class ManaLedger {
  /** Totals in milli-mana. */
  private t: Totals = zeroTotals();
  /** Open reservations: ref → estimate (milli-mana). */
  private open = new Map<string, { mm: number; playerId: string | null }>();
  private listeners = new Set<(state: ManaState) => void>();

  constructor(private db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mana_ledger (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          INTEGER NOT NULL,
        kind        TEXT    NOT NULL CHECK (kind IN ('inflow','draw','shortfall','reserve','settle','release','awe')),
        amount_mm   INTEGER NOT NULL CHECK (amount_mm >= 0),
        creative_mm INTEGER NOT NULL DEFAULT 0,
        source      TEXT,
        restricted  INTEGER NOT NULL DEFAULT 0,
        fn          TEXT,
        purpose     TEXT,
        player_id   TEXT,
        ref         TEXT,
        note        TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mana_ledger_kind_ref ON mana_ledger(kind, ref) WHERE ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_mana_ledger_at ON mana_ledger(at);
      -- Append-only: the audit trail can't be edited or erased in place.
      CREATE TRIGGER IF NOT EXISTS mana_ledger_no_update BEFORE UPDATE ON mana_ledger
        BEGIN SELECT RAISE(ABORT, 'mana_ledger is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS mana_ledger_no_delete BEFORE DELETE ON mana_ledger
        BEGIN SELECT RAISE(ABORT, 'mana_ledger is append-only'); END;
    `);
    this.replay();
  }

  // ── Reading ──────────────────────────────────────────────────────

  state(): ManaState {
    const t = this.t;
    const fnMana = Object.fromEntries(MANA_FUNCTIONS.map((f) => [f, toMana(t.drawnBy[f])])) as Record<ManaFunction, number>;
    const purposeMana = Object.fromEntries(MANA_PURPOSES.map((p) => [p, toMana(t.drawnByPurpose[p])])) as Record<ManaPurpose, number>;
    const highWater = toMana(t.highWater);
    return {
      pool: toMana(t.pool),
      creative: toMana(t.creative),
      reserved: toMana(t.reserved),
      highWater,
      frontierRadius: frontierRadiusFor(highWater),
      totalIn: toMana(t.totalIn),
      drawnBy: fnMana,
      drawnByPurpose: purposeMana,
      shortfall: toMana(t.shortfall),
      params: { ...MANA_PARAMS },
      lastDonationAt: t.lastDonationAt,
    };
  }

  /** Creative mana not already held by in-flight manifestations. */
  available(): number {
    return toMana(Math.max(0, this.t.creative - this.t.reserved));
  }

  /** Newest first. `beforeId` pages backwards. */
  entries(limit = 50, beforeId?: number): LedgerEntry[] {
    const rows = (beforeId
      ? this.db.prepare("SELECT * FROM mana_ledger WHERE id < ? ORDER BY id DESC LIMIT ?").all(beforeId, limit)
      : this.db.prepare("SELECT * FROM mana_ledger ORDER BY id DESC LIMIT ?").all(limit)) as Row[];
    return rows.map(rowToEntry);
  }

  /**
   * The radically transparent view: every movement of money (in, out,
   * shortfall, creations, awe reach), newest first. Hides in-flight holds,
   * who made a creation, external refs, and inflow notes (donors stay private).
   */
  publicEntries(limit = 50, beforeId?: number): PublicLedgerEntry[] {
    const kinds = "('inflow','draw','shortfall','settle','awe')";
    const rows = (beforeId
      ? this.db.prepare(`SELECT * FROM mana_ledger WHERE kind IN ${kinds} AND id < ? ORDER BY id DESC LIMIT ?`).all(beforeId, limit)
      : this.db.prepare(`SELECT * FROM mana_ledger WHERE kind IN ${kinds} ORDER BY id DESC LIMIT ?`).all(limit)) as Row[];
    return rows.map((r) => {
      const e = rowToEntry(r);
      return {
        id: e.id,
        at: e.at,
        kind: e.kind,
        amount: e.amount,
        creativeDelta: e.creativeDelta,
        source: e.source,
        restricted: e.restricted,
        fn: e.fn,
        purpose: e.purpose,
        note: e.kind === "inflow" ? null : e.note,
      };
    });
  }

  onChange(fn: (state: ManaState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── Money in ─────────────────────────────────────────────────────

  /** Every source of money: pool + high-water, and `α` of the creative base. Idempotent on `ref`. */
  recordInflow(input: InflowInput): LedgerEntry | null {
    if (!INFLOW_SOURCES.includes(input.source)) throw new Error(`unknown source ${input.source}`);
    assertDollars(input.netDollars);
    const restricted = !!input.restricted;
    const base = restricted ? 0 : (input.creativeBaseDollars ?? input.netDollars);
    assertDollars(base);
    if (base > input.netDollars) throw new Error("creative base can't exceed the net amount");
    const amountMm = toMm(input.netDollars * MANA_PARAMS.K);
    const creativeMm = toMm(base * MANA_PARAMS.K * MANA_PARAMS.alpha);
    return this.append({
      kind: "inflow",
      amountMm,
      creativeMm,
      source: input.source,
      restricted,
      ref: input.ref,
      note: input.note,
      at: input.at,
    });
  }

  /** Awe pushes the high-water line (and so the Frontier) outward. Never touches pool or creative. */
  recordAweReach(reachMana: number, playerId: string | null, ref?: string, note?: string): LedgerEntry | null {
    if (!(reachMana > 0) || !Number.isFinite(reachMana)) throw new Error("reach must be > 0");
    return this.append({ kind: "awe", amountMm: toMm(reachMana), creativeMm: 0, playerId, ref, note });
  }

  // ── Money out ────────────────────────────────────────────────────

  /**
   * A non-creative draw (servers, compensation, research, cards…). Always
   * recorded: bills get paid. If it leaves the pool below the creative share,
   * a `shortfall` row shrinks the creative share to match, in the open.
   */
  recordDraw(input: DrawInput): { draw: LedgerEntry; shortfall: LedgerEntry | null } | null {
    if ((input.purpose as ManaPurpose) === "creations") throw new Error("creations draw via reserve → settle");
    if (!MANA_PURPOSES.includes(input.purpose)) throw new Error(`unknown purpose ${input.purpose}`);
    if (!MANA_FUNCTIONS.includes(input.fn)) throw new Error(`unknown function ${input.fn}`);
    assertDollars(input.dollars);
    const amountMm = toMm(input.dollars * MANA_PARAMS.K);
    const run = this.db.transaction(() => {
      const draw = this.append({ kind: "draw", amountMm, creativeMm: 0, fn: input.fn, purpose: input.purpose, ref: input.ref, note: input.note, at: input.at });
      if (!draw) return null;
      const gap = this.t.creative - Math.max(0, this.t.pool);
      const shortfall = gap > 0
        ? this.append({
            kind: "shortfall",
            amountMm: gap,
            creativeMm: -gap,
            fn: input.fn,
            purpose: input.purpose,
            ref: input.ref,
            note: `creative share covered part of ${input.purpose}`,
            at: input.at,
          })
        : null;
      return { draw, shortfall };
    });
    try {
      return run();
    } catch (err) {
      this.replay(); // the transaction rolled back; rebuild memory from disk
      throw err;
    }
  }

  // ── Creations: reserve → settle / release ────────────────────────

  /** Hold an estimate against the creative share before generating. */
  reserve(ref: string, estimateMana: number, playerId: string | null, at?: number): ReserveResult {
    if (!(estimateMana > 0) || !Number.isFinite(estimateMana)) return { ok: false, reason: "bad_amount" };
    if (this.open.has(ref)) return { ok: false, reason: "duplicate" };
    const mm = toMm(estimateMana);
    if (mm > this.t.creative - this.t.reserved) return { ok: false, reason: "insufficient_creative" };
    const e = this.append({ kind: "reserve", amountMm: mm, creativeMm: 0, playerId, ref, at });
    if (!e) return { ok: false, reason: "duplicate" };
    return { ok: true, ref, estimate: toMana(mm) };
  }

  /**
   * Creation spend of everything reserved since `since`: what it actually
   * cost if settled, the estimate if still in flight, nothing if released.
   * Feeds the rolling-24 h personal caps and global flow.
   */
  creationSpendSince(since: number): { total: number; byPlayer: Map<string, number> } {
    const rows = this.db
      .prepare(
        `SELECT r.player_id AS player_id,
                SUM(CASE WHEN s.id IS NOT NULL THEN s.amount_mm
                         WHEN x.id IS NOT NULL THEN 0
                         ELSE r.amount_mm END) AS mm
           FROM mana_ledger r
           LEFT JOIN mana_ledger s ON s.kind = 'settle'  AND s.ref = r.ref
           LEFT JOIN mana_ledger x ON x.kind = 'release' AND x.ref = r.ref
          WHERE r.kind = 'reserve' AND r.at >= ?
          GROUP BY r.player_id`,
      )
      .all(since) as { player_id: string | null; mm: number }[];
    let total = 0;
    const byPlayer = new Map<string, number>();
    for (const r of rows) {
      total += r.mm;
      if (r.player_id) byPlayer.set(r.player_id, toMana(r.mm));
    }
    return { total: toMana(total), byPlayer };
  }

  /**
   * The generation finished: draw what the providers actually billed. If it
   * cost more than the estimate, the overage still comes out (the money was
   * spent) but the creative share never goes below 0.
   */
  settle(ref: string, actualMana: number, note?: string): LedgerEntry | null {
    if (!this.open.has(ref)) return null;
    if (!(actualMana >= 0) || !Number.isFinite(actualMana)) throw new Error("actual must be ≥ 0");
    const mm = toMm(actualMana);
    const fromCreative = Math.min(mm, Math.max(0, this.t.creative));
    return this.append({
      kind: "settle",
      amountMm: mm,
      creativeMm: -fromCreative,
      fn: "program",
      purpose: "creations",
      playerId: this.open.get(ref)!.playerId,
      ref,
      note,
    });
  }

  /** The generation failed: nothing drawn, the hold goes back. */
  release(ref: string): LedgerEntry | null {
    const r = this.open.get(ref);
    if (!r) return null;
    return this.append({ kind: "release", amountMm: r.mm, creativeMm: 0, playerId: r.playerId, ref });
  }

  // ── Universe CRDT ────────────────────────────────────────────────

  /** Write the totals into the Universe doc's `mana` map (the server is its only writer). */
  publish(doc: Y.Doc): void {
    const s = this.state();
    const map = doc.getMap("mana");
    doc.transact(() => {
      for (const key of [...map.keys()]) if (!(key in s)) map.delete(key); // retire August fields
      for (const [k, v] of Object.entries(s)) map.set(k, v);
    }, "mana");
  }

  // ── Internals ────────────────────────────────────────────────────

  private replay(): void {
    this.t = zeroTotals();
    this.open.clear();
    const rows = this.db.prepare("SELECT * FROM mana_ledger ORDER BY id").all() as Row[];
    for (const row of rows) this.apply(row);
  }

  /** Apply a row to the in-memory totals. Pure bookkeeping; validation happened at append. */
  private apply(row: Row): void {
    const t = this.t;
    const a = row.amount_mm;
    t.creative += row.creative_mm;
    switch (row.kind) {
      case "inflow":
        t.pool += a;
        t.highWater += a;
        t.totalIn += a;
        if (row.source === "gift") t.lastDonationAt = Math.max(t.lastDonationAt, row.at);
        break;
      case "draw":
        t.pool -= a;
        t.drawnBy[row.fn as ManaFunction] += a;
        t.drawnByPurpose[row.purpose as ManaPurpose] += a;
        break;
      case "shortfall":
        t.shortfall += a;
        break;
      case "reserve":
        t.reserved += a;
        if (row.ref) this.open.set(row.ref, { mm: a, playerId: row.player_id });
        break;
      case "settle": {
        const r = row.ref ? this.open.get(row.ref) : undefined;
        if (r) {
          t.reserved -= r.mm;
          this.open.delete(row.ref!);
        }
        t.pool -= a;
        t.drawnBy.program += a;
        t.drawnByPurpose.creations += a;
        break;
      }
      case "release": {
        const r = row.ref ? this.open.get(row.ref) : undefined;
        if (r) {
          t.reserved -= r.mm;
          this.open.delete(row.ref!);
        }
        break;
      }
      case "awe":
        t.highWater += a;
        break;
    }
  }

  /**
   * Insert + apply. Returns null when `(kind, ref)` already exists (idempotent
   * retries, e.g. a Stripe webhook delivered twice).
   */
  private append(e: {
    kind: LedgerKind;
    amountMm: number;
    creativeMm: number;
    source?: InflowSource;
    restricted?: boolean;
    fn?: ManaFunction;
    purpose?: ManaPurpose;
    playerId?: string | null;
    ref?: string;
    note?: string;
    at?: number;
  }): LedgerEntry | null {
    const at = e.at ?? Date.now();
    let id: number;
    try {
      const info = this.db
        .prepare(
          `INSERT INTO mana_ledger (at, kind, amount_mm, creative_mm, source, restricted, fn, purpose, player_id, ref, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(at, e.kind, e.amountMm, e.creativeMm, e.source ?? null, e.restricted ? 1 : 0, e.fn ?? null, e.purpose ?? null, e.playerId ?? null, e.ref ?? null, e.note ?? null);
      id = Number(info.lastInsertRowid);
    } catch (err) {
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
      throw err;
    }
    const row = this.db.prepare("SELECT * FROM mana_ledger WHERE id = ?").get(id) as Row;
    this.apply(row);
    this.emit();
    return rowToEntry(row);
  }

  private emitQueued = false;
  private emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      const s = this.state();
      for (const fn of this.listeners) fn(s);
    });
  }
}

function assertDollars(d: number): void {
  if (!Number.isFinite(d) || d < 0) throw new Error("amount must be a finite number ≥ 0");
}

function rowToEntry(r: Row): LedgerEntry {
  return {
    id: r.id,
    at: r.at,
    kind: r.kind,
    amount: toMana(r.amount_mm),
    creativeDelta: toMana(r.creative_mm),
    source: (r.source as InflowSource | null) ?? null,
    restricted: !!r.restricted,
    fn: (r.fn as ManaFunction | null) ?? null,
    purpose: (r.purpose as ManaPurpose | null) ?? null,
    playerId: r.player_id,
    ref: r.ref,
    note: r.note,
  };
}

/**
 * The 18+ door (Phase 07 → "18+ worlds, the Reddit way", decision 3; Phase 10 Q10b).
 *
 * A saved player opens the door by entering a birthdate that makes them 18 or older and
 * turning on *Show 18+*. Two things hang on it:
 *
 *   1. 18+ content. Nothing is rated 18+ yet (genai `library.rating` hides everything
 *      that isn't `everyone`), so today the door shows nothing new. The containment
 *      model in Phase 07 will read `doorOpen` when 18+ worlds are built.
 *   2. Research (Q10b, Alex 2026-11-23): a player behind the door is automatically a
 *      research candidate. Disclosed, no consent form, no separate research opt-in.
 *      The match recorder stamps each human slot with it (`research_ok`), and research
 *      copies use only those players' own traces (match-store.ts → `researchCopy`).
 *
 * What is stored, per account: when the birthdate was confirmed, whether *Show 18+* is
 * on, and when that last changed. **The birthdate itself is never stored or logged**:
 * it is checked and dropped. An under-18 birthdate stores nothing either; the account is
 * held from trying again for a while, in memory only (gone on restart).
 *
 * This is self-declaration, not an age check. A real check (a vendor's age estimate)
 * is required by law in some places before 18+ content is shown there (Phase 07,
 * decision 3, research update); that is not built and must be before 18+ worlds ship.
 *
 * The door belongs to the account (the person), not to a character. Guests can't open
 * it: decision 3 says "be signed in". Pure SQL over the minimal db interface, so tests
 * run on node:sqlite; every method is synchronous.
 */
import type { SqlDb } from "./build-requests.js";

/** The age the door asks for. */
export const DOOR_AGE = 18;
/** After an under-18 birthdate, how long before the same account may try again. */
export const DOOR_RETRY_MS = 24 * 60 * 60 * 1000;
/** Nobody alive was born before this; an earlier year is a typing mistake. */
const OLDEST_YEAR = 1900;

export interface DoorState {
  /** A birthdate of 18 or older has been confirmed on this account. */
  confirmed: boolean;
  /** *Show 18+* is on. Only ever true when `confirmed` is. */
  show: boolean;
}

export type DoorResult =
  | ({ ok: true } & DoorState)
  | { ok: false; code: "birthdate_needed" | "bad_birthdate" | "under_age"; retryAt?: number };

interface Row { confirmed_at: number; show: number }

/** `YYYY-MM-DD` → its parts, or null if it isn't a real calendar date. */
export function parseBirthdate(raw: unknown): { y: number; m: number; d: number } | null {
  if (typeof raw !== "string") return null;
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!hit) return null;
  const y = Number(hit[1]), m = Number(hit[2]), d = Number(hit[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // Feb 30 and friends
  return { y, m, d };
}

/**
 * Has this person turned `age` everywhere on Earth? The server doesn't know the player's
 * time zone, so it uses the last one (UTC−12): on the birthday itself the door opens up
 * to a day late, never a day early. Someone born on Feb 29 turns 18 on Mar 1.
 */
export function isOldEnough(birth: { y: number; m: number; d: number }, now: number, age = DOOR_AGE): boolean {
  const today = new Date(now - 12 * 60 * 60 * 1000);
  const y = today.getUTCFullYear(), m = today.getUTCMonth() + 1, d = today.getUTCDate();
  const years = y - birth.y - (m < birth.m || (m === birth.m && d < birth.d) ? 1 : 0);
  return years >= age;
}

export class AgeDoor {
  /** accountId → when it may try again (after an under-18 birthdate). Memory only, on purpose. */
  private readonly held = new Map<string, number>();

  constructor(private readonly db: SqlDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS age_door (
        account_id TEXT PRIMARY KEY,
        confirmed_at INTEGER NOT NULL,
        show INTEGER NOT NULL,
        changed_at INTEGER NOT NULL
      );
    `);
  }

  private row(accountId: string): Row | undefined {
    return this.db.prepare("SELECT confirmed_at, show FROM age_door WHERE account_id = ?").get(accountId) as Row | undefined;
  }

  state(accountId: string): DoorState {
    const r = this.row(accountId);
    return { confirmed: Boolean(r), show: Boolean(r?.show) };
  }

  /** The door is open: confirmed 18+ and *Show 18+* on. Also what makes a research candidate (Q10b). */
  open(accountId: string | null | undefined): boolean {
    return accountId ? this.state(accountId).show : false;
  }

  /** When a held account may try again, or 0. */
  retryAt(accountId: string, now = Date.now()): number {
    const at = this.held.get(accountId) ?? 0;
    if (at <= now) {
      this.held.delete(accountId);
      return 0;
    }
    return at;
  }

  /**
   * Turn *Show 18+* on or off. Turning it on the first time needs a birthdate; after
   * that the account stays confirmed and the switch works alone. Turning it off never
   * needs anything.
   */
  set(accountId: string, show: boolean, birthdate: unknown, now = Date.now()): DoorResult {
    const r = this.row(accountId);
    if (!show) {
      if (r?.show) this.db.prepare("UPDATE age_door SET show = 0, changed_at = ? WHERE account_id = ?").run(now, accountId);
      return { ok: true, confirmed: Boolean(r), show: false };
    }
    if (r) {
      if (!r.show) this.db.prepare("UPDATE age_door SET show = 1, changed_at = ? WHERE account_id = ?").run(now, accountId);
      return { ok: true, confirmed: true, show: true };
    }
    const retryAt = this.retryAt(accountId, now);
    if (retryAt) return { ok: false, code: "under_age", retryAt };
    if (birthdate === undefined || birthdate === null || birthdate === "") return { ok: false, code: "birthdate_needed" };
    const birth = parseBirthdate(birthdate);
    if (!birth || birth.y < OLDEST_YEAR || !isOldEnough(birth, now, 0)) return { ok: false, code: "bad_birthdate" };
    if (!isOldEnough(birth, now)) {
      if (this.held.size > 50_000) this.held.clear(); // a bound, not a policy
      this.held.set(accountId, now + DOOR_RETRY_MS);
      return { ok: false, code: "under_age", retryAt: now + DOOR_RETRY_MS };
    }
    this.db.prepare("INSERT INTO age_door (account_id, confirmed_at, show, changed_at) VALUES (?, ?, 1, ?)").run(accountId, now, now);
    return { ok: true, confirmed: true, show: true };
  }

  /** Erasure: forget that this account ever opened the door. Returns whether there was anything. */
  forget(accountId: string): boolean {
    this.held.delete(accountId);
    const had = Boolean(this.row(accountId));
    if (had) this.db.prepare("DELETE FROM age_door WHERE account_id = ?").run(accountId);
    return had;
  }
}

/** `AgeDoor.forget` without a door, for `forgetPlayer` (research.ts). Safe before the table exists. */
export function forgetDoor(db: SqlDb, accountId: string): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'age_door'").get()) return false;
  const had = Boolean(db.prepare("SELECT 1 FROM age_door WHERE account_id = ?").get(accountId));
  db.prepare("DELETE FROM age_door WHERE account_id = ?").run(accountId);
  return had;
}

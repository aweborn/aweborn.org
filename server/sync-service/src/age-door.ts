/**
 * The 18+ door (Phase 07 → "18+ worlds, the Reddit way", decision 3 as changed by Alex
 * on 2026-11-24; Phase 10 Q10b).
 *
 * **It is a toggle and nothing else.** A saved player turns on *Show 18+*; turning it
 * on is their own statement that they are 18 or older. There is no date of birth, no
 * age entry and no form (Alex, 2026-11-24: "just a toggle switch is fine").
 *
 * A real age check belongs only where a state's or a country's law requires one, and
 * is not built: it needs a vendor and a way to tell where the player is. It has to
 * exist before 18+ content is shown in those places (Phase 07, decision 3, research
 * update). When it is built, `set` is where it refuses: turning the switch on from
 * such a place without a passed check.
 *
 * Two things hang on the door:
 *   1. 18+ content. Nothing is rated 18+ yet (genai `library.rating` hides everything
 *      that isn't `everyone`), so today the door shows nothing new. The containment
 *      model in Phase 07 will read `open`.
 *   2. Research (Q10b, Alex 2026-11-23): a player behind the door is automatically a
 *      research candidate. Disclosed, no consent form, no separate research opt-in.
 *      The match recorder stamps each human slot with it (`research_ok`), and research
 *      copies use only those players' own traces (match-store.ts → `researchCopy`).
 *
 * Stored, per account: whether the switch is on and when it last changed. The door
 * belongs to the account (the person), not to a character. Guests can't open it:
 * decision 3 says "be signed in". Pure SQL over the minimal db interface, so tests run
 * on node:sqlite; every method is synchronous.
 */
import type { SqlDb } from "./build-requests.js";

export class AgeDoor {
  constructor(private readonly db: SqlDb) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS age_door (
        account_id TEXT PRIMARY KEY,
        show INTEGER NOT NULL,
        changed_at INTEGER NOT NULL
      );
    `);
  }

  /** *Show 18+* is on for this account. Also what makes a research candidate (Q10b). */
  open(accountId: string | null | undefined): boolean {
    if (!accountId) return false;
    const r = this.db.prepare("SELECT show FROM age_door WHERE account_id = ?").get(accountId) as { show: number } | undefined;
    return Boolean(r?.show);
  }

  /** Turn *Show 18+* on or off; returns how it now stands. Off for an account that never had it on stores nothing. */
  set(accountId: string, show: boolean, now = Date.now()): boolean {
    if (this.open(accountId) === show) return show;
    this.db.prepare(`
      INSERT INTO age_door (account_id, show, changed_at) VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET show = excluded.show, changed_at = excluded.changed_at
    `).run(accountId, show ? 1 : 0, now);
    return show;
  }

  /** Erasure: forget that this account ever touched the switch. Returns whether there was anything. */
  forget(accountId: string): boolean {
    return forgetDoor(this.db, accountId);
  }
}

/** `AgeDoor.forget` without a door, for whatever deletes an account. Safe before the table exists. */
export function forgetDoor(db: SqlDb, accountId: string): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'age_door'").get()) return false;
  const had = Boolean(db.prepare("SELECT 1 FROM age_door WHERE account_id = ?").get(accountId));
  db.prepare("DELETE FROM age_door WHERE account_id = ?").run(accountId);
  return had;
}

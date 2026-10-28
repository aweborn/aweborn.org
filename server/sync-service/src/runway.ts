/**
 * Runway early warning (Phase 05 "Budget Shortfall", Rough Draft M4).
 *
 * Private only (Alex, 2026-10-16): when the non-creative money would last
 * fewer than 90 days at the last 90 days' average overhead, email Alex. No
 * in-game decay: players can't fix it, and a dim world reads as dying. The
 * disclosed shortfall star (ledger `shortfall` rows) stays public.
 *
 * One email per week at most while the warning holds, remembered in SQLite
 * so restarts don't re-send.
 */

import type Database from "better-sqlite3";
import type { ManaLedger } from "./mana.js";
import type { Email } from "./email.js";

export const RUNWAY_WARN_DAYS = 90;
const RESEND_MS = 7 * 86_400_000;
const CHECK_MS = 6 * 3600_000;

export class RunwayWatch {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Database.Database,
    private ledger: ManaLedger,
    private send: (mail: Email) => Promise<void>,
    private to: string,
    private now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS alert_log (key TEXT PRIMARY KEY, at INTEGER NOT NULL)`);
  }

  start(): void {
    if (this.timer) return;
    setTimeout(() => void this.check(), 60_000).unref();
    this.timer = setInterval(() => void this.check(), CHECK_MS);
    this.timer.unref();
  }

  /** Returns true if an email went out. */
  async check(): Promise<boolean> {
    const r = this.ledger.runway(this.now());
    if (!(r.days < RUNWAY_WARN_DAYS)) return false;
    const last = this.db.prepare("SELECT at FROM alert_log WHERE key = 'runway'").get() as { at: number } | undefined;
    if (last && this.now() - last.at < RESEND_MS) return false;
    this.db.prepare("INSERT INTO alert_log (key, at) VALUES ('runway', ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at").run(this.now());
    const dollars = (mana: number) => `$${(mana / 100).toFixed(2)}`;
    const days = Math.max(0, Math.floor(r.days));
    const text = [
      `Aweborn runway: about ${days} days.`,
      ``,
      `Money outside the creative share: ${dollars(r.reserve)}`,
      `Average overhead (last 90 days): ${dollars(r.monthlyOverhead)} a month`,
      ``,
      `If a bill ever exceeds it, the creative share shrinks by the gap, in the open (a shortfall star).`,
      `This email is private; nothing changes in the game. Next reminder in a week if it still holds.`,
      `Ledger: https://sync.aweborn.org/mana/ledger`,
    ].join("\n");
    await this.send({
      to: this.to,
      subject: `Aweborn runway: about ${days} days`,
      text,
      html: `<pre style="font: 14px/1.5 ui-monospace, monospace">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
    });
    return true;
  }
}
